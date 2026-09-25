import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { finalizeAbsentProgram } from "../../src/finalize/index.js";
import { emit } from "../../src/emit/index.js";
import { compileFile, writeOutputs } from "../../src/driver/index.js";
import { compile, bs, expectSuccess } from "../support/compile.js";
import { projectSource } from "../support/pipeline.js";

function pipeline(source: string, endpoint: string): string {
  const projected = projectSource(source).find((p) => p.endpoint === endpoint);
  assert.ok(projected, `missing projection for ${endpoint}`);
  // Absent must be finalized before emission (spec §absent-finalization); cleanup is skipped
  // here on purpose, so the raw projected shape stays visible.
  return emit(finalizeAbsentProgram(projected));
}

describe("BlueScript emitter", () => {
  it("emits direct communication for alice (spec §example-direct-communication)", () => {
    const code = pipeline(
      `
let x: integer@alice = 42@alice;
let y: integer@bob <- x;
`,
      "alice",
    );
    assert.match(code, /let x: integer = 42;/);
    assert.match(code, /sendInteger\("bob", "__top_0", x\);/);
    assert.doesNotMatch(code, /@/);
  });

  it("emits receive for bob (spec §example-direct-communication)", () => {
    const code = pipeline(
      `
let x: integer@alice = 42@alice;
let y: integer@bob <- x;
`,
      "bob",
    );
    assert.match(code, /let y: integer = receiveInteger\("alice", "__top_0"\);/);
  });

  it("emits broadcast (spec §example-broadcast)", () => {
    const alice = pipeline(
      `
let localOk: boolean@alice = true@alice;
let ok: boolean@every <- localOk;
`,
      "alice",
    );
    assert.match(alice, /broadcastBoolean\("__top_0", localOk\)/);
    assert.match(alice, /let ok: boolean = localOk;/);

    const bob = pipeline(
      `
let localOk: boolean@alice = true@alice;
let ok: boolean@every <- localOk;
`,
      "bob",
    );
    assert.match(bob, /let ok: boolean = receiveBoolean\("alice", "__top_0"\)/);
  });

  it("drops a call to another endpoint's local function entirely (spec §calling-local-from-choreography, §expression-projection)", () => {
    const bob = pipeline(
      `
function add@alice(a: integer@alice, b: integer@alice): integer@alice { return a + b; }
let x: integer@alice = add(1@alice, 2@alice);
`,
      "bob",
    );
    // `add` is not generated at bob, so the call itself disappears; its
    // arguments are still projected, in case one of them held a choreography
    // call (spec §function-projection). These two are literals, so what is left is
    // `nothing(null, null);`, which cleanup removes — see the next test, since
    // `pipeline` deliberately stops before cleanup.
    assert.doesNotMatch(bob, /add/);
    assert.equal(bob.trim(), "nothing(null, null);");
  });

  it("removes bob output after cleanup when top level calls alice (spec §calling-local-from-choreography, §projected-ast-cleanup)", () => {
    const result = compile(`
function add@alice(a: integer@alice) {
  return a;
}
add(10@alice);
`);
    expectSuccess(result);
    assert.equal(bs(result, "bob"), "");
    assert.match(bs(result, "alice"), /add\(10\);/);
  });

  it("maps void to void in functions", () => {
    const code = pipeline(
      `function f(): void { return; }`,
      "alice",
    );
    assert.match(code, /function f\(\): void/);
  });

  it("emits function with inferred return type through EPP (spec §function-return-type-inference)", () => {
    const code = pipeline(
      `function add@alice(a: integer@alice, b: integer@alice) {
  return a + b;
}`,
      "alice",
    );
    assert.match(code, /function add\(a: integer, b: integer\): integer/);
    assert.match(code, /return a \+ b;/);
  });

  it("compile writes index_<endpoint>.bs files", () => {
    const dir = mkdtempSync(join(tmpdir(), "choreobs-test-"));
    try {
      const cbsPath = join(dir, "index.cbs");
      const configPath = join(dir, "choreobs.json");
      const source = `
let x: integer@alice = 10@alice;
let y: integer@bob <- x;
`;
      writeFileSync(cbsPath, source, "utf8");
      writeFileSync(
        configPath,
        JSON.stringify({ endpoints: ["alice", "bob"] }),
        "utf8",
      );

      const result = compileFile(cbsPath);
      assert.equal(result.success, true);
      assert.equal(result.outputs.length, 2);

      writeOutputs(result.outputs);

      const alicePath = join(dir, "index_alice.bs");
      const bobPath = join(dir, "index_bob.bs");
      const aliceBs = readFileSync(alicePath, "utf8");
      const bobBs = readFileSync(bobPath, "utf8");

      assert.match(aliceBs, /sendInteger\("bob", "__top_0", x\)/);
      assert.match(bobBs, /receiveInteger\("alice", "__top_0"\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("emits a scalar local copy as local assignment (spec §local-copy)", () => {
    const alice = pipeline(
      `
let x: integer@every = 1@every;
let y: integer@alice <- x;
`,
      "alice",
    );
    assert.match(alice, /let x: integer = 1;/);
    assert.match(alice, /let y: integer = x;/);
    assert.doesNotMatch(alice, /sendInteger/);
    assert.doesNotMatch(alice, /receiveInteger/);
    assert.doesNotMatch(alice, /broadcastInteger/);
  });

  it("emits an array local copy with clone helper (spec §local-copy)", () => {
    const alice = pipeline(
      `
let xs: float[]@every = [1.1, 2.2]@every;
let ys: float[]@alice <- xs;
`,
      "alice",
    );
    assert.match(alice, /let xs: float\[] = \[1\.1, 2\.2\];/);
    assert.match(alice, /let ys: float\[] = cloneFloatArray\(xs\);/);
    assert.doesNotMatch(alice, /sendFloatArray/);
    assert.doesNotMatch(alice, /receiveFloatArray/);
    assert.doesNotMatch(alice, /broadcastFloatArray/);
  });

  it("emits average use case with localized array argument", () => {
    const alice = pipeline(
      `
function average@alice(arr: float[]@alice): float@alice {
  let sum = 0.0@alice;
  for (let i = 0@alice; i < arr.length; i = i + 1@alice) {
    sum = sum + arr[i];
  }
  return sum / (arr.length as float);
}
let arr: float[]@every = [1.1, 2.2, 4.5]@every;
let arrAlice: float[]@alice <- arr;
let avg: float@alice = average(arrAlice);
`,
      "alice",
    );
    assert.match(alice, /cloneFloatArray\(arr\)/);
    assert.match(alice, /average\(arrAlice\)/);
    assert.match(alice, /return sum \/ \(arr\.length as float\);/);
    assert.doesNotMatch(alice, /sendFloatArray/);
  });

  it("emits array builtins and array communication APIs", () => {
    const alice = pipeline(
      `
let xs: integer[]@alice = [1, 2, 3]@alice;
xs[1@alice] = 10@alice;
xs.push(20@alice);
let n: integer@alice = xs.length;
let ys: integer[]@bob <- xs;
`,
      "alice",
    );
    assert.match(alice, /let xs: integer\[] = \[1, 2, 3\];/);
    assert.match(alice, /xs\[1\] = 10;/);
    assert.match(alice, /xs\.push\(20\);/);
    assert.match(alice, /let n: integer = xs\.length;/);
    assert.match(alice, /sendIntegerArray\("bob", "__top_0", xs\);/);

    const bob = pipeline(
      `
let xs: integer[]@alice = [1, 2, 3]@alice;
let ys: integer[]@bob <- xs;
`,
      "bob",
    );
    assert.match(bob, /receiveIntegerArray\("alice", "__top_0"\)/);
  });

  it("emits && and || as the non-short-circuiting helpers (spec §logical-operator-code-generation)", () => {
    const alice = pipeline(
      `
let a: boolean@alice = true@alice;
let b: boolean@alice = false@alice;
let c: boolean@alice = a && b || !a;
let d: boolean@alice = a && (b || a);
`,
      "alice",
    );
    assert.match(alice, /let c: boolean = __or\(__and\(a, b\), !a\);/);
    assert.match(alice, /let d: boolean = __and\(a, \(__or\(b, a\)\)\);/);
    assert.doesNotMatch(alice, /&&|\|\|/);
  });
});

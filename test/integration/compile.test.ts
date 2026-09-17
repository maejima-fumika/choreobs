import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  compileFile,
  compileSource,
  writeOutputs,
  type CompileResult,
} from "../../src/driver/index.js";
import type { ChoreoBSConfig } from "../../src/config/types.js";

const aliceBob: ChoreoBSConfig = { endpoints: ["alice", "bob"] };

function compile(
  source: string,
  config: ChoreoBSConfig = aliceBob,
  cbsPath = "index.cbs",
): CompileResult {
  return compileSource(source, cbsPath, config);
}

function bs(result: CompileResult, endpoint: string): string {
  const hit = result.outputs.find((o) => o.endpoint === endpoint);
  assert.ok(hit, `missing output for ${endpoint}`);
  return hit.source.trimEnd();
}

function expectSuccess(result: CompileResult): void {
  assert.equal(
    result.success,
    true,
    `expected success, errors: ${JSON.stringify(result.errors)}`,
  );
}

function expectFailure(result: CompileResult): void {
  assert.equal(result.success, false);
  assert.ok(result.errors.length > 0);
  assert.equal(result.outputs.length, 0);
}

function assertNoChoreoSyntax(source: string): void {
  assert.doesNotMatch(source, /@/);
}

describe("integration — compile pipeline", () => {
  describe("communication edge cases", () => {
    it("assigns increasing top-level comm tags (top_0, top_1, …)", () => {
      const result = compile(`
let a: integer@alice = 1@alice;
let b: integer@bob <- a;
let c: integer@alice = 0@alice;
c <- b;
`);
      expectSuccess(result);
      assert.match(bs(result, "alice"), /sendInteger\("bob", "top_0", a\)/);
      assert.match(bs(result, "alice"), /receiveInteger\("bob", "top_1"\)/);
      assert.match(bs(result, "bob"), /receiveInteger\("alice", "top_0"\)/);
      assert.match(bs(result, "bob"), /sendInteger\("alice", "top_1", b\)/);
    });

    it("supports comm statements on existing variables", () => {
      const result = compile(`
let x: integer@alice = 1@alice;
let y: integer@bob = 0@bob;
y <- x;
`);
      expectSuccess(result);
      assert.equal(
        bs(result, "alice"),
        `let x: integer = 1;
sendInteger("bob", "top_0", x);`,
      );
      assert.equal(
        bs(result, "bob"),
        `let y: integer = 0;
y = receiveInteger("alice", "top_0");`,
      );
    });

    it("uses function-scoped comm tags inside choreography functions", () => {
      const result = compile(`
function worker(): void {
  let x: integer@alice = 1@alice;
  let y: integer@bob <- x;
  return;
}
worker();
`);
      expectSuccess(result);
      assert.match(bs(result, "alice"), /sendInteger\("bob", "worker_0", x\)/);
      assert.match(bs(result, "bob"), /receiveInteger\("alice", "worker_0"\)/);
      assert.doesNotMatch(bs(result, "alice"), /top_0/);
    });

    it("emits type-specific APIs for float and string", () => {
      const result = compile(`
let f: float@alice = 1.0@alice;
let g: float@bob <- f;
let m: string@alice = "hi"@alice;
let n: string@bob <- m;
`);
      expectSuccess(result);
      assert.match(bs(result, "alice"), /sendFloat\("bob", "top_0", f\)/);
      assert.match(bs(result, "bob"), /receiveFloat\("alice", "top_0"\)/);
      assert.match(bs(result, "alice"), /sendString\("bob", "top_1", m\)/);
      assert.match(bs(result, "bob"), /receiveString\("alice", "top_1"\)/);
      assertNoChoreoSyntax(bs(result, "alice"));
      assertNoChoreoSyntax(bs(result, "bob"));
    });
  });

  describe("void projection (spec §7.3, §12.2)", () => {
    it("keeps a void return type at every endpoint, never absent", () => {
      // A void return type used to carry a location, so at an endpoint it did
      // not reside at, the signature projected to `null` while the body kept a
      // bare `return;` — invalid BlueScript.
      const result = compile(`
function g(): void {
  return;
}
g();
`);
      expectSuccess(result);
      for (const endpoint of ["alice", "bob"]) {
        assert.match(bs(result, endpoint), /function g\(\): void \{/);
        assert.doesNotMatch(bs(result, endpoint), /function g\(\): null/);
      }
    });
  });

  describe("choreography vs local functions (spec §10.1, §12.11)", () => {
    it("emits a choreography function at every endpoint", () => {
      const result = compile(`
function pick(c: boolean@every): integer@alice {
  if (c) {
    return 1@alice;
  } else {
    return 0@alice;
  }
}
let c: boolean@every = true@every;
let x: integer@alice = pick(c);
`);
      expectSuccess(result);
      assert.match(bs(result, "alice"), /function pick\(/);
      assert.match(bs(result, "bob"), /function pick\(/);
    });

    it("emits a local function only at its own endpoint, and nothings the call elsewhere", () => {
      const result = compile(`
function add@alice(a: integer@alice, b: integer@alice): integer@alice {
  return a + b;
}
let x: integer@alice = add(1@alice, 2@alice);
`);
      expectSuccess(result);
      assert.match(bs(result, "alice"), /function add\(/);
      assert.doesNotMatch(bs(result, "bob"), /function add\(/);
      assert.equal(bs(result, "bob"), "");
    });
  });

  describe("transfer operator (spec §7.8, §11)", () => {
    it("makes a scalar transfer between the same individual location a local copy", () => {
      const result = compile(`
let x: integer@alice = 1@alice;
let y: integer@alice <- x;
`);
      expectSuccess(result);
      assert.match(bs(result, "alice"), /let y: integer = x;/);
      assert.doesNotMatch(bs(result, "alice"), /send|receive|broadcast/);
      assert.equal(bs(result, "bob"), "");
    });

    it("makes an array transfer between the same individual location a fresh copy", () => {
      const result = compile(`
let xs: float[]@alice = [1.1, 2.2]@alice;
let ys: float[]@alice <- xs;
`);
      expectSuccess(result);
      assert.match(bs(result, "alice"), /let ys: float\[\] = cloneFloatArray\(xs\);/);
      assert.doesNotMatch(bs(result, "alice"), /send|receive|broadcast/);
    });

    it("emits an @every to @every transfer as a local copy at every endpoint", () => {
      const result = compile(`
let a: integer@every = 1@every;
let b: integer@every <- a;
`);
      expectSuccess(result);
      for (const endpoint of ["alice", "bob"]) {
        assert.match(bs(result, endpoint), /let b: integer = a;/);
        assert.doesNotMatch(bs(result, endpoint), /send|receive|broadcast/);
      }
    });

    it("gives the broadcast sender its own fresh array copy (spec §11.3)", () => {
      const result = compile(`
let ys: float[]@every = [0.0]@every;
let xs: float[]@alice = [1.1, 2.2]@alice;
ys <- xs;
`);
      expectSuccess(result);
      const alice = bs(result, "alice");
      assert.match(alice, /broadcastFloatArray\("top_0", xs\);/);
      // The sender must not alias `xs`; it clones like every receiver does.
      assert.match(alice, /ys = cloneFloatArray\(xs\);/);
      assert.match(bs(result, "bob"), /ys = receiveFloatArray\("alice", "top_0"\);/);
    });

    it("widens integer to float across a transfer (spec §7.8)", () => {
      const result = compile(`
let n: integer@alice = 3@alice;
let m: float@bob <- n;
`);
      expectSuccess(result);
      assert.match(bs(result, "alice"), /sendFloat\("bob", "top_0", n\);/);
      assert.match(bs(result, "bob"), /let m: float = receiveFloat\("alice", "top_0"\);/);
    });
  });

  describe("@every residency vs location matching (spec §7.6, §12.2)", () => {
    it("projects an @every value to every endpoint even though it is not usable as @alice", () => {
      const result = compile(`
let c: boolean@every = true@every;
let d: boolean@alice <- c;
`);
      expectSuccess(result);
      // residesAt: the @every binding is emitted at both endpoints...
      assert.match(bs(result, "alice"), /let c: boolean = true;/);
      assert.match(bs(result, "bob"), /let c: boolean = true;/);
      // ...but the copy to @alice is a local copy, only at alice, with no tag.
      assert.match(bs(result, "alice"), /let d: boolean = c;/);
      assert.doesNotMatch(bs(result, "bob"), /let d/);
      assert.doesNotMatch(bs(result, "alice"), /send|receive|broadcast/);
    });
  });

  describe("functions and scoping", () => {
    it("emits alice call and empty bob after cleanup for add(10@alice) (spec §10.2, §13.9)", () => {
      const result = compile(`
function add@alice(a: integer@alice) {
  return a;
}
add(10@alice);
`);
      expectSuccess(result);
      assert.match(bs(result, "alice"), /function add\(a: integer\): integer/);
      assert.match(bs(result, "alice"), /add\(10\);/);
      assert.equal(bs(result, "bob"), "");
    });

    it("allows forward reference via function hoisting (spec §6.3)", () => {
      const result = compile(`
let x: integer@alice = f();
function f@alice(): integer@alice {
  return 1@alice;
}
`);
      expectSuccess(result);
      assert.match(bs(result, "alice"), /let x: integer = f\(\)/);
      assert.match(bs(result, "alice"), /function f\(/);
    });

    it("rejects duplicate let in the same block (spec §6.4)", () => {
      const result = compile(`
let x: integer@alice = 1@alice;
let x: integer@alice = 2@alice;
`);
      expectFailure(result);
      assert.ok(
        result.errors.some((e) => e.message.includes("already defined")),
      );
    });
  });

  describe("config and output files", () => {
    it("emits one .bs file per configured endpoint", () => {
      const result = compile(
        `let x: integer@alice = 1@alice;`,
        { endpoints: ["alice", "bob", "carol"] },
      );
      expectSuccess(result);
      assert.equal(result.outputs.length, 3);
      assert.deepEqual(
        result.outputs.map((o) => o.endpoint).sort(),
        ["alice", "bob", "carol"],
      );
      assert.match(bs(result, "alice"), /let x: integer = 1/);
      assert.equal(bs(result, "bob"), "");
      assert.equal(bs(result, "carol"), "");
    });

    it("names outputs index_<endpoint>.bs next to the source file", () => {
      const result = compile(`let x: integer@alice = 1@alice;`, aliceBob, "prog.cbs");
      expectSuccess(result);
      const alice = result.outputs.find((o) => o.endpoint === "alice");
      assert.ok(alice?.path.endsWith("prog_alice.bs"));
    });

    it("compileFile reads choreobs.json and writes .bs to disk", () => {
      const dir = mkdtempSync(join(tmpdir(), "choreobs-integ-"));
      try {
        const cbsPath = join(dir, "index.cbs");
        const configPath = join(dir, "choreobs.json");
        writeFileSync(
          cbsPath,
          `let x: integer@alice = 1@alice;\nlet y: integer@bob <- x;\n`,
          "utf8",
        );
        writeFileSync(
          configPath,
          JSON.stringify({ endpoints: ["alice", "bob"] }),
          "utf8",
        );

        const result = compileFile(cbsPath);
        expectSuccess(result);
        writeOutputs(result.outputs);

        const aliceBs = readFileSync(join(dir, "index_alice.bs"), "utf8");
        const bobBs = readFileSync(join(dir, "index_bob.bs"), "utf8");
        assert.match(aliceBs, /sendInteger\("bob", "top_0", x\)/);
        assert.match(bobBs, /receiveInteger\("alice", "top_0"\)/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("fails when choreobs.json is missing", () => {
      const dir = mkdtempSync(join(tmpdir(), "choreobs-integ-"));
      try {
        const cbsPath = join(dir, "solo.cbs");
        writeFileSync(cbsPath, `let x: integer@alice = 1@alice;`, "utf8");
        const result = compileFile(cbsPath);
        expectFailure(result);
        assert.ok(result.errors.some((e) => e.message.includes("choreobs.json")));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("invalid programs — full pipeline", () => {
    it("§16.2 rejects every as a config endpoint", () => {
      const result = compile(`let x: integer@alice = 1@alice;`, {
        endpoints: ["alice", "every"],
      });
      expectFailure(result);
      assert.ok(result.errors.some((e) => e.message.includes("every")));
    });

    it("§16.5 rejects uninitialized let", () => {
      const result = compile(`let x: integer@alice;`);
      expectFailure(result);
      assert.ok(
        result.errors.some((e) => e.message.includes("uninitialized")),
      );
    });

    it("§16.6 rejects type mismatch", () => {
      const result = compile(`let x: integer@alice = "a"@alice;`);
      expectFailure(result);
      assert.ok(result.errors.some((e) => e.message.includes("cannot assign")));
    });

    it("§16.14 rejects recursive choreography functions", () => {
      const result = compile(`
function f(): void {
  f();
  return;
}
`);
      expectFailure(result);
      assert.ok(result.errors.some((e) => e.message.includes("recursive")));
    });

    it("§16.15 rejects duplicate function names", () => {
      const result = compile(`
function f@alice(): void { return; }
function f@bob(): void { return; }
`);
      expectFailure(result);
      assert.ok(result.errors.some((e) => e.message.includes("duplicate function")));
    });

    it("§16.16 rejects break", () => {
      const result = compile(`
while (true@every) {
  break;
}
`);
      expectFailure(result);
      assert.ok(result.errors.some((e) => e.message.includes("break")));
    });

    it("§16.17 rejects == and != at lex time", () => {
      const result = compile(`
let x: integer@alice = 1@alice;
let y: integer@alice = 2@alice;
x == y;
`);
      expectFailure(result);
      assert.ok(result.errors.some((e) => e.message.includes("===")));
    });

    it("§16.10 rejects while with non-@every condition", () => {
      const result = compile(`
function f(): void {
  while (true@alice) {
    return;
  }
}
`);
      expectFailure(result);
      assert.ok(result.errors.some((e) => e.message.includes("boolean@every")));
    });

    it("§16.11 rejects for with non-@every condition in a choreography function", () => {
      const result = compile(`
function f(): void {
  for (let i: integer@alice = 0@alice; i < 10@alice; i = i + 1@alice) {
    return;
  }
}
`);
      expectFailure(result);
      assert.ok(result.errors.some((e) => e.message.includes("boolean@every")));
    });

    it("§10.1 allows transfers inside local functions as local copies", () => {
      const result = compile(`
function f@alice(): integer@alice {
  let xs: float[]@alice = [1.1, 2.2]@alice;
  let ys: float[]@alice <- xs;
  return length(ys);
}
let n: integer@alice = f();
`);
      expectSuccess(result);
      // A transfer at one location is a fresh copy, and emits no communication.
      assert.match(bs(result, "alice"), /let ys: float\[\] = cloneFloatArray\(xs\);/);
      assert.doesNotMatch(bs(result, "alice"), /send|receive|broadcast/);
    });

    it("stops before EPP when parse fails", () => {
      const result = compile(`let x integer@alice = 1@alice;`);
      expectFailure(result);
      assert.ok(result.errors.some((e) => "message" in e));
    });
  });

  describe("control-flow edge cases", () => {
    it("nested if with @every condition and bob-only binding", () => {
      const result = compile(`
let flag: boolean@every = true@every;
if (flag) {
  if (flag) {
    let z: integer@bob = 0@bob;
  }
}
`);
      expectSuccess(result);
      assert.match(bs(result, "bob"), /let z: integer = 0/);
      assert.doesNotMatch(bs(result, "alice"), /let z/);
    });

    it("assigns @every values without communication (spec §7.8)", () => {
      const result = compile(`
let a: integer@every = 1@every;
let b: integer@every = a;
`);
      expectSuccess(result);
      assert.match(bs(result, "alice"), /let a: integer = 1/);
      assert.match(bs(result, "alice"), /let b: integer = a/);
      assert.doesNotMatch(bs(result, "alice"), /sendInteger|receiveInteger/);
    });

    it("while with false@every condition projects on all endpoints", () => {
      const result = compile(`
let n: integer@every = 0@every;
while (false@every) {
  n = n + 1@every;
}
`);
      expectSuccess(result);
      assert.match(bs(result, "alice"), /let n: integer = 0/);
      assert.match(bs(result, "alice"), /while \(false\)/);
      assert.match(bs(result, "alice"), /n = n \+ 1/);
      assert.match(bs(result, "bob"), /while \(false\)/);
    });
  });

  describe("mutable array integration", () => {
    it("compiles array operations and communication", () => {
      const result = compile(`
let xs: integer[]@alice = [1, 2, 3]@alice;
xs[1@alice] = 10@alice;
push(xs, 20@alice);
let n: integer@alice = length(xs);
let ys: integer[]@bob <- xs;
`);
      expectSuccess(result);
      assert.match(bs(result, "alice"), /sendIntegerArray\("bob", "top_0", xs\)/);
      assert.match(bs(result, "bob"), /receiveIntegerArray\("alice", "top_0"\)/);
    });

    it("rejects assigning @every array to individual-location array", () => {
      const result = compile(`
let xs: integer[]@every = [1, 2, 3]@every;
let ys: integer[]@alice = xs;
`);
      expectFailure(result);
      assert.ok(
        result.errors.some((e) =>
          e.message.includes("invalid assignment across locations"),
        ),
        JSON.stringify(result.errors),
      );
    });
  });
});

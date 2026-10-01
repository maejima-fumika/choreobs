import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  compileFile,
  writeOutputs,
} from "../../src/driver/index.js";
import { aliceBob } from "../support/config.js";
import {
  compile,
  bs,
  expectSuccess,
  expectFailure,
  assertNoChoreoResidue,
} from "../support/compile.js";

describe("integration — compile pipeline", () => {
  describe("communication edge cases", () => {
    it("assigns increasing top-level comm tags (__top_0, __top_1, …)", () => {
      const result = compile(`
let a: integer@alice = 1@alice;
let b: integer@bob <- a;
let c: integer@alice = 0@alice;
c <- b;
`);
      expectSuccess(result);
      assert.match(bs(result, "alice"), /sendInteger\("bob", "__top_0", a\)/);
      assert.match(bs(result, "alice"), /receiveInteger\("bob", "__top_1"\)/);
      assert.match(bs(result, "bob"), /receiveInteger\("alice", "__top_0"\)/);
      assert.match(bs(result, "bob"), /sendInteger\("alice", "__top_1", b\)/);
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
sendInteger("bob", "__top_0", x);`,
      );
      assert.equal(
        bs(result, "bob"),
        `let y: integer = 0;
y = receiveInteger("alice", "__top_0");`,
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
      assert.doesNotMatch(bs(result, "alice"), /__top_0/);
    });

    it("emits type-specific APIs for float and string", () => {
      const result = compile(`
let f: float@alice = 1.0@alice;
let g: float@bob <- f;
let m: string@alice = "hi"@alice;
let n: string@bob <- m;
`);
      expectSuccess(result);
      assert.match(bs(result, "alice"), /sendFloat\("bob", "__top_0", f\)/);
      assert.match(bs(result, "bob"), /receiveFloat\("alice", "__top_0"\)/);
      assert.match(bs(result, "alice"), /sendString\("bob", "__top_1", m\)/);
      assert.match(bs(result, "bob"), /receiveString\("alice", "__top_1"\)/);
      assertNoChoreoResidue(bs(result, "alice"));
      assertNoChoreoResidue(bs(result, "bob"));
    });
  });

  describe("void projection (spec §void, §type-projection)", () => {
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

  describe("choreography vs local functions (spec §function-kinds, §function-projection)", () => {
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

  describe("transfer operator (spec §transfer-typing, §transfer-semantics)", () => {
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
      assert.match(bs(result, "alice"), /let ys: any\[\] = copyArray\(xs\);/);
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

    it("gives the broadcast sender its own fresh array copy (spec §broadcast-communication)", () => {
      const result = compile(`
let ys: float[]@every = [0.0]@every;
let xs: float[]@alice = [1.1, 2.2]@alice;
ys <- xs;
`);
      expectSuccess(result);
      const alice = bs(result, "alice");
      assert.match(alice, /broadcastArray\("__top_0", xs\);/);
      // The sender must not alias `xs`; it copies like every receiver does.
      assert.match(alice, /ys = copyArray\(xs\);/);
      assert.match(bs(result, "bob"), /ys = receiveArray\("alice", "__top_0"\);/);
    });

    it("converts at the sender when the source is a conversion (spec §numeric-conversion)", () => {
      const result = compile(`
let n: integer@alice = 3@alice;
let m: float@bob <- n as float;
`);
      expectSuccess(result);
      assert.match(bs(result, "alice"), /sendFloat\("bob", "__top_0", \(\(n as integer\) as float\)\);/);
      assert.equal(bs(result, "bob"), `let m: float = receiveFloat("alice", "__top_0");`);
    });
  });

  describe("numeric conversion projection (spec §numeric-conversion-projection)", () => {
    it("keeps `as` where the value resides and emits nothing of it elsewhere", () => {
      const result = compile(`
function relay(v: integer@alice): integer@alice {
    let w: integer@bob <- v;
    let back: integer@alice <- w;
    return back;
}

let n: integer@alice = 3@alice;
let x: float@alice = n as float;
let y: float@alice = relay(n) as float;
`);
      expectSuccess(result);
      const alice = bs(result, "alice");
      assert.match(alice, /let x: float = \(\(n as integer\) as float\);/);
      assert.match(alice, /let y: float = \(\(relay\(n\) as integer\) as float\);/);
      const bob = bs(result, "bob");
      // Only the call survives, bare: no `as`, and no `nothing(...)` around it,
      // unlike a unary operator (spec §binary-and-unary-operation-projection).
      assert.match(bob, /^relay\(null\);$/m);
      assert.doesNotMatch(bob, / as /);
      assert.doesNotMatch(bob, /nothing/);
    });

    it("does not double parentheses the source already wrote", () => {
      const result = compile(`
let n: integer@alice = 3@alice;
let x: float@alice = 1.5@alice + (n as float);
let y: float@alice = x as integer + 1@alice as float;
`);
      expectSuccess(result);
      const alice = bs(result, "alice");
      assert.match(alice, /let x: float = 1\.5 \+ \(\(n as integer\) as float\);/);
      assert.match(alice, /let y: float = \(\(\(\(x as float\) as integer\) \+ 1 as integer\) as float\);/);
    });
  });

  describe("@every residency vs location matching (spec §location-matching-and-residency, §type-projection)", () => {
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
    it("emits alice call and empty bob after cleanup for add(10@alice) (spec §calling-local-from-choreography, §projected-ast-cleanup)", () => {
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

    it("allows forward reference via function hoisting (spec §function-declaration-hoisting)", () => {
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

    it("rejects duplicate let in the same block (spec §variable-scope)", () => {
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
        assert.match(aliceBs, /sendInteger\("bob", "__top_0", x\)/);
        assert.match(bobBs, /receiveInteger\("alice", "__top_0"\)/);
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
    it("§using-every-as-an-endpoint rejects every as a config endpoint", () => {
      const result = compile(`let x: integer@alice = 1@alice;`, {
        endpoints: ["alice", "every"],
      });
      expectFailure(result);
      assert.ok(
        result.errors.some((e) =>
          e.message.includes("must not appear in endpoints"),
        ),
        JSON.stringify(result.errors),
      );
    });

    it("§uninitialized-let rejects uninitialized let", () => {
      const result = compile(`let x: integer@alice;`);
      expectFailure(result);
      assert.ok(
        result.errors.some((e) => e.message.includes("uninitialized")),
      );
    });

    it("§type-mismatch rejects type mismatch", () => {
      const result = compile(`let x: integer@alice = "a"@alice;`);
      expectFailure(result);
      assert.ok(result.errors.some((e) => e.message.includes("cannot assign")));
    });

    it("§recursive-choreography-function rejects recursive choreography functions", () => {
      const result = compile(`
function f(): void {
  f();
  return;
}
`);
      expectFailure(result);
      assert.ok(result.errors.some((e) => e.message.includes("recursive")));
    });

    it("§function-overloading rejects duplicate function names", () => {
      const result = compile(`
function f@alice(): void { return; }
function f@bob(): void { return; }
`);
      expectFailure(result);
      assert.ok(result.errors.some((e) => e.message.includes("duplicate function")));
    });

    it("§err-break-and-continue rejects break", () => {
      const result = compile(`
while (true@every) {
  break;
}
`);
      expectFailure(result);
      assert.ok(result.errors.some((e) => e.message.includes("break")));
    });

    it("§unsupported-equality-operators rejects == and != at lex time", () => {
      const result = compile(`
let x: integer@alice = 1@alice;
let y: integer@alice = 2@alice;
x == y;
`);
      expectFailure(result);
      assert.ok(result.errors.some((e) => e.message.includes("===")));
    });

    it("§invalid-while-condition rejects while with non-@every condition", () => {
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

    it("§invalid-for-condition rejects for with non-@every condition in a choreography function", () => {
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

    it("§function-kinds allows transfers inside local functions as local copies", () => {
      const result = compile(`
function f@alice(): integer@alice {
  let xs: float[]@alice = [1.1, 2.2]@alice;
  let ys: float[]@alice <- xs;
  return ys.length;
}
let n: integer@alice = f();
`);
      expectSuccess(result);
      // A transfer at one location is a fresh copy, and emits no communication.
      assert.match(bs(result, "alice"), /let ys: any\[\] = copyArray\(xs\);/);
      assert.doesNotMatch(bs(result, "alice"), /send|receive|broadcast/);
    });

    it("§transfer-typing transfers a null value through the null communication API", () => {
      const result = compile(`
let x: null@alice = null@alice;
let y: null@bob <- x;
`);
      expectSuccess(result);
      assert.match(bs(result, "alice"), /sendNull\("bob", "__top_0", x\);/);
      assert.match(bs(result, "bob"), /let y: null = receiveNull\("alice", "__top_0"\);/);
      // Regression: `null` used to fall back to the integer channel.
      assert.doesNotMatch(bs(result, "alice"), /sendInteger/);
      assert.doesNotMatch(bs(result, "bob"), /receiveInteger/);
    });

    it("§transfer-typing broadcasts a null value through the null communication API", () => {
      const result = compile(`
let x: null@alice = null@alice;
let y: null@every <- x;
`);
      expectSuccess(result);
      assert.match(bs(result, "alice"), /broadcastNull\("__top_0", x\);/);
      assert.match(bs(result, "bob"), /receiveNull\("alice", "__top_0"\)/);
    });

    it("§choreobs-json rejects a duplicate endpoint name", () => {
      const result = compile(`let x: integer@alice = 1@alice;`, {
        endpoints: ["alice", "alice", "bob"],
      });
      expectFailure(result);
      assert.ok(
        result.errors.some((e) => e.message.includes("duplicate endpoint 'alice'")),
        JSON.stringify(result.errors),
      );
    });

    it("§communication-tags reserves the top-level scope name, so a function named 'top' gets its own series", () => {
      const result = compile(`
function top(): void {
  let a: integer@alice = 1@alice;
  let b: integer@bob <- a;
  return;
}
let x: integer@alice = 2@alice;
let y: integer@bob <- x;
top();
`);
      expectSuccess(result);
      const alice = bs(result, "alice");
      const tags = [...alice.matchAll(/"((?:__)?top_\d+)"/g)].map((m) => m[1]);
      // The function is numbered in scope `top`, the top level in the reserved
      // `__top` — two series that cannot run into each other.
      assert.deepEqual(tags.slice().sort(), ["__top_0", "top_0"]);
      assert.equal(new Set(tags).size, tags.length, `tags collided: ${tags.join(", ")}`);
    });

    it("§transfer-typing evaluates a broadcast source exactly once at the sender", () => {
      const result = compile(`
function nextValue(): integer@alice { return 1@alice; }
let n: integer@every <- nextValue();
`);
      expectSuccess(result);
      const alice = bs(result, "alice");
      // Two calls would broadcast one value and keep another. Count call sites
      // only — the declaration header mentions the name as well.
      const calls = alice
        .split("\n")
        .filter((l) => l.includes("nextValue()") && !l.startsWith("function"));
      assert.equal(calls.length, 1, alice);
      assert.match(alice, /let __transfer_0: integer = nextValue\(\);/);
      assert.match(alice, /broadcastInteger\("__top_0", __transfer_0\);/);
      assert.match(alice, /let n: integer = __transfer_0;/);
    });

    it("§transfer-typing copies the same array it broadcasts", () => {
      const result = compile(`
function makeArray(): integer[]@alice { return [1, 2]@alice; }
let xs: integer[]@every <- makeArray();
`);
      expectSuccess(result);
      const alice = bs(result, "alice");
      const calls = alice
        .split("\n")
        .filter((l) => l.includes("makeArray()") && !l.startsWith("function"));
      assert.equal(calls.length, 1, alice);
      assert.match(alice, /broadcastArray\("__top_0", __transfer_0\);/);
      assert.match(alice, /let xs: any\[\] = copyArray\(__transfer_0\);/);
    });

    it("§transfer-typing uses a plain identifier source directly, with no temporary", () => {
      const result = compile(`
let plain: boolean@alice = true@alice;
let ok: boolean@every <- plain;
`);
      expectSuccess(result);
      const alice = bs(result, "alice");
      assert.match(alice, /broadcastBoolean\("__top_0", plain\);/);
      assert.doesNotMatch(alice, /__transfer/);
    });

    it("§function-names reserves the compiler's `__` identifier prefix", () => {
      const result = compile(`let __transfer_0: integer@alice = 1@alice;`);
      expectFailure(result);
      assert.ok(
        result.errors.some((e) => e.message.includes("reserved runtime name")),
        JSON.stringify(result.errors),
      );
    });

    it("compiles the array operations to the same BlueScript spelling", () => {
      const result = compile(`
function total@alice(ys: integer[]@alice): integer@alice {
  let sum: integer@alice = 0@alice;
  for (let i = 0@alice; i < ys.length; i = i + 1@alice) {
    sum = sum + ys[i];
  }
  return sum;
}
let xs: integer[]@alice = [1, 2]@alice;
xs.push(3@alice);
let n: integer@alice = xs.length;
let t: integer@alice = total(xs);
`);
      expectSuccess(result);
      // Source and output spell these the same way, so code generation for the
      // two array operations is the identity (spec §array-operation-code-generation).
      const alice = bs(result, "alice");
      assert.match(alice, /xs\.push\(3\);/);
      assert.match(alice, /let n: integer = xs\.length;/);
      assert.match(alice, /i < ys\.length;/);
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

    it("assigns @every values without communication (spec §transfer-typing)", () => {
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

  describe("print (spec §print-projection)", () => {
    it("compiles it to BlueScript's print at the endpoints that hold the value", () => {
      const result = compile(`
function show@alice(a: integer@alice): void {
  print(a);
}
let x: integer@alice = 10@alice;
print(x);
show(x);
let e: boolean@every = true@every;
print(e);
let xs: integer[]@alice = [1, 2]@alice;
print(xs);
`);
      expectSuccess(result);
      const alice = bs(result, "alice");
      assert.match(alice, /^ {2}print\(a\);$/m);
      assert.match(alice, /^print\(x\);$/m);
      assert.match(alice, /^print\(e\);$/m);
      assert.match(alice, /^print\(xs\);$/m);
      // bob holds only the `@every` value, and needs nothing from the runtime.
      assert.equal(bs(result, "bob"), "let e: boolean = true;\nprint(e);");
    });
  });

  describe("mutable array integration", () => {
    it("compiles array operations and communication", () => {
      const result = compile(`
let xs: integer[]@alice = [1, 2, 3]@alice;
xs[1@alice] = 10@alice;
xs.push(20@alice);
let n: integer@alice = xs.length;
let ys: integer[]@bob <- xs;
`);
      expectSuccess(result);
      assert.match(bs(result, "alice"), /sendArray\("bob", "__top_0", xs\)/);
      assert.match(bs(result, "bob"), /receiveArray\("alice", "__top_0"\)/);
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

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bs, compile, expectSuccess } from "../support/compile.js";

/**
 * A `const` projects as a `let` does and keeps its keyword in the output
 * (spec §const-statement, §let-projection). Bindings EPP makes itself stay `let`.
 */
describe("const in the generated BlueScript (spec §let-projection)", () => {
  it("§let-projection keeps the keyword on both sides of a direct transfer", () => {
    const result = compile(`
const x = 1@alice;
const y: integer@bob <- x;
`);
    expectSuccess(result);
    assert.equal(
      bs(result, "alice"),
      `const x: integer = 1;
sendInteger("bob", "__top_0", x);`,
    );
    assert.equal(bs(result, "bob"), `const y: integer = receiveInteger("alice", "__top_0");`);
  });

  it("keeps it at the broadcaster's own copy and at every receiver", () => {
    const result = compile(`
const s = 5@alice;
const e: integer@every <- s;
`);
    expectSuccess(result);
    assert.equal(
      bs(result, "alice"),
      `const s: integer = 5;
broadcastInteger("__top_0", s);
const e: integer = s;`,
    );
    assert.equal(bs(result, "bob"), `const e: integer = receiveInteger("alice", "__top_0");`);
  });

  it("declares the temporary of a broadcast with `let` (spec §single-evaluation-at-the-sender)", () => {
    const result = compile(`
function g@alice(): integer {
    return 1;
}
const e: integer@every <- g();
`);
    expectSuccess(result);
    const alice = bs(result, "alice");
    assert.match(alice, /^let __transfer_0: integer = g\(\);$/m);
    assert.match(alice, /^const e: integer = __transfer_0;$/m);
  });

  it("keeps it through a dynamic transfer, which lowering rewrites (spec §dynamic-transfer)", () => {
    const result = compile(`
const s = 5@alice;
const d: integer@dyn <- s;
`);
    expectSuccess(result);
    for (const endpoint of ["alice", "bob"]) {
      assert.match(bs(result, endpoint), /^const d: __DynVal = __dynTransfer\(/m, endpoint);
    }
  });

  it("keeps it on a transferred or copied array, whose elements stay mutable", () => {
    const result = compile(`
const xs: integer[]@alice = [1, 2]@alice;
xs[0@alice] = 10@alice;
xs.push(3@alice);
const ys: integer[]@bob <- xs;
const zs: integer[]@alice <- xs;
`);
    expectSuccess(result);
    const alice = bs(result, "alice");
    assert.match(alice, /^const xs: any\[\] = /m);
    assert.match(alice, /^xs\[0\] = 10;$/m);
    assert.match(alice, /^const zs: any\[\] = __copyArray\(xs\);$/m);
    assert.match(bs(result, "bob"), /^const ys: any\[\] = receiveArray\("alice", "__top_0"\);$/m);
  });

  it("keeps it inside functions", () => {
    const result = compile(`
function f@alice(n: integer): integer {
    const m = n + 1;
    return m;
}
function g(): void {
    const k: integer@bob = 2@bob;
}
`);
    expectSuccess(result);
    assert.match(bs(result, "alice"), /^ {2}const m: integer = n \+ 1;$/m);
    assert.match(bs(result, "bob"), /^ {2}const k: integer = 2;$/m);
  });

  it("leaves a `for` header's binding a `let`", () => {
    const result = compile(`
const n: integer@every = 3@every;
for (let i = 0@every; i < n; i = i + 1@every) {
}
`);
    expectSuccess(result);
    assert.match(bs(result, "alice"), /^const n: integer = 3;$/m);
    assert.match(bs(result, "alice"), /^for \(let i: integer = 0; /m);
  });
});

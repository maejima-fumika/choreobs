import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expectCheckError, expectChecks, letType } from "../support/check.js";
import { aliceBobStrict } from "../support/config.js";

/**
 * A `const` is a `let` whose variable is never stored into again
 * (spec §const-statement): no assignment, in a statement or a `for` header, and
 * no transfer statement may target it. Its array, if it holds one, stays mutable.
 */
const CONSTANT = { message: "because it is a constant", spec: "assignment-to-a-constant" } as const;

describe("const declarations (spec §const-statement)", () => {
  describe("what a `const` allows", () => {
    it("is read like a `let`", () => {
      expectChecks(`
const x: integer@alice = 1@alice;
let y: integer@alice = x + 1@alice;
`);
    });

    it("infers its type as a `let` does: there are no literal types", () => {
      const typed = expectChecks(`
const x = 1@alice;
const y: integer = 2@bob;
const z: integer@bob <- x;
`);
      assert.equal(letType(typed, "x"), "integer@alice");
      assert.equal(letType(typed, "y"), "integer@bob");
      assert.equal(letType(typed, "z"), "integer@bob");
    });

    it("may be declared by a transfer", () => {
      expectChecks(`
let x: integer@alice = 1@alice;
const y: integer@bob <- x;
const e: integer@every <- x;
const d: integer@dyn <- x;
`);
    });

    it("leaves its array mutable: element assignment and push (spec §array-types)", () => {
      expectChecks(`
const xs: integer[]@alice = [1, 2]@alice;
xs[0@alice] = 10@alice;
xs.push(3@alice);
const ys: integer[]@every = [1, 2]@every;
for (let i = 0@every; i < 2@every; ys[i] = i) {
    i = i + 1@every;
}
`);
    });

    it("is shadowed by an inner `let`, which may be assigned (spec §variable-scope)", () => {
      expectChecks(`
const x: integer@alice = 1@alice;
if (true@every) {
    let x: integer@alice = 2@alice;
    x = 3@alice;
}
`);
    });

    it("leaves an outer `let` of the same name assignable", () => {
      expectChecks(`
let x: integer@alice = 1@alice;
if (true@every) {
    const x: integer@alice = 2@alice;
}
x = 3@alice;
`);
    });

    it("takes the function's location in a local function, in strict mode too (spec §local-function-location-inference)", () => {
      expectChecks(`
function f@alice(n: integer): integer {
    const m = n + 1;
    return m;
}
`, aliceBobStrict);
    });

    it("may hold a `dyn` value (spec §dyn)", () => {
      expectChecks(`
const d: integer@dyn = 3@dyn;
let e: integer@dyn = d + 1@dyn;
`);
    });
  });

  describe("what a `const` rejects (spec §assignment-to-a-constant)", () => {
    it("rejects an assignment statement", () => {
      expectCheckError(`
const x: integer@alice = 1@alice;
x = 2@alice;
`, CONSTANT);
    });

    it("rejects a transfer statement", () => {
      expectCheckError(`
let x: integer@alice = 1@alice;
const y: integer@bob <- x;
y <- x;
`, CONSTANT);
    });

    it("rejects a dynamic transfer statement", () => {
      expectCheckError(`
let x: integer@alice = 1@alice;
const d: integer@dyn = 0@dyn;
d <- x;
`, CONSTANT);
    });

    it("rejects an assignment in a `for` initializer", () => {
      expectCheckError(`
const n: integer@every = 0@every;
for (n = 1@every; n < 10@every; ) {
}
`, CONSTANT);
    });

    it("rejects an assignment in a `for` update", () => {
      expectCheckError(`
const n: integer@every = 0@every;
for (let i = 0@every; i < 10@every; n = i) {
    i = i + 1@every;
}
`, CONSTANT);
    });

    it("rejects assigning an inner `const` that shadows an outer `let`", () => {
      expectCheckError(`
let x: integer@alice = 1@alice;
if (true@every) {
    const x: integer@alice = 2@alice;
    x = 3@alice;
}
`, CONSTANT);
    });

    it("rejects it inside a function, also while its return type is inferred (spec §function-return-type-inference)", () => {
      expectCheckError(`
function f@alice() {
    const x: integer = 1;
    x = 2;
    return x;
}
`, CONSTANT);
    });

    it("rejects it in a choreography function", () => {
      expectCheckError(`
function g(): void {
    const x: integer@alice = 1@alice;
    x = 2@alice;
}
`, CONSTANT);
    });

    it("still rejects a second declaration of the name in one scope (spec §variable-scope)", () => {
      expectCheckError(`
let x: integer@alice = 1@alice;
const x: integer@alice = 2@alice;
`, { message: "already defined", spec: "variable-scope" });
    });
  });
});

// A `const` a top-level statement declares is visible in function bodies,
// unlike a `let`: see top-level-constants.test.ts.

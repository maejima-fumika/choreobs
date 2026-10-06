import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expectCheckError, expectChecks, fnNamed } from "../support/check.js";
import { aliceBobStrict } from "../support/config.js";
import { formatLocatedType } from "../../src/types/located.js";

/**
 * Top-level constants (spec §top-level-let): a `const` a top-level statement
 * declares is visible in every function body, and no top-level statement may
 * call a function that reaches one declared by it or later
 * (spec §top-level-constant-initialization-order).
 */
const CONSTANT = { message: "because it is a constant", spec: "assignment-to-a-constant" } as const;
const TOO_EARLY = {
  message: "cannot be called here",
  spec: "constant-used-before-initialization",
} as const;
const NOT_USABLE = { message: "is not usable in local function", spec: "invalid-value-used-inside-local-function" } as const;

describe("top-level constants in function bodies (spec §top-level-let)", () => {
  describe("what a function sees", () => {
    it("reads one in a local function at its location, and at any location in a choreography function", () => {
      expectChecks(`
const a: integer@alice = 1@alice;
const e: integer@every = 2@every;
const d: integer@dyn = 3@dyn;
function f@alice(): integer {
    return a + 1;
}
function g(): integer@every {
    let x: integer@alice = a + f();
    let y: integer@dyn = d + 1@dyn;
    return e;
}
let r: integer@every = g();
`);
    });

    it("does not depend on where the function is declared (spec §function-declaration-hoisting)", () => {
      expectChecks(`
function f@alice(): integer@alice {
    return a;
}
const a: integer@alice = 1@alice;
let x: integer@alice = f();
`);
    });

    it("sees a constant declared by a transfer", () => {
      expectChecks(`
let x: integer@alice = 1@alice;
const y: integer@bob <- x;
function f@bob(): integer@bob {
    return y;
}
let z: integer@bob = f();
`);
    });

    it("assigns and pushes to the elements of a constant array, and reads its length (spec §const-statement)", () => {
      expectChecks(`
const xs: integer[]@alice = [1, 2]@alice;
const ys: integer[]@dyn = [1, 2]@dyn;
function f@alice(): integer {
    xs[0] = 10;
    xs.push(3);
    return xs.length;
}
function g(): void {
    ys[0@dyn] = 10@dyn;
    ys.push(3@dyn);
}
let n: integer@alice = f();
g();
`);
    });

    it("infers a return type from one, written in full or partly (spec §function-return-type-inference)", () => {
      const typed = expectChecks(`
const limit = 10@alice;
function cap() {
    return limit;
}
function capped(): integer {
    return limit;
}
let x: integer@alice = cap() + capped();
`);
      assert.equal(formatLocatedType(fnNamed(typed, "cap").returnType), "integer@alice");
      assert.equal(formatLocatedType(fnNamed(typed, "capped").returnType), "integer@alice");
    });

    it("infers it for a function nothing at top level calls", () => {
      const typed = expectChecks(`
function cap() {
    return limit;
}
const limit = 10@bob;
`);
      assert.equal(formatLocatedType(fnNamed(typed, "cap").returnType), "integer@bob");
    });

    it("is shadowed by a parameter and by a body `let`, which may be assigned (spec §variable-scope)", () => {
      expectChecks(`
const n: integer@alice = 1@alice;
function f@alice(n: integer@alice): integer@alice {
    n = n + 1@alice;
    return n;
}
function g@alice(): integer@alice {
    let n: integer@alice = 5@alice;
    n = 6@alice;
    return n;
}
let x: integer@alice = f(2@alice) + g();
`);
    });

    it("holds in strict mode too (spec §strict-mode)", () => {
      expectChecks(`
const limit: integer@alice = 10@alice;
function f@alice(x: integer): integer {
    if (x > limit) {
        return limit;
    }
    return x;
}
let y: integer@alice = f(20@alice);
`, aliceBobStrict);
    });

    it("does not see a `const` declared in a block of a top-level statement (spec §variable-scope)", () => {
      expectCheckError(`
if (true@every) {
    const a: integer@alice = 1@alice;
}
function f@alice(): integer@alice {
    return a;
}
`, { message: "undefined variable 'a'" });
    });

    it("still does not see a top-level `let`", () => {
      expectCheckError(`
let x: integer@alice = 1@alice;
function f@alice(): integer@alice {
    return x;
}
`, { message: "top-level variable", spec: "top-level-let" });
    });

    it("says so about a top-level `let` declared below the function too", () => {
      expectCheckError(`
function f@alice(): integer@alice {
    return x;
}
let x: integer@alice = 1@alice;
`, { message: "top-level variable", spec: "top-level-let" });
    });
  });

  describe("what a function may not do with one", () => {
    it("may not assign to it (spec §assignment-to-a-constant)", () => {
      expectCheckError(`
const x: integer@alice = 1@alice;
function f@alice(): void {
    x = 2@alice;
}
`, CONSTANT);
    });

    it("may not transfer into it", () => {
      expectCheckError(`
const x: integer@bob = 1@bob;
function f(y: integer@alice): void {
    x <- y;
}
`, CONSTANT);
    });

    it("may not use one at another endpoint in a local function (spec §local-function-strict-location-rule)", () => {
      expectCheckError(`
const a: integer@alice = 1@alice;
function f@bob(): integer@bob {
    return a;
}
`, NOT_USABLE);
    });

    it("may not use one at `every` in a local function", () => {
      expectCheckError(`
const e: integer@every = 1@every;
function f@bob(): integer@bob {
    return e;
}
`, NOT_USABLE);
    });

    it("may not use one at `dyn` in a local function, written or by omission (spec §dyn-in-a-local-function)", () => {
      for (const declaration of ["const d: integer@dyn = 1@dyn;", "const d = 1;"]) {
        expectCheckError(`
${declaration}
function f@bob(): integer@bob {
    return d;
}
`, { message: "is not usable in local function", spec: "dyn-in-a-local-function" });
      }
    });

    it("may not assign or push to the elements of one elsewhere, a `dyn` array included", () => {
      for (const use of ["xs[0@bob] = 3@bob;", "xs.push(3@bob);"]) {
        for (const location of ["alice", "every", "dyn"]) {
          expectCheckError(`
const xs: integer[]@${location} = [1, 2]@${location};
function f@bob(): void {
    ${use}
}
`, { message: "is not usable in local function" });
        }
      }
    });
  });

  describe("initialization order (spec §top-level-constant-initialization-order)", () => {
    it("rejects a call before the declaration of a constant the callee uses", () => {
      expectCheckError(`
let y: integer@alice = f();
const limit: integer@alice = 10@alice;
function f@alice(): integer@alice {
    return limit;
}
`, { ...TOO_EARLY, message: "'f' cannot be called here: it uses the top-level constant 'limit', which is declared later" });
    });

    it("rejects it while inferring the callee's return type", () => {
      expectCheckError(`
let y: integer@alice = f();
const limit: integer@alice = 10@alice;
function f@alice() {
    return limit;
}
`, { ...TOO_EARLY, message: "'f' cannot be called here: it uses the top-level constant 'limit', which is declared later" });
    });

    it("follows calls between functions, with return types written or inferred", () => {
      const message = "'f' cannot be called here: it uses the top-level constant 'limit' through 'g', which is declared later";
      expectCheckError(`
let y: integer@alice = f();
const limit: integer@alice = 10@alice;
function f@alice(): integer@alice {
    return g();
}
function g@alice(): integer@alice {
    return limit;
}
`, { ...TOO_EARLY, message });
      expectCheckError(`
let y: integer@alice = f();
const limit: integer@alice = 10@alice;
function f@alice() {
    return g();
}
function g@alice() {
    return limit;
}
`, { ...TOO_EARLY, message });
    });

    it("rejects a call in the constant's own initializer, a transfer's source included", () => {
      const message = "it uses the top-level constant 'limit', which this statement declares";
      expectCheckError(`
const limit: integer@alice = f();
function f@alice(): integer@alice {
    return limit + 1@alice;
}
`, { ...TOO_EARLY, message });
      expectCheckError(`
const limit = f();
function f@alice() {
    return limit + 1@alice;
}
`, { ...TOO_EARLY, message });
      expectCheckError(`
const limit: integer@bob <- f();
function f@bob(): integer@bob {
    return limit + 1@bob;
}
`, { ...TOO_EARLY, message });
    });

    it("rejects a call in a block of a top-level statement, even in a branch that does not run", () => {
      expectCheckError(`
let ready: boolean@every = false@every;
if (ready) {
    let y: integer@alice = f();
}
const limit: integer@alice = 10@alice;
function f@alice(): integer@alice {
    return limit;
}
`, TOO_EARLY);
    });

    it("rejects a call in a `for` header and in an argument", () => {
      expectCheckError(`
for (let i: integer@every = f(); i < 3@every; i = i + 1@every) {
}
const limit: integer@every = 10@every;
function f(): integer@every {
    return limit;
}
`, TOO_EARLY);
      expectCheckError(`
let y: integer@alice = id(f());
const limit: integer@alice = 10@alice;
function id@alice(x: integer@alice): integer@alice {
    return x;
}
function f@alice(): integer@alice {
    return limit;
}
`, { ...TOO_EARLY, message: "'f' cannot be called here" });
    });

    it("counts a use in a branch the callee would not take", () => {
      expectCheckError(`
let y: integer@alice = f(false@alice);
const limit: integer@alice = 10@alice;
function f@alice(c: boolean@alice): integer@alice {
    if (c) {
        return limit;
    }
    return 0@alice;
}
`, TOO_EARLY);
    });

    it("follows a recursive local function", () => {
      expectCheckError(`
let y: integer@alice = r(3@alice);
const limit: integer@alice = 10@alice;
function r@alice(n: integer@alice): integer@alice {
    if (n > 0@alice) {
        return r(n - 1@alice);
    }
    return limit;
}
`, TOO_EARLY);
    });

    it("accepts every call after the declaration, and calls between functions anywhere", () => {
      expectChecks(`
const a: integer@alice = 1@alice;
let x: integer@alice = f();
const b: integer@alice = g();
let y: integer@alice = h();
function h@alice(): integer@alice {
    return g() + b;
}
function g@alice(): integer@alice {
    return f() + 1@alice;
}
function f@alice(): integer@alice {
    return a;
}
function unused@alice(): integer@alice {
    return h() + c;
}
const c: integer@alice = 3@alice;
`);
    });

    it("leaves a function that uses no constant callable anywhere", () => {
      expectChecks(`
let y: integer@alice = f();
const limit: integer@alice = f();
function f@alice(): integer@alice {
    return 1@alice;
}
`);
    });
  });
});

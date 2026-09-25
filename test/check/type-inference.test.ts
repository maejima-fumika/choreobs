import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse } from "../../src/parser/index.js";
import { typeCheck } from "../../src/check/index.js";
import { checkSource } from "../support/pipeline.js";
import { assertCites, describeDiags } from "../support/spec.js";
import type { SpecId } from "../../src/spec/ref.js";


function expectTypeCheckSuccess(source: string) {
  const { typed, errors } = checkSource(source);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.ok(typed);
  return typed;
}

function expectTypeCheckFailure(
  source: string,
  messageIncludes: string | readonly string[],
) {
  const { typed, errors } = checkSource(source);
  assert.equal(typed, null);
  const needles =
    typeof messageIncludes === "string" ? [messageIncludes] : messageIncludes;
  assert.ok(
    needles.some((needle) => errors.some((e) => e.message.includes(needle))),
    `expected error containing one of ${JSON.stringify(needles)}: ${describeDiags(errors)}`,
  );
}

/** Rejected, and rejected for the rule named rather than for its wording. */
function expectSpecFailure(source: string, id: SpecId) {
  const { typed, errors } = checkSource(source);
  assert.equal(typed, null);
  assertCites(errors, id);
}

function functionDecl(typed: NonNullable<ReturnType<typeof typeCheck>["typed"]>, index: number) {
  const item = typed.items[index];
  assert.ok(item && "decl" in item, `expected function at index ${index}`);
  return item;
}

describe("type inference (spec §type-inference)", () => {
  describe("positive", () => {
    it("infers ordinary let from initializer (§let-type-inference)", () => {
      const typed = expectTypeCheckSuccess(`let x = 1@alice;`);
      const item = typed.items[0];
      if (
        item &&
        "statement" in item &&
        "choreoType" in item.statement &&
        item.statement.stmt.kind === "LetStatement"
      ) {
        assert.equal(item.statement.choreoType.base, "integer");
        if (item.statement.choreoType.location.kind === "individual") {
          assert.equal(item.statement.choreoType.location.name, "alice");
        }
      }
    });

    it("infers chained let bindings (§let-type-inference)", () => {
      const typed = expectTypeCheckSuccess(`
function f@alice(): void {
  let x = 1@alice;
  let y = x + 1@alice;
  return;
}
`);
      const fn = functionDecl(typed, 0);
      const [x, y] = fn.body.statements;
      if (
        x &&
        "stmt" in x &&
        "choreoType" in x &&
        x.stmt.kind === "LetStatement" &&
        y &&
        "stmt" in y &&
        "choreoType" in y &&
        y.stmt.kind === "LetStatement"
      ) {
        assert.equal(x.choreoType.base, "integer");
        assert.equal(y.choreoType.base, "integer");
      }
    });

    it("infers comparison result type (§let-type-inference, §operators)", () => {
      const typed = expectTypeCheckSuccess(`
function f@alice(): void {
  let x = 1@alice;
  let c = x < 10@alice;
  return;
}
`);
      const fn = functionDecl(typed, 0);
      const c = fn.body.statements[1];
      if (c && "stmt" in c && "choreoType" in c && c.stmt.kind === "LetStatement") {
        assert.equal(c.choreoType.base, "boolean");
        if (c.choreoType.location.kind === "individual") {
          assert.equal(c.choreoType.location.name, "alice");
        }
      }
    });

    it("infers let type in a local function from its initializer (§let-type-inference)", () => {
      const typed = expectTypeCheckSuccess(`
function f@alice(): integer@alice {
  let x = 1@alice;
  return x;
}
`);
      const fn = functionDecl(typed, 0);
      assert.equal(fn.returnType.base, "integer");
      const letStmt = fn.body.statements[0];
      if (
        letStmt &&
        "stmt" in letStmt &&
        "choreoType" in letStmt &&
        letStmt.stmt.kind === "LetStatement"
      ) {
        assert.equal(letStmt.choreoType.base, "integer");
        if (letStmt.choreoType.location.kind === "individual") {
          assert.equal(letStmt.choreoType.location.name, "alice");
        }
      }
    });

    it("infers for-loop let initializer type (§for-initializer-let-type-inference)", () => {
      const typed = expectTypeCheckSuccess(`
for (let i = 0@every; i < 3@every; i = i + 1@every) {
  let x: integer@alice <- i;
}
`);
      const item = typed.items[0];
      if (
        item &&
        "statement" in item &&
        "init" in item.statement &&
        item.statement.stmt.kind === "ForStatement"
      ) {
        const init = item.statement.init;
        if (
          init &&
          "init" in init &&
          "choreoType" in init &&
          init.init.kind === "ForLetInit"
        ) {
          assert.equal(init.choreoType.base, "integer");
          assert.equal(init.choreoType.location.kind, "every");
        }
      }
    });

    it("infers function return type from return expressions (§function-return-type-inference)", () => {
      const typed = expectTypeCheckSuccess(`
function add@alice(a: integer@alice, b: integer@alice) {
  return a + b;
}
`);
      const fn = functionDecl(typed, 0);
      assert.equal(fn.returnType.base, "integer");
      if (fn.returnType.location.kind === "individual") {
        assert.equal(fn.returnType.location.name, "alice");
      }
    });

    it("infers return type through inferred let binding (§let-type-inference, §function-return-type-inference)", () => {
      const typed = expectTypeCheckSuccess(`
function add@alice(a: integer@alice, b: integer@alice) {
  let c = a + b;
  return c;
}
`);
      const fn = functionDecl(typed, 0);
      assert.equal(fn.returnType.base, "integer");
      if (fn.returnType.location.kind === "individual") {
        assert.equal(fn.returnType.location.name, "alice");
      }
    });

    it("collects returns from nested blocks (§function-return-type-inference)", () => {
      const typed = expectTypeCheckSuccess(`
function f@alice(c: boolean@alice) {
  if (c) {
    if (c) {
      return 1.0@alice;
    } else {
      return 2.5@alice;
    }
  } else {
    return 3.0@alice;
  }
}
`);
      assert.equal(functionDecl(typed, 0).returnType.base, "float");
    });

    it("infers void return for empty body (§function-return-type-inference)", () => {
      const typed = expectTypeCheckSuccess(`function noop@alice() {}`);
      assert.equal(functionDecl(typed, 0).returnType.base, "void");
    });

    it("infers void return when all returns are bare (§function-return-type-inference)", () => {
      const typed = expectTypeCheckSuccess(`
function log@alice() {
  return;
}
`);
      assert.equal(functionDecl(typed, 0).returnType.base, "void");
    });

    it("rejects integer and float returns, which have no LUB (§function-return-type-inference)", () => {
      expectSpecFailure(`
function f@alice(c: boolean@alice) {
  if (c) {
    return 1@alice;
  } else {
    return 2.5@alice;
  }
}
`, "function-return-type-inference");
    });

    it("infers return type for choreography function binary at alice (§operators, §function-return-type-inference)", () => {
      const typed = expectTypeCheckSuccess(`
function add(a: integer@alice, b: integer@alice) {
  return a + b;
}
`);
      const fn = functionDecl(typed, 0);
      assert.equal(fn.returnType.base, "integer");
      if (fn.returnType.location.kind === "individual") {
        assert.equal(fn.returnType.location.name, "alice");
      }
    });

    it("accepts explicit alice return type for @every binary (§operators)", () => {
      expectTypeCheckSuccess(`
function add(a: integer@alice, b: integer@alice): integer@alice {
  return a + b;
}
`);
    });

    it("keeps @every return of alice value valid (§function-projection regression)", () => {
      expectTypeCheckSuccess(`
function add(a: integer@alice, b: integer@alice) {
  return a;
}
`);
    });

    it("sees transfer-let bindings while inferring the return type (§let-type-inference, §function-return-type-inference)", () => {
      // Return-type inference walks the body building its own scope; it used to
      // skip `let ... <- ...`, so the binding looked undefined at the return.
      const typed = expectTypeCheckSuccess(`
function f@alice() {
  let t: integer@alice <- 1@alice;
  return t;
}
`);
      assert.equal(functionDecl(typed, 0).returnType.base, "integer");
    });

    it("sees transfer-let bindings in a choreography function (§function-return-type-inference)", () => {
      const typed = expectTypeCheckSuccess(`
function f() {
  let t: integer@alice <- 1@alice;
  let u: integer@alice = t;
  return u;
}
`);
      assert.equal(functionDecl(typed, 0).returnType.base, "integer");
    });

    it("resolves a dependency chain of omitted return types (§function-return-type-inference)", () => {
      const typed = expectTypeCheckSuccess(`
function g@alice() { return 1@alice; }
function f@alice() { return g() + 1@alice; }
let r: integer@alice = f();
`);
      assert.equal(functionDecl(typed, 0).returnType.base, "integer");
      assert.equal(functionDecl(typed, 1).returnType.base, "integer");
    });

    it("resolves that chain regardless of declaration order (§function-return-type-inference)", () => {
      // `f` is declared before the `g` it depends on, so inference has to
      // defer it and come back — the reason the resolution loop iterates.
      const typed = expectTypeCheckSuccess(`
function f@alice() { return g() + 1@alice; }
function g@alice() { return 1@alice; }
let r: integer@alice = f();
`);
      assert.equal(functionDecl(typed, 0).returnType.base, "integer");
      assert.equal(functionDecl(typed, 1).returnType.base, "integer");
    });

    it("propagates along a chain of omitted return types (§function-return-type-inference)", () => {
      const typed = expectTypeCheckSuccess(`
function g@alice() { return 1.5@alice; }
function f@alice() { return g(); }
let r: float@alice = f();
`);
      assert.equal(functionDecl(typed, 1).returnType.base, "float");
    });

    it("allows explicit return type on recursive local function (§inference-and-recursion)", () => {
      expectTypeCheckSuccess(`
function fact@alice(n: integer@alice): integer@alice {
  if (n <= 1@alice) {
    return 1@alice;
  } else {
    return n * fact(n - 1@alice);
  }
}
`);
    });
  });

  describe("negative", () => {
    it("rejects transfer let without type annotation (§transfer-let-does-not-infer-destination-type)", () => {
      const { program, errors } = parse("let y <- x;");
      assert.equal(program, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("type annotation required for transfer let"),
        ),
      );
    });

    it("rejects top-level let when initializer omits location (§explicit-location-annotations)", () => {
      expectTypeCheckFailure("let x = 1;", "location");
    });

    it("rejects let in a choreography function when initializer omits location (§explicit-location-annotations)", () => {
      expectTypeCheckFailure(
        `
function f() {
  let x = 1;
}
`,
        "location",
      );
    });

    it("rejects function parameters without type annotations (§parameter-types-are-not-inferred)", () => {
      const { program, errors } = parse(`
function add@alice(a, b) {
  return a + b;
}
`);
      assert.equal(program, null);
      assert.ok(errors.some((e) => e.message.includes("expected ':' after parameter name")));
    });

    it("rejects mixed bare and value returns (§mixing-return-and-return-expr)", () => {
      expectSpecFailure(
        `
function bad@alice(c: boolean@alice) {
  if (c) {
    return 1@alice;
  }
  return;
}
`,
        "mixing-return-and-return-expr",
      );
    });

    it("rejects inferred non-void function without return coverage (§return-coverage-for-non-void-functions)", () => {
      expectSpecFailure(
        `
function bad@alice(c: boolean@alice) {
  if (c) {
    return 1@alice;
  }
}
`,
        "return-coverage-for-non-void-functions",
      );
    });

    it("rejects incompatible inferred return base types (§function-return-type-inference)", () => {
      expectTypeCheckFailure(
        `
function bad@alice(c: boolean@alice) {
  if (c) {
    return 1@alice;
  } else {
    return "one"@alice;
  }
}
`,
        "least upper bound",
      );
    });

    it("rejects incompatible inferred return locations (§function-return-type-inference)", () => {
      expectTypeCheckFailure(
        `
function bad(c: boolean@every) {
  if (c) {
    return 1@alice;
  } else {
    return 1@bob;
  }
}
`,
        "location",
      );
    });

    it("rejects @every binary with different individual operand locations (§operators)", () => {
      expectTypeCheckFailure(
        `
function bad(a: integer@alice, b: integer@bob) {
  return a + b;
}
`,
        "binary operands must be at the same location",
      );
    });

    it("reports a duplicate parameter, not a return-type conflict (§parameter-types-are-not-inferred)", () => {
      // Inference walks the body in the same scope the full check opens, so a
      // duplicate parameter is caught there rather than showing up later as
      // an incompatible least upper bound between the two parameter types.
      expectTypeCheckFailure(
        `function f@alice(a: integer@alice, a: boolean@alice) {
  if (a) { return 1@alice; } else { return a; }
}`,
        "duplicate parameter 'a'",
      );
    });

    it("rejects a void-valued let inside an inferred function (§invalid-use-of-void)", () => {
      expectTypeCheckFailure(
        `function g@alice(): void { return; }
function f@alice() { let x = g(); return 1@alice; }`,
        "expression produces no value",
      );
    });

    it("rejects an empty array let inside an inferred function (§cannot-infer-empty-array-element-type)", () => {
      expectTypeCheckFailure(
        `function f@alice() { let xs = []@alice; return 1@alice; }`,
        "cannot infer empty array element type",
      );
    });

    it("reports an undefined variable in a statement inference used to skip", () => {
      // Assignment statements bind nothing and hold no `return`, so the old
      // inference walk stepped over them entirely and their errors surfaced
      // only later, if at all.
      expectTypeCheckFailure(
        `function f@alice() { q = 1@alice; return 1@alice; }`,
        "undefined variable 'q'",
      );
    });

    it("checks conditions inside a function with an omitted return type", () => {
      expectTypeCheckFailure(
        `function f@alice() { if (1@alice) { return 1@alice; } return 2@alice; }`,
        "condition must have type boolean",
      );
    });

    it("rejects recursive local function with omitted return type (§inference-and-recursion)", () => {
      expectTypeCheckFailure(
        `
function fact@alice(n: integer@alice) {
  if (n <= 1@alice) {
    return 1@alice;
  } else {
    return n * fact(n - 1@alice);
  }
}
`,
        "omitted return type cannot be recursive",
      );
    });

    it("rejects indirect recursive local functions with omitted return types (§inference-and-recursion)", () => {
      const { typed, errors } = checkSource(`
function f@alice(n: integer@alice) {
  return g(n);
}
function g@alice(n: integer@alice) {
  return f(n);
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("omitted return type cannot be recursive"),
        ),
        JSON.stringify(errors),
      );
    });
  });

  describe("array inference", () => {
    it("infers located array literals", () => {
      const typed = expectTypeCheckSuccess(`
let xs = [1, 2, 3]@alice;
let ys = [1.0, 2.5]@alice;
let zs = [true, false]@alice;
`);
      const a = typed.items[0];
      const b = typed.items[1];
      const c = typed.items[2];
      if (a && "statement" in a && "choreoType" in a.statement) {
        assert.equal(a.statement.choreoType.isArray, true);
        assert.equal(a.statement.choreoType.base, "integer");
      }
      if (b && "statement" in b && "choreoType" in b.statement) {
        assert.equal(b.statement.choreoType.isArray, true);
        assert.equal(b.statement.choreoType.base, "float");
      }
      if (c && "statement" in c && "choreoType" in c.statement) {
        assert.equal(c.statement.choreoType.isArray, true);
        assert.equal(c.statement.choreoType.base, "boolean");
      }
    });
  });
});

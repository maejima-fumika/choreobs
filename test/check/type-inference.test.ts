import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse } from "../../src/parser/index.js";
import { typeCheck } from "../../src/check/index.js";
import { checkSource } from "../support/pipeline.js";


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
    `expected error containing one of ${JSON.stringify(needles)}: ${JSON.stringify(errors)}`,
  );
}

function functionDecl(typed: NonNullable<ReturnType<typeof typeCheck>["typed"]>, index: number) {
  const item = typed.items[index];
  assert.ok(item && "decl" in item, `expected function at index ${index}`);
  return item;
}

describe("type inference (spec §7.14)", () => {
  describe("positive", () => {
    it("infers ordinary let from initializer (§7.14.1)", () => {
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

    it("infers chained let bindings (§7.14.1)", () => {
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

    it("infers comparison result type (§7.14.1, §7.11)", () => {
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

    it("infers let type in a local function from its initializer (§7.14.1)", () => {
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

    it("infers for-loop let initializer type (§7.14.2)", () => {
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

    it("infers function return type from return expressions (§7.14.4)", () => {
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

    it("infers return type through inferred let binding (§7.14.1, §7.14.4)", () => {
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

    it("collects returns from nested blocks (§7.14.4)", () => {
      const typed = expectTypeCheckSuccess(`
function f@alice(c: boolean@alice) {
  if (c) {
    if (c) {
      return 1@alice;
    } else {
      return 2.5@alice;
    }
  } else {
    return 3@alice;
  }
}
`);
      assert.equal(functionDecl(typed, 0).returnType.base, "float");
    });

    it("infers void return for empty body (§7.14.4)", () => {
      const typed = expectTypeCheckSuccess(`function noop@alice() {}`);
      assert.equal(functionDecl(typed, 0).returnType.base, "void");
    });

    it("infers void return when all returns are bare (§7.14.4)", () => {
      const typed = expectTypeCheckSuccess(`
function log@alice() {
  return;
}
`);
      assert.equal(functionDecl(typed, 0).returnType.base, "void");
    });

    it("infers numeric LUB for conditional returns (§7.14.4)", () => {
      const typed = expectTypeCheckSuccess(`
function f@alice(c: boolean@alice) {
  if (c) {
    return 1@alice;
  } else {
    return 2.5@alice;
  }
}
`);
      assert.equal(functionDecl(typed, 0).returnType.base, "float");
    });

    it("infers return type for choreography function binary at alice (§7.11, §7.14.4)", () => {
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

    it("accepts explicit alice return type for @every binary (§7.11)", () => {
      expectTypeCheckSuccess(`
function add(a: integer@alice, b: integer@alice): integer@alice {
  return a + b;
}
`);
    });

    it("keeps @every return of alice value valid (§12.11 regression)", () => {
      expectTypeCheckSuccess(`
function add(a: integer@alice, b: integer@alice) {
  return a;
}
`);
    });

    it("sees transfer-let bindings while inferring the return type (§7.14.1, §7.14.4)", () => {
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

    it("sees transfer-let bindings in a choreography function (§7.14.4)", () => {
      const typed = expectTypeCheckSuccess(`
function f() {
  let t: integer@alice <- 1@alice;
  let u: integer@alice = t;
  return u;
}
`);
      assert.equal(functionDecl(typed, 0).returnType.base, "integer");
    });

    it("allows explicit return type on recursive local function (§7.14.8)", () => {
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
    it("rejects transfer let without type annotation (§7.14.3)", () => {
      const { program, errors } = parse("let y <- x;");
      assert.equal(program, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("type annotation required for transfer let"),
        ),
      );
    });

    it("rejects top-level let when initializer omits location (§8.1)", () => {
      expectTypeCheckFailure("let x = 1;", "location");
    });

    it("rejects let in a choreography function when initializer omits location (§8.1)", () => {
      expectTypeCheckFailure(
        `
function f() {
  let x = 1;
}
`,
        "location",
      );
    });

    it("rejects function parameters without type annotations (§7.14.7)", () => {
      const { program, errors } = parse(`
function add@alice(a, b) {
  return a + b;
}
`);
      assert.equal(program, null);
      assert.ok(errors.some((e) => e.message.includes("expected ':' after parameter name")));
    });

    it("rejects mixed bare and value returns (§7.14.5)", () => {
      expectTypeCheckFailure(
        `
function bad@alice(c: boolean@alice) {
  if (c) {
    return 1@alice;
  }
  return;
}
`,
        "§7.14.5",
      );
    });

    it("rejects inferred non-void function without return coverage (§7.14.6)", () => {
      expectTypeCheckFailure(
        `
function bad@alice(c: boolean@alice) {
  if (c) {
    return 1@alice;
  }
}
`,
        "§7.14.6",
      );
    });

    it("rejects incompatible inferred return base types (§7.14.4)", () => {
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

    it("rejects incompatible inferred return locations (§7.14.4)", () => {
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

    it("rejects @every binary with different individual operand locations (§7.11)", () => {
      expectTypeCheckFailure(
        `
function bad(a: integer@alice, b: integer@bob) {
  return a + b;
}
`,
        "binary operands must be at the same location",
      );
    });

    it("rejects recursive local function with omitted return type (§7.14.8)", () => {
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

    it("rejects indirect recursive local functions with omitted return types (§7.14.8)", () => {
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
let ys = [1, 2.5]@alice;
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

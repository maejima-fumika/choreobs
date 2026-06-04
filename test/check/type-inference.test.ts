import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse } from "../../src/parser/index.js";
import { typeCheck } from "../../src/check/index.js";
import type { ChoreoBSConfig } from "../../src/config/types.js";
import type { TypedFunctionDeclaration } from "../../src/ast/typed.js";

const aliceBob: ChoreoBSConfig = { participants: ["alice", "bob"] };

function checkSource(source: string, config: ChoreoBSConfig = aliceBob) {
  const { program, errors: parseErrors } = parse(source);
  assert.equal(parseErrors.length, 0, "parse errors: " + JSON.stringify(parseErrors));
  assert.ok(program);
  return typeCheck(program, config);
}

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
        if (item.statement.choreoType.location.kind === "concrete") {
          assert.equal(item.statement.choreoType.location.name, "alice");
        }
      }
    });

    it("infers chained let bindings (§7.14.1)", () => {
      const typed = expectTypeCheckSuccess(`
function f@alice(): unit {
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
function f@alice(): unit {
  let x = 1@alice;
  let c = x < 10@alice;
  return;
}
`);
      const fn = functionDecl(typed, 0);
      const c = fn.body.statements[1];
      if (c && "stmt" in c && "choreoType" in c && c.stmt.kind === "LetStatement") {
        assert.equal(c.choreoType.base, "boolean");
        if (c.choreoType.location.kind === "concrete") {
          assert.equal(c.choreoType.location.name, "alice");
        }
      }
    });

    it("infers let in local function with omitted literal location (§7.14.1, §8.1)", () => {
      const typed = expectTypeCheckSuccess(`
function f@alice(): integer {
  let x = 1;
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
        if (letStmt.choreoType.location.kind === "concrete") {
          assert.equal(letStmt.choreoType.location.name, "alice");
        }
      }
    });

    it("infers for-loop let initializer type (§7.14.2)", () => {
      const typed = expectTypeCheckSuccess(`
for (let i = 0@every; i < 3@every; i = i + 1@every) {
  let x: integer@alice = i;
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

    it("infers return type when body binds communication let before return (§7.14.3, §7.14.4)", () => {
      const typed = expectTypeCheckSuccess(`
function average@every(arr: integer[]) {
  let sum = 0@every;
  let len: integer@every <~ length(arr);
  return sum / len;
}
`);
      const fn = functionDecl(typed, 0);
      assert.equal(fn.returnType.base, "integer");
      assert.equal(fn.returnType.location.kind, "every");
    });

    it("infers function return type from return expressions (§7.14.4)", () => {
      const typed = expectTypeCheckSuccess(`
function add@alice(a: integer, b: integer) {
  return a + b;
}
`);
      const fn = functionDecl(typed, 0);
      assert.equal(fn.returnType.base, "integer");
      if (fn.returnType.location.kind === "concrete") {
        assert.equal(fn.returnType.location.name, "alice");
      }
    });

    it("infers return type through inferred let binding (§7.14.1, §7.14.4)", () => {
      const typed = expectTypeCheckSuccess(`
function add@alice(a: integer, b: integer) {
  let c = a + b;
  return c;
}
`);
      const fn = functionDecl(typed, 0);
      assert.equal(fn.returnType.base, "integer");
      if (fn.returnType.location.kind === "concrete") {
        assert.equal(fn.returnType.location.name, "alice");
      }
    });

    it("infers unit return for empty body (§7.14.4)", () => {
      const typed = expectTypeCheckSuccess(`function noop@alice() {}`);
      assert.equal(functionDecl(typed, 0).returnType.base, "unit");
    });

    it("infers unit return when all returns are bare (§7.14.4)", () => {
      const typed = expectTypeCheckSuccess(`
function log@alice() {
  return;
}
`);
      assert.equal(functionDecl(typed, 0).returnType.base, "unit");
    });

    it("infers numeric LUB for conditional returns (§7.14.4)", () => {
      const typed = expectTypeCheckSuccess(`
function f@alice(c: boolean) {
  if (c) {
    return 1;
  } else {
    return 2.5;
  }
}
`);
      assert.equal(functionDecl(typed, 0).returnType.base, "float");
    });

    it("infers return type for @every function binary at alice (§7.11, §7.14.4)", () => {
      const typed = expectTypeCheckSuccess(`
function add@every(a: integer@alice, b: integer@alice) {
  return a + b;
}
`);
      const fn = functionDecl(typed, 0);
      assert.equal(fn.returnType.base, "integer");
      if (fn.returnType.location.kind === "concrete") {
        assert.equal(fn.returnType.location.name, "alice");
      }
    });

    it("accepts explicit alice return type for @every binary (§7.11)", () => {
      expectTypeCheckSuccess(`
function add@every(a: integer@alice, b: integer@alice): integer@alice {
  return a + b;
}
`);
    });

    it("keeps @every return of alice value valid (§12.11 regression)", () => {
      expectTypeCheckSuccess(`
function add@every(a: integer@alice, b: integer@alice) {
  return a;
}
`);
    });

    it("allows explicit return type on recursive local function (§7.14.8)", () => {
      expectTypeCheckSuccess(`
function fact@alice(n: integer): integer {
  if (n <= 1) {
    return 1;
  } else {
    return n * fact(n - 1);
  }
}
`);
    });
  });

  describe("negative", () => {
    it("requires type annotation for communication let in local function (§7.14.3)", () => {
      expectTypeCheckFailure(
        `
function f@alice() {
  let y <~ x;
}
`,
        "type annotation required for communication let",
      );
    });

    it("infers top-level let with omitted location as @dynamic (§18.4, §18.5)", () => {
      const typed = expectTypeCheckSuccess("let x = 1;");
      const item = typed.items[0];
      if (
        item &&
        "statement" in item &&
        "choreoType" in item.statement &&
        item.statement.stmt.kind === "LetStatement"
      ) {
        assert.equal(item.statement.choreoType.base, "integer");
        assert.equal(item.statement.choreoType.location.kind, "dynamic");
      } else {
        assert.fail("expected top-level LetStatement");
      }
    });

    it("infers let in @every function with omitted location as @dynamic (§18.4, §18.5)", () => {
      expectTypeCheckSuccess(`
function f@every() {
  let x = 1;
}
`);
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
function bad@alice(c: boolean) {
  if (c) {
    return 1;
  }
  return;
}
`,
        "§7.14.5",
      );
    });

    it("rejects inferred non-unit function without return coverage (§7.14.6)", () => {
      expectTypeCheckFailure(
        `
function bad@alice(c: boolean) {
  if (c) {
    return 1;
  }
}
`,
        "§7.14.6",
      );
    });

    it("rejects incompatible inferred return base types (§7.14.4)", () => {
      expectTypeCheckFailure(
        `
function bad@alice(c: boolean) {
  if (c) {
    return 1;
  } else {
    return "one";
  }
}
`,
        "least upper bound",
      );
    });

    it("rejects incompatible inferred return locations (§7.14.4)", () => {
      expectTypeCheckFailure(
        `
function bad@every(c: boolean@every) {
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

    it("rejects @every binary with different concrete operand locations (§7.11)", () => {
      expectTypeCheckFailure(
        `
function bad@every(a: integer@alice, b: integer@bob) {
  return a + b;
}
`,
        "compatible location",
      );
    });

    it("rejects recursive local function with omitted return type (§7.14.8)", () => {
      expectTypeCheckFailure(
        `
function fact@alice(n: integer) {
  if (n <= 1) {
    return 1;
  } else {
    return n * fact(n - 1);
  }
}
`,
        "omitted return type cannot be recursive",
      );
    });

    it("rejects indirect recursive local functions with omitted return types (§7.14.8)", () => {
      const { typed, errors } = checkSource(`
function f@alice(n: integer) {
  return g(n);
}
function g@alice(n: integer) {
  return f(n);
}
`);
      assert.equal(typed, null);
      const recursiveErrors = errors.filter((e) =>
        e.message.includes("omitted return type cannot be recursive"),
      );
      assert.ok(recursiveErrors.length >= 2);
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

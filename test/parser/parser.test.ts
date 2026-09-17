import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHOREOGRAPHY_CONTEXT } from "../../src/ast/context.js";
import { parse } from "../../src/parser/index.js";

describe("ChoreoBS parser", () => {
  describe("parsing stops at the first syntax error", () => {
    it("reports one error for a malformed parameter list", () => {
      // The old recovery resumed at the next Identifier, which landed *inside*
      // the broken declaration and produced three further bogus errors.
      const { program, errors } = parse(`function foo(a: integer@mcu {
    return a;
}`);
      assert.equal(program, null);
      assert.equal(errors.length, 1, JSON.stringify(errors));
      assert.ok(errors[0]!.message.includes("expected ')' after parameters"));
    });

    it("reports one error for a malformed statement inside a block", () => {
      const { errors } = parse(`function f@alice(): void {
    let x integer@alice = 1@alice;
    return;
}`);
      assert.equal(errors.length, 1, JSON.stringify(errors));
    });

    it("does not hide a later syntax error once the earlier one is fixed", () => {
      const { errors } = parse(`function f@alice(): void {
    return;
}
function g@alice(: void {
    return;
}`);
      assert.equal(errors.length, 1, JSON.stringify(errors));
      assert.ok(errors[0]!.span.start > 20, "error should be in the second function");
    });
  });

  describe("lexical errors stop before parsing", () => {
    it("reports every independent lexical error and no parse cascade", () => {
      // `==` and `!=` are unrelated mistakes on different lines, so both are
      // worth reporting; the parser must not add noise from the lexer's
      // recovery tokens.
      const { program, errors } = parse(`let a: integer@alice = 1@alice;
let b: boolean@alice = a == 1@alice;
let c: boolean@alice = a != 1@alice;`);
      assert.equal(program, null);
      assert.equal(errors.length, 2, JSON.stringify(errors));
      assert.ok(errors[0]!.message.includes("'=='"));
      assert.ok(errors[1]!.message.includes("'!='"));
    });

    it("reports lexical errors in source order", () => {
      const { errors } = parse(`let a: boolean@alice = 1@alice == 2@alice;
let b: boolean@alice = 1@alice != 2@alice;`);
      assert.ok(errors.length >= 2);
      assert.ok(errors[0]!.span.start < errors[1]!.span.start);
    });
  });

  it("parses direct communication at top level", () => {
    const source = `let x: integer@alice = 1@alice;
let y: integer@bob <- x;`;
    const { program, errors } = parse(source);
    assert.equal(errors.length, 0);
    assert.ok(program);
    assert.equal(program.items.length, 2);

    const first = program.items[0];
    assert.equal(first?.kind, "TopLevelStatement");
    if (first?.kind === "TopLevelStatement") {
      assert.deepEqual(first.context, CHOREOGRAPHY_CONTEXT);
      assert.equal(first.statement.kind, "LetStatement");
    }

    const second = program.items[1];
    if (second?.kind === "TopLevelStatement") {
      assert.equal(second.statement.kind, "LetTransferStatement");
    }
  });

  it("parses a local function with omitted location annotations", () => {
    const source = `function add@alice(a: integer@alice, b: integer@alice): integer@alice {
  return a + b;
}`;
    const { program, errors } = parse(source);
    assert.equal(errors.length, 0);
    const fn = program?.items[0];
    assert.equal(fn?.kind, "FunctionDeclaration");
    if (fn?.kind === "FunctionDeclaration") {
      assert.equal(fn.name, "add");
      assert.equal(fn.at.kind, "individual");
      assert.equal(fn.context.kind, "local");
      assert.equal(fn.params.length, 2);
      assert.equal(fn.body.statements[0]?.kind, "ReturnStatement");
    }
  });

  it("parses a choreography function (no location annotation)", () => {
    const source = `function main(): void {
  return;
}`;
    const { program, errors } = parse(source);
    assert.equal(errors.length, 0);
    const fn = program?.items[0];
    assert.equal(fn?.kind, "FunctionDeclaration");
    if (fn?.kind === "FunctionDeclaration") {
      assert.equal(fn.at, undefined);
      assert.equal(fn.context.kind, "choreography");
      const ret = fn.body.statements[0];
      assert.equal(ret?.kind, "ReturnStatement");
      if (ret?.kind === "ReturnStatement") {
        assert.equal(ret.value, undefined);
      }
    }
  });

  it("parses if/while/for and transfer statement", () => {
    const source = `if (c) {
  x <- y;
} else {
  while (c) {
    for (let i: integer@every = 0@every; i < 10@every; i = i + 1@every) {
      return;
    }
  }
}`;
    const { program, errors } = parse(source);
    assert.equal(errors.length, 0);
    const stmt = program?.items[0];
    if (stmt?.kind === "TopLevelStatement") {
      assert.equal(stmt.statement.kind, "IfStatement");
      const ifStmt = stmt.statement;
      if (ifStmt.kind === "IfStatement") {
        assert.ok(ifStmt.else);
        assert.equal(ifStmt.else.statements[0]?.kind, "WhileStatement");
      }
    }
  });

  it("parses expression precedence and calls", () => {
    const source = `let x: integer@alice = 1 + 2 * 3 === 4 !== false;`;
    const { program, errors } = parse(source);
    assert.equal(errors.length, 0);
    const letStmt = program?.items[0];
    if (
      letStmt?.kind === "TopLevelStatement" &&
      letStmt.statement.kind === "LetStatement"
    ) {
      const root = letStmt.statement.initializer;
      assert.equal(root.kind, "BinaryExpression");
      if (root.kind === "BinaryExpression") {
        assert.equal(root.operator, "!==");
        assert.equal(root.right.kind, "LiteralExpression");
      }
    }
  });

  it("parses located literals and types", () => {
    const source = `let s: string@bob = "hi"@bob;`;
    const { program, errors } = parse(source);
    assert.equal(errors.length, 0);
    const letStmt = program?.items[0];
    if (
      letStmt?.kind === "TopLevelStatement" &&
      letStmt.statement.kind === "LetStatement"
    ) {
      const lit = letStmt.statement.initializer;
      if (lit.kind === "LiteralExpression") {
        assert.equal(lit.literal.literal.kind, "StringLiteral");
        assert.equal(lit.literal.location?.location.kind, "individual");
      }
      const typeLoc = letStmt.statement.type?.location?.location;
      if (typeLoc?.kind === "individual") {
        assert.equal(typeLoc.name, "bob");
      } else {
        assert.fail("expected individual location on type");
      }
    }
  });

  it("reports parse errors for unsupported statements", () => {
    const { program, errors } = parse("break;");
    assert.equal(program, null);
    assert.ok(errors.length > 0);
  });

  it("reports parse errors for uninitialized let", () => {
    const { program, errors } = parse("let x: integer@alice;");
    assert.equal(program, null);
    assert.ok(errors.some((e) => e.message.includes("=") || e.message.includes("<-")));
  });

  it("parses let without type annotation (spec §5.6, §7.14.1)", () => {
    const { program, errors } = parse("let x = 1@alice;");
    assert.equal(errors.length, 0);
    const item = program?.items[0];
    if (item?.kind === "TopLevelStatement" && item.statement.kind === "LetStatement") {
      assert.equal(item.statement.name, "x");
      assert.equal(item.statement.type, undefined);
      assert.equal(item.statement.initializer.kind, "LiteralExpression");
    } else {
      assert.fail("expected LetStatement");
    }
  });

  it("parses for-loop let initializer without type annotation (spec §5.11, §7.14.2)", () => {
    const { program, errors } = parse(
      "for (let i = 0@every; i < 3@every; i = i + 1@every) {}",
    );
    assert.equal(errors.length, 0);
    const item = program?.items[0];
    if (item?.kind === "TopLevelStatement" && item.statement.kind === "ForStatement") {
      const init = item.statement.init;
      assert.equal(init?.kind, "ForLetInit");
      if (init?.kind === "ForLetInit") {
        assert.equal(init.name, "i");
        assert.equal(init.type, undefined);
      }
    } else {
      assert.fail("expected ForStatement");
    }
  });

  it("parses function without return type annotation (spec §5.3, §7.14.4)", () => {
    const { program, errors } = parse(`function f@alice(a: integer@alice) {
  return a;
}`);
    assert.equal(errors.length, 0);
    const fn = program?.items[0];
    if (fn?.kind === "FunctionDeclaration") {
      assert.equal(fn.name, "f");
      assert.equal(fn.returnType, undefined);
      assert.equal(fn.params.length, 1);
      assert.equal(fn.params[0]?.type.base, "integer");
    } else {
      assert.fail("expected FunctionDeclaration");
    }
  });

  it("rejects transfer let without type annotation (spec §7.14.3)", () => {
    const { program, errors } = parse("let y <- x;");
    assert.equal(program, null);
    assert.ok(
      errors.some((e) => e.message.includes("type annotation required for transfer let")),
    );
  });

  it("rejects function parameter without type annotation (spec §7.14.7)", () => {
    const { program, errors } = parse(`function f@alice(a) {
  return a;
}`);
    assert.equal(program, null);
    assert.ok(errors.some((e) => e.message.includes("expected ':' after parameter name")));
  });

  it("parses array types, literals, index access, and builtins", () => {
    const { program, errors } = parse(`
let xs: integer[]@alice = [1, 2, 3]@alice;
let ys: float[]@bob = []@bob;
let zs: boolean[]@every = [true, false]@every;
let x: integer@alice = xs[0@alice];
xs[1@alice] = 10@alice;
let n: integer@alice = length(xs);
push(xs, 20@alice);
`);
    assert.equal(errors.length, 0);
    assert.ok(program);
  });

  it("parses array index as expression statement (spec §5.13)", () => {
    const { program, errors } = parse(`
let arr = [1, 3, 5]@every;
arr[2@every];
`);
    assert.equal(errors.length, 0);
    const second = program?.items[1];
    if (second?.kind === "TopLevelStatement") {
      assert.equal(second.statement.kind, "ExpressionStatement");
      if (second.statement.kind === "ExpressionStatement") {
        assert.equal(second.statement.expression.kind, "IndexExpression");
      }
    } else {
      assert.fail("expected ExpressionStatement at top level");
    }
  });
});

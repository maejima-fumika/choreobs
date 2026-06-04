import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse } from "../../src/parser/index.js";
import { typeCheck } from "../../src/check/index.js";
import type { ChoreoBSConfig } from "../../src/config/types.js";
import type {
  TypedLetStatement,
  TypedIfStatement,
  TypedTopLevelItem,
} from "../../src/ast/typed.js";

const aliceBob: ChoreoBSConfig = { participants: ["alice", "bob"] };

function check(source: string) {
  const { program, errors: parseErrors } = parse(source);
  assert.equal(parseErrors.length, 0, JSON.stringify(parseErrors));
  assert.ok(program);
  const { typed, errors } = typeCheck(program, aliceBob);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.ok(typed);
  return typed;
}

function letAt(typed: { items: readonly TypedTopLevelItem[] }, i: number): TypedLetStatement {
  const item = typed.items[i];
  assert.ok(item && "statement" in item && item.statement.stmt.kind === "LetStatement");
  return item.statement as TypedLetStatement;
}

describe("gradual coercion recording (spec §18.9–§18.17)", () => {
  it("records pack when a static value flows into @dynamic (§18.10)", () => {
    const typed = check(`let x: integer@dynamic = 1@alice;`);
    assert.equal(letAt(typed, 0).initializer.gradual?.kind, "pack");
  });

  it("records requireScalar when @dynamic flows into a static location (§18.10)", () => {
    const typed = check(`
let d = 1;
let y: integer@alice = d;
`);
    const coercion = letAt(typed, 1).initializer.gradual;
    assert.equal(coercion?.kind, "requireScalar");
    if (coercion?.kind === "requireScalar") {
      assert.equal(coercion.at.kind, "concrete");
    }
  });

  it("records requireArray when a @dynamic array flows into a static location (§18.10.6)", () => {
    const typed = check(`
let xs = [1, 2, 3];
let zs: integer[]@alice = xs;
`);
    assert.equal(letAt(typed, 1).initializer.gradual?.kind, "requireArray");
  });

  it("records copyWrapper for @dynamic-to-@dynamic binding (§18.15)", () => {
    const typed = check(`
let c = 1;
let d: integer@dynamic = c;
`);
    assert.equal(letAt(typed, 1).initializer.gradual?.kind, "copyWrapper");
  });

  it("produces a @dynamic result for operators over @dynamic operands (§18.12)", () => {
    const typed = check(`
let x = 1;
let y = x + 2;
`);
    assert.equal(letAt(typed, 1).choreoType.location.kind, "dynamic");
  });

  it("records requireCondition for a @dynamic condition (§18.17)", () => {
    const typed = check(`
let c = true;
if (c) { }
`);
    const item = typed.items[1];
    assert.ok(item && "statement" in item && item.statement.stmt.kind === "IfStatement");
    const ifStmt = item.statement as TypedIfStatement;
    assert.equal(ifStmt.condition.gradual?.kind, "requireCondition");
  });

  it("produces a @dynamic result for indexing into a @dynamic array (§18.14.1)", () => {
    const typed = check(`
let arr = [1, 2, 3];
let z = arr[0];
`);
    assert.equal(letAt(typed, 1).choreoType.location.kind, "dynamic");
  });

  it("packs static arguments passed to @dynamic parameters (§18.16.1)", () => {
    const typed = check(`
function add@every(a: integer, b: integer): integer@dynamic { return a + b; }
let r = add(1@alice, 2@alice);
`);
    const r = letAt(typed, 1);
    assert.equal(r.initializer.expr.kind, "CallExpression");
    if (r.initializer.expr.kind === "CallExpression" && "args" in r.initializer) {
      assert.equal(r.initializer.args[0]?.gradual?.kind, "pack");
      assert.equal(r.initializer.args[1]?.gradual?.kind, "pack");
    }
  });
});

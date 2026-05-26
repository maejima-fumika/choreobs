import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse } from "../../src/parser/index.js";
import { typeCheck } from "../../src/check/index.js";
import { project, projectAll } from "../../src/epp/index.js";
import type { ChoreoBSConfig } from "../../src/config/types.js";
import type {
  ProjectedProgram,
  ProjectedStatement,
} from "../../src/ir/projected.js";

const config: ChoreoBSConfig = { participants: ["alice", "bob"] };

function epp(source: string, participant: string): ProjectedProgram {
  const { program, errors: pe } = parse(source);
  assert.equal(pe.length, 0);
  const { typed, errors: te } = typeCheck(program!, config);
  assert.equal(te.length, 0);
  return project(typed!, participant);
}

function findStmt(
  stmts: readonly ProjectedStatement[],
  kind: ProjectedStatement["kind"],
): ProjectedStatement | undefined {
  return stmts.find((s) => s.kind === kind);
}

describe("Endpoint Projection (EPP)", () => {
  it("projects direct communication (spec §15.1)", () => {
    const source = `
let x: integer@alice = 1@alice;
let y: integer@bob <~ x;
`;
    const alice = epp(source, "alice");
    const bob = epp(source, "bob");

    const aliceLet = findStmt(alice.body, "LetStatement");
    assert.ok(aliceLet);
    assert.equal(findStmt(alice.body, "SendStatement")?.kind, "SendStatement");
    const send = findStmt(alice.body, "SendStatement");
    if (send?.kind === "SendStatement") {
      assert.equal(send.destinationParticipant, "bob");
      assert.equal(send.tag, "top_0");
    }

    const bobLet = findStmt(bob.body, "LetStatement");
    assert.ok(bobLet);
    if (bobLet?.kind === "LetStatement") {
      assert.equal(bobLet.initializer.kind, "ReceiveExpression");
      if (bobLet.initializer.kind === "ReceiveExpression") {
        assert.equal(bobLet.initializer.sourceParticipant, "alice");
        assert.equal(bobLet.initializer.tag, "top_0");
      }
    }
    assert.equal(findStmt(bob.body, "SendStatement"), undefined);
  });

  it("projects broadcast (spec §15.2)", () => {
    const source = `
let localOk: boolean@alice = true@alice;
let ok: boolean@every <~ localOk;
`;
    const alice = epp(source, "alice");
    const bob = epp(source, "bob");

    assert.ok(findStmt(alice.body, "BroadcastStatement"));
    const bobLet = findStmt(bob.body, "LetStatement");
    assert.ok(bobLet);
    if (bobLet?.kind === "LetStatement") {
      assert.equal(bobLet.initializer.kind, "ReceiveExpression");
    }
  });

  it("omits local functions at other participants (spec §12.11)", () => {
    const source = `
function add@alice(a: integer, b: integer): integer {
  return a + b;
}
`;
    const alice = epp(source, "alice");
    const bob = epp(source, "bob");
    assert.equal(alice.functions.length, 1);
    assert.equal(bob.functions.length, 0);
  });

  it("projects @every functions with absent parameters (spec §12.11)", () => {
    const source = `
function foo@every(a: integer@alice, b: integer@bob): integer@alice {
  return a;
}
`;
    const alice = epp(source, "alice");
    const bob = epp(source, "bob");
    assert.equal(alice.functions[0]?.params[1]?.type.kind, "AbsentType");
    assert.equal(bob.functions[0]?.params[0]?.type.kind, "AbsentType");
    assert.equal(bob.functions[0]?.returnType.kind, "AbsentType");
  });

  it("omits unavailable top-level lets at other participants (spec §12.8)", () => {
    const source = `let x: integer@alice = 1@alice;`;
    const bob = epp(source, "bob");
    assert.ok(
      bob.body.every(
        (stmt) =>
          stmt.kind === "AbsentStatement" ||
          (stmt.kind === "ExpressionStatement" &&
            stmt.expression.kind === "NothingExpression"),
      ),
    );
    assert.equal(findStmt(bob.body, "LetStatement"), undefined);
  });

  it("projects all participants via projectAll", () => {
    const source = `let x: integer@alice = 1@alice;`;
    const { program } = parse(source);
    const { typed } = typeCheck(program!, config);
    const all = projectAll(typed!, config.participants);
    assert.equal(all.length, 2);
    assert.deepEqual(
      all.map((p) => p.participant),
      ["alice", "bob"],
    );
  });
});

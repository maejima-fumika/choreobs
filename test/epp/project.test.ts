import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse } from "../../src/parser/index.js";
import { typeCheck } from "../../src/check/index.js";
import { project, projectAll } from "../../src/epp/index.js";
import type { ChoreoBSConfig } from "../../src/config/types.js";
import { assertCommConsistent } from "../comm/assert-consistent.js";
import type {
  ProjectedProgram,
  ProjectedStatement,
  IfStatement,
} from "../../src/ir/projected.js";

const config: ChoreoBSConfig = { participants: ["alice", "bob"] };

function eppAll(
  source: string,
  participants: ChoreoBSConfig = config,
): ProjectedProgram[] {
  const { program, errors: pe } = parse(source);
  assert.equal(pe.length, 0);
  const { typed, errors: te } = typeCheck(program!, participants);
  assert.equal(te.length, 0);
  const all = projectAll(typed!, participants.participants);
  assertCommConsistent(all);
  return all;
}

function epp(source: string, participant: string): ProjectedProgram {
  const hit = eppAll(source).find((p) => p.participant === participant);
  assert.ok(hit, `missing projection for ${participant}`);
  return hit;
}

function findStmt(
  stmts: readonly ProjectedStatement[],
  kind: ProjectedStatement["kind"],
): ProjectedStatement | undefined {
  return stmts.find((s) => s.kind === kind);
}

function collectStmtKinds(
  stmts: readonly ProjectedStatement[],
  out: ProjectedStatement["kind"][] = [],
): ProjectedStatement["kind"][] {
  for (const stmt of stmts) {
    out.push(stmt.kind);
    if (stmt.kind === "IfStatement") {
      collectStmtKinds(stmt.then.statements, out);
      if (stmt.else !== undefined) {
        collectStmtKinds(stmt.else.statements, out);
      }
    } else if (stmt.kind === "WhileStatement" || stmt.kind === "ForStatement") {
      collectStmtKinds(stmt.body.statements, out);
    }
  }
  return out;
}

function findIf(stmts: readonly ProjectedStatement[]): IfStatement | undefined {
  for (const stmt of stmts) {
    if (stmt.kind === "IfStatement") {
      return stmt;
    }
    if (stmt.kind === "WhileStatement" || stmt.kind === "ForStatement") {
      const hit = findIf(stmt.body.statements);
      if (hit !== undefined) {
        return hit;
      }
    }
  }
  return undefined;
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
    const all = eppAll(source);
    assert.equal(all.length, 2);
    assert.deepEqual(
      all.map((p) => p.participant),
      ["alice", "bob"],
    );
  });

  it("projects bob-only let inside nested if as NothingExpression at alice (spec §15.2 EPP)", () => {
    const source = `
let flag: boolean@every = true@every;
if (flag) {
  if (flag) {
    let z: integer@bob = 0@bob;
  }
}
`;
    const alice = epp(source, "alice");
    const kinds = collectStmtKinds(alice.body);
    assert.ok(kinds.includes("IfStatement"));
    assert.ok(kinds.includes("ExpressionStatement"));
    const outer = findIf(alice.body);
    assert.ok(outer);
    const inner = findIf(outer.then.statements);
    assert.ok(inner);
    const innerThen = inner.then.statements;
    assert.equal(innerThen.length, 1);
    assert.equal(innerThen[0]?.kind, "ExpressionStatement");
    if (innerThen[0]?.kind === "ExpressionStatement") {
      assert.equal(innerThen[0].expression.kind, "NothingExpression");
    }
    assert.equal(findStmt(inner.then.statements, "LetStatement"), undefined);
  });

  it("projects bob-only let at alice as absent or nothing before cleanup (spec §12.8)", () => {
    const source = `let z: integer@bob = 0@bob;`;
    const alice = epp(source, "alice");
    const stmt = alice.body[0];
    assert.ok(
      stmt?.kind === "AbsentStatement" ||
        (stmt?.kind === "ExpressionStatement" &&
          stmt.expression.kind === "NothingExpression"),
    );
    assert.equal(findStmt(alice.body, "LetStatement"), undefined);
  });

  it("projects assignment communication as SendStatement and AssignmentStatement", () => {
    const source = `
let x: integer@alice = 1@alice;
let y: integer@bob = 0@bob;
y <~ x;
`;
    const alice = epp(source, "alice");
    const bob = epp(source, "bob");
    assert.equal(findStmt(alice.body, "SendStatement")?.kind, "SendStatement");
    assert.equal(findStmt(bob.body, "AssignmentStatement")?.kind, "AssignmentStatement");
    if (findStmt(bob.body, "AssignmentStatement")?.kind === "AssignmentStatement") {
      const assign = findStmt(bob.body, "AssignmentStatement");
      assert.equal(assign?.kind, "AssignmentStatement");
      if (assign?.kind === "AssignmentStatement") {
        assert.equal(assign.value.kind, "ReceiveExpression");
      }
    }
  });
});

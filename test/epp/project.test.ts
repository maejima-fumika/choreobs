import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChoreoBSConfig } from "../../src/config/types.js";
import { aliceBob } from "../support/config.js";
import { projectSource } from "../support/pipeline.js";
import { assertCommConsistent } from "../support/comm.js";
import type {
  ProjectedProgram,
  ProjectedStatement,
  IfStatement,
} from "../../src/ir/projected.js";

/** Projects, and checks the result is a coherent set of endpoint programs. */
function eppAll(
  source: string,
  config: ChoreoBSConfig = aliceBob,
): readonly ProjectedProgram[] {
  const all = projectSource(source, config);
  assertCommConsistent(all);
  return all;
}

function epp(source: string, endpoint: string): ProjectedProgram {
  const hit = eppAll(source).find((p) => p.endpoint === endpoint);
  assert.ok(hit, `missing projection for ${endpoint}`);
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
  it("projects direct communication (spec §example-direct-communication)", () => {
    const source = `
let x: integer@alice = 1@alice;
let y: integer@bob <- x;
`;
    const alice = epp(source, "alice");
    const bob = epp(source, "bob");

    const aliceLet = findStmt(alice.body, "LetStatement");
    assert.ok(aliceLet);
    assert.equal(findStmt(alice.body, "SendStatement")?.kind, "SendStatement");
    const send = findStmt(alice.body, "SendStatement");
    if (send?.kind === "SendStatement") {
      assert.equal(send.destinationEndpoint, "bob");
      assert.equal(send.tag, "__top_0");
    }

    const bobLet = findStmt(bob.body, "LetStatement");
    assert.ok(bobLet);
    if (bobLet?.kind === "LetStatement") {
      assert.equal(bobLet.initializer.kind, "ReceiveExpression");
      if (bobLet.initializer.kind === "ReceiveExpression") {
        assert.equal(bobLet.initializer.sourceEndpoint, "alice");
        assert.equal(bobLet.initializer.tag, "__top_0");
      }
    }
    assert.equal(findStmt(bob.body, "SendStatement"), undefined);
  });

  it("projects broadcast (spec §example-broadcast)", () => {
    const source = `
let localOk: boolean@alice = true@alice;
let ok: boolean@every <- localOk;
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

  it("omits local functions at other endpoints (spec §function-projection)", () => {
    const source = `
function add@alice(a: integer@alice, b: integer@alice): integer@alice {
  return a + b;
}
`;
    const alice = epp(source, "alice");
    const bob = epp(source, "bob");
    assert.equal(alice.functions.length, 1);
    assert.equal(bob.functions.length, 0);
  });

  it("projects choreography functions with absent parameters (spec §function-projection)", () => {
    const source = `
function foo(a: integer@alice, b: integer@bob): integer@alice {
  return a;
}
`;
    const alice = epp(source, "alice");
    const bob = epp(source, "bob");
    assert.equal(alice.functions[0]?.params[1]?.type.kind, "AbsentType");
    assert.equal(bob.functions[0]?.params[0]?.type.kind, "AbsentType");
    assert.equal(bob.functions[0]?.returnType.kind, "AbsentType");
  });

  it("omits unavailable top-level lets at other endpoints (spec §let-projection)", () => {
    const source = `let x: integer@alice = 1@alice;`;
    const bob = epp(source, "bob");
    // The binding is gone, but the initializer's evaluation is kept as an
    // evaluation-only statement (spec §let-projection). Here it holds nothing bob owes,
    // so it is an `absent` that finalization and cleanup remove.
    assert.ok(
      bob.body.every(
        (stmt) =>
          stmt.kind === "ExpressionStatement" &&
          (stmt.expression.kind === "AbsentExpression" ||
            stmt.expression.kind === "NothingExpression"),
      ),
    );
    assert.equal(findStmt(bob.body, "LetStatement"), undefined);
  });

  it("projects all endpoints via projectAll", () => {
    const source = `let x: integer@alice = 1@alice;`;
    const all = eppAll(source);
    assert.equal(all.length, 2);
    assert.deepEqual(
      all.map((p) => p.endpoint),
      ["alice", "bob"],
    );
  });

  it("drops a bob-only let inside a nested if at alice (spec §example-broadcast EPP)", () => {
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
    const outer = findIf(alice.body);
    assert.ok(outer);
    const inner = findIf(outer.then.statements);
    assert.ok(inner);
    // The initializer holds no call alice has to make, so the whole statement
    // goes; the `if` stays because its condition is `@every` (spec §if-projection).
    const innerThen = inner.then.statements;
    assert.equal(innerThen.length, 1);
    assert.equal(innerThen[0]?.kind, "ExpressionStatement");
    if (innerThen[0]?.kind === "ExpressionStatement") {
      assert.equal(innerThen[0].expression.kind, "AbsentExpression");
    }
    assert.equal(findStmt(inner.then.statements, "LetStatement"), undefined);
  });

  it("projects bob-only let at alice as absent or nothing before cleanup (spec §let-projection)", () => {
    const source = `let z: integer@bob = 0@bob;`;
    const alice = epp(source, "alice");
    const stmt = alice.body[0];
    assert.ok(
      stmt?.kind === "ExpressionStatement" &&
        (stmt.expression.kind === "AbsentExpression" ||
          stmt.expression.kind === "NothingExpression"),
    );
    assert.equal(findStmt(alice.body, "LetStatement"), undefined);
  });

  it("projects assignment communication as SendStatement and AssignmentStatement", () => {
    const source = `
let x: integer@alice = 1@alice;
let y: integer@bob = 0@bob;
y <- x;
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

  it("projects a scalar local copy without communication APIs (spec §local-copy)", () => {
    const source = `
let x: integer@every = 1@every;
let y: integer@alice <- x;
`;
    const alice = epp(source, "alice");
    const bob = epp(source, "bob");
    const kindsAlice = collectStmtKinds(alice.body);
    const kindsBob = collectStmtKinds(bob.body);
    assert.ok(!kindsAlice.includes("SendStatement"));
    assert.ok(!kindsAlice.includes("BroadcastStatement"));
    assert.ok(!kindsBob.includes("SendStatement"));
    assert.ok(!kindsBob.includes("BroadcastStatement"));
    const yLet = alice.body.find(
      (s) => s.kind === "LetStatement" && s.name === "y",
    );
    assert.ok(yLet?.kind === "LetStatement");
    if (yLet?.kind === "LetStatement") {
      assert.equal(yLet.initializer.kind, "IdentifierExpression");
      assert.equal(yLet.initializer.name, "x");
    }
    assert.equal(
      bob.body.find((s) => s.kind === "LetStatement" && s.name === "y"),
      undefined,
    );
  });

  it("projects an array local copy with clone at destination (spec §local-copy)", () => {
    const source = `
let xs: float[]@every = [1.1, 2.2]@every;
let ys: float[]@alice <- xs;
`;
    const alice = epp(source, "alice");
    const ysLet = alice.body.find(
      (s) => s.kind === "LetStatement" && s.name === "ys",
    );
    assert.ok(ysLet?.kind === "LetStatement");
    if (ysLet?.kind === "LetStatement") {
      assert.equal(ysLet.initializer.kind, "CallExpression");
      if (ysLet.initializer.kind === "CallExpression") {
        assert.equal(ysLet.initializer.callee, "cloneFloatArray");
        assert.equal(ysLet.initializer.args[0]?.kind, "IdentifierExpression");
      }
    }
    assert.ok(!collectStmtKinds(alice.body).includes("SendStatement"));
  });

  it("projects array communication and array operations", () => {
    const source = `
let xs: integer[]@alice = [1, 2, 3]@alice;
xs[1@alice] = 10@alice;
xs.push(20@alice);
let n: integer@alice = xs.length;
let ys: integer[]@bob <- xs;
`;
    const alice = epp(source, "alice");
    const bob = epp(source, "bob");
    assert.equal(findStmt(alice.body, "SendStatement")?.kind, "SendStatement");
    const recvLet = findStmt(bob.body, "LetStatement");
    assert.ok(recvLet);
    if (recvLet?.kind === "LetStatement") {
      assert.equal(recvLet.initializer.kind, "ReceiveExpression");
    }
  });
});

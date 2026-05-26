import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cleanupProgram,
  simplifyExpression,
  isNullLiteral,
  isNothingExpression,
} from "../../src/cleanup/index.js";
import { compileSource } from "../../src/driver/index.js";
import { emit } from "../../src/emit/index.js";
import type {
  ProjectedProgram,
  ProjectedStatement,
  ProjectedExpression,
  NothingExpression,
  ExpressionStatement,
  SendStatement,
  BroadcastStatement,
  LetStatement,
} from "../../src/ir/projected.js";
import type { Span } from "../../src/ast/span.js";

const span: Span = { start: 0, end: 1 };
const config = { participants: ["alice", "bob"] };

function program(body: ProjectedStatement[]): ProjectedProgram {
  return {
    kind: "ProjectedProgram",
    participant: "bob",
    functions: [],
    body,
    span,
  };
}

function absent(): ProjectedExpression {
  return { kind: "AbsentExpression", span };
}

function nullLit(): ProjectedExpression {
  return { kind: "NullLiteralExpression", span };
}

function ident(name: string): ProjectedExpression {
  return { kind: "IdentifierExpression", name, span };
}

function nothingExpr(
  ...parts: ProjectedExpression[]
): NothingExpression {
  return { kind: "NothingExpression", parts, span };
}

function call(
  callee: string,
  ...args: ProjectedExpression[]
): ProjectedExpression {
  return { kind: "CallExpression", callee, args, span };
}

function exprStmt(expression: ProjectedExpression): ExpressionStatement {
  return { kind: "ExpressionStatement", expression, span };
}

function emitCleaned(body: ProjectedStatement[]): string {
  return emit(cleanupProgram(program(body))).trimEnd();
}

describe("Projected AST cleanup (spec §13.9)", () => {
  describe("expression simplification", () => {
    it("finalizes absent to null", () => {
      const result = simplifyExpression(absent());
      assert.ok(isNullLiteral(result));
    });

    it("folds compiler-generated NothingExpression(null) to null", () => {
      const result = simplifyExpression(nothingExpr(nullLit()));
      assert.ok(isNullLiteral(result));
    });

    it("folds nested NothingExpression to null", () => {
      const result = simplifyExpression(
        nothingExpr(nothingExpr(nullLit()), nullLit(), nullLit()),
      );
      assert.ok(isNullLiteral(result));
    });

    it("simplifies NothingExpression inside call arguments to foo(null, null)", () => {
      const result = simplifyExpression(
        call("foo", nothingExpr(absent()), absent()),
      );
      assert.equal(result.kind, "CallExpression");
      if (result.kind === "CallExpression") {
        assert.equal(result.callee, "foo");
        assert.ok(isNullLiteral(result.args[0]!));
        assert.ok(isNullLiteral(result.args[1]!));
      }
    });

    it("preserves foo(null, null)", () => {
      const input = call("foo", nullLit(), nullLit());
      const result = simplifyExpression(input);
      assert.equal(result.kind, "CallExpression");
      if (result.kind === "CallExpression") {
        assert.equal(result.callee, "foo");
        assert.ok(isNullLiteral(result.args[0]!));
        assert.ok(isNullLiteral(result.args[1]!));
      }
    });

    it("preserves user-defined call named nothing", () => {
      const result = simplifyExpression(call("nothing", nullLit()));
      assert.equal(result.kind, "CallExpression");
      if (result.kind === "CallExpression") {
        assert.equal(result.callee, "nothing");
        assert.ok(isNullLiteral(result.args[0]!));
      }
    });

    it("preserves NothingExpression(choose(c)) when an argument is not null", () => {
      const result = simplifyExpression(nothingExpr(ident("c")));
      assert.ok(isNothingExpression(result));
      if (isNothingExpression(result)) {
        assert.equal(result.parts[0]?.kind, "IdentifierExpression");
      }
    });

    it("simplifies user-defined nothing(NothingExpression(null)) to nothing(null)", () => {
      const result = simplifyExpression(
        call("nothing", nothingExpr(absent())),
      );
      assert.equal(result.kind, "CallExpression");
      if (result.kind === "CallExpression") {
        assert.equal(result.callee, "nothing");
        assert.ok(isNullLiteral(result.args[0]!));
      }
    });
  });

  describe("statement cleanup", () => {
    it("removes NothingExpression(null);", () => {
      assert.equal(emitCleaned([exprStmt(nothingExpr(absent()))]), "");
    });

    it("removes null;", () => {
      assert.equal(emitCleaned([exprStmt(nullLit())]), "");
    });

    it("removes nested NothingExpression statement", () => {
      assert.equal(
        emitCleaned([
          exprStmt(nothingExpr(nothingExpr(absent()), absent(), absent())),
        ]),
        "",
      );
    });

    it("rewrites foo(NothingExpression(null), null); to foo(null, null);", () => {
      assert.equal(
        emitCleaned([exprStmt(call("foo", nothingExpr(absent()), absent()))]),
        "foo(null, null);",
      );
    });

    it("preserves foo(null, null);", () => {
      assert.equal(
        emitCleaned([exprStmt(call("foo", nullLit(), nullLit()))]),
        "foo(null, null);",
      );
    });

    it("preserves compiler-generated nothing(choose(c));", () => {
      assert.equal(
        emitCleaned([exprStmt(nothingExpr(ident("c")))]),
        "nothing(c);",
      );
    });

    it("preserves user-defined nothing(null);", () => {
      assert.equal(
        emitCleaned([exprStmt(call("nothing", nullLit()))]),
        "nothing(null);",
      );
    });

    it("preserves sendInteger, receiveInteger, and broadcastBoolean", () => {
      const send: SendStatement = {
        kind: "SendStatement",
        comm: "integer",
        destinationParticipant: "bob",
        tag: "top_0",
        value: ident("x"),
        span,
      };
      const letRecv: LetStatement = {
        kind: "LetStatement",
        name: "y",
        type: { kind: "PresentType", base: "integer" },
        initializer: {
          kind: "ReceiveExpression",
          comm: "integer",
          sourceParticipant: "alice",
          tag: "top_0",
          span,
        },
        span,
      };
      const broadcast: BroadcastStatement = {
        kind: "BroadcastStatement",
        comm: "boolean",
        tag: "top_1",
        value: ident("flag"),
        span,
      };
      const out = emitCleaned([send, letRecv, broadcast]);
      assert.match(out, /sendInteger\("bob", "top_0", x\)/);
      assert.match(out, /receiveInteger\("alice", "top_0"\)/);
      assert.match(out, /broadcastBoolean\("top_1", flag\)/);
    });
  });

  describe("integration — user-defined function named nothing", () => {
    it("preserves user nothing function and call at alice (spec §15.3 variant)", () => {
      const result = compileSource(
        `
function nothing@alice(a: null): null {
    return null;
}
nothing(null@alice);
`,
        "index.cbs",
        config,
      );
      assert.equal(result.success, true, JSON.stringify(result.errors));
      const alice = result.outputs.find((o) => o.participant === "alice")?.source.trimEnd();
      assert.equal(
        alice,
        `function nothing(a: null): null {
  return null;
}
nothing(null);`,
      );
    });
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cleanupProgram,
  simplifyExpression,
  isNullLiteral,
  isNothingExpression,
} from "../../src/cleanup/index.js";
import { finalizeAbsentProgram } from "../../src/finalize/index.js";
import { emit } from "../../src/emit/index.js";
import type {
  ProjectedStatement,
  SendStatement,
  BroadcastStatement,
  LetStatement,
} from "../../src/ir/projected.js";
import { aliceBob } from "../support/config.js";
import { compile } from "../support/compile.js";
import {
  span,
  program,
  absent,
  nullLit,
  ident,
  nothingExpr,
  call,
  exprStmt,
} from "../support/ir.js";

function emitCleaned(body: ProjectedStatement[]): string {
  return emit(cleanupProgram(finalizeAbsentProgram(program(body)))).trimEnd();
}

describe("Projected AST cleanup (spec §projected-ast-cleanup)", () => {
  describe("expression simplification", () => {
    it("rejects an absent that absent finalization should have removed", () => {
      assert.throws(
        () => simplifyExpression(absent()),
        /absent must be finalized before cleanup/,
      );
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
        call("foo", nothingExpr(nullLit()), nullLit()),
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
        call("nothing", nothingExpr(nullLit())),
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

    it("keeps return, let, assignment and call statements that hold null (§simplification-inside-function-arguments)", () => {
      // Only a statement that is exactly `null;` goes. Everything else stays,
      // however much `null` it carries.
      const body: ProjectedStatement[] = [
        { kind: "ReturnStatement", value: nullLit(), span },
        {
          kind: "LetStatement",
          name: "x",
          type: { kind: "AbsentType" },
          initializer: nullLit(),
          span,
        },
        {
          kind: "AssignmentStatement",
          target: { kind: "IdentifierAssignmentTarget", name: "x" },
          value: nullLit(),
          span,
        },
        exprStmt(call("f", nullLit())),
        exprStmt(nullLit()),
      ];
      assert.equal(
        emitCleaned(body),
        ["return null;", "let x: null = null;", "x = null;", "f(null);"].join(
          "\n",
        ),
      );
    });

    it("simplifies the index expression of an assignment target", () => {
      assert.equal(
        emitCleaned([
          {
            kind: "AssignmentStatement",
            target: {
              kind: "IndexAssignmentTarget",
              name: "xs",
              index: nothingExpr(nullLit()),
            },
            value: ident("v"),
            span,
          },
        ]),
        "xs[null] = v;",
      );
    });

    it("preserves sendInteger, receiveInteger, and broadcastBoolean", () => {
      const send: SendStatement = {
        kind: "SendStatement",
        comm: "integer",
        destinationEndpoint: "bob",
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
          sourceEndpoint: "alice",
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

  describe("integration — `nothing` is a reserved runtime name", () => {
    // The IR-level tests above still exercise a *call* named `nothing` that is
    // not the compiler's artifact, because the distinction has to survive
    // inside cleanup. Source programs may no longer introduce that name: the
    // emitted BlueScript keeps the source name (spec §codegen-function-names), so a user
    // `nothing` would capture the compiler's own `nothing(...)` calls
    // (spec §function-names, §nothing).
    it("rejects a user function named nothing (spec §function-names, §codegen-function-names)", () => {
      const result = compile(
        `
function nothing@alice(a: null@alice): null@alice {
    return null@alice;
}
nothing(null@alice);
`,
        aliceBob,
      );
      assert.equal(result.success, false);
      assert.ok(
        result.errors.some((e) => e.message.includes("reserved runtime name")),
        JSON.stringify(result.errors),
      );
    });
  });
});

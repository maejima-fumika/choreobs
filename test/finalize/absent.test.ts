import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  finalizeAbsentProgram,
  finalizeExpression,
} from "../../src/finalize/index.js";
import { projectSource } from "../support/pipeline.js";
import { span, program, absent, nothingExpr, exprStmt } from "../support/ir.js";

/** Every `AbsentExpression` reachable from `stmt`, by path, for leak hunting. */
function hasAbsent(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasAbsent);
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  const node = value as Record<string, unknown>;
  if (node["kind"] === "AbsentExpression") {
    return true;
  }
  return Object.values(node).some(hasAbsent);
}

describe("Absent finalization (spec §13.7)", () => {
  it("replaces absent with null and leaves the nesting alone", () => {
    // Folding is cleanup's job (spec §13.9); this stage only rewrites leaves,
    // so the `nothing(...)` structure survives untouched.
    const result = finalizeExpression(
      nothingExpr(absent(), nothingExpr(absent(), absent())),
    );
    assert.equal(result.kind, "NothingExpression");
    if (result.kind !== "NothingExpression") return;
    assert.equal(result.parts[0]?.kind, "NullLiteralExpression");
    const inner = result.parts[1];
    assert.equal(inner?.kind, "NothingExpression");
    if (inner?.kind === "NothingExpression") {
      assert.equal(inner.parts.length, 2);
      assert.ok(
        inner.parts.every((p) => p.kind === "NullLiteralExpression"),
        "inner parts should be null literals",
      );
    }
  });

  it("finalizes the index expression of an assignment target", () => {
    // `xs[i] = v` carries an expression inside the target, which is easy to
    // miss when walking statements.
    const finalized = finalizeAbsentProgram(
      program([
        {
          kind: "AssignmentStatement",
          target: {
            kind: "IndexAssignmentTarget",
            name: "xs",
            index: absent(),
          },
          value: absent(),
          span,
        },
      ]),
    );
    assert.equal(hasAbsent(finalized), false);
  });

  it("finalizes a for header in every slot", () => {
    const finalized = finalizeAbsentProgram(
      program([
        {
          kind: "ForStatement",
          init: { kind: "ForExpressionInit", expression: absent(), span },
          condition: absent(),
          update: { kind: "ForExpressionInit", expression: absent(), span },
          body: { kind: "ProjectedBlock", statements: [exprStmt(absent())], span },
          span,
        },
      ]),
    );
    assert.equal(hasAbsent(finalized), false);
  });

  it("leaves no absent anywhere in a real projection", () => {
    const source = `
function relay(a: integer@alice): integer@alice {
  let b: integer@bob <- a;
  let c: integer@alice <- b;
  return c;
}
let flag: boolean@every = true@every;
let xs: integer[]@alice = [1, 2]@alice;
let x: integer@alice = 1@alice;
xs[0@alice] = relay(x);
xs.push(relay(x));
for (let i: integer@every = 0@every; i < 2@every; i = i + 1@every) {
  if (flag) {
    let y: integer@alice = -relay(x) + xs.length;
  }
}
`;
    const projected = projectSource(source).find((p) => p.endpoint === "bob");
    assert.ok(projected, "missing projection for bob");
    assert.ok(hasAbsent(projected), "expected EPP to leave absent behind");
    assert.equal(hasAbsent(finalizeAbsentProgram(projected)), false);
  });
});

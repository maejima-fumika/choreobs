import type { Span } from "../ast/span.js";
import type {
  ProjectedProgram,
  ProjectedFunction,
  ProjectedStatement,
  ProjectedBlock,
  ProjectedExpression,
  NullLiteralExpression,
} from "../ir/projected.js";
import {
  mapExpressionChildren,
  mapStatementParts,
} from "../ir/traverse.js";

/**
 * Absent finalization (spec §absent-finalization) — the stage between endpoint projection and
 * cleanup.
 *
 * EPP leaves two different artifacts behind: `absent`, the internal marker for
 * a value that does not exist at this endpoint (spec §absent), and
 * `nothing(...)`, which preserves computations whose result is discarded
 * (spec §nothing). This stage turns every remaining `absent` into the `null` it
 * projects to, and does nothing else. Folding `nothing(...)` away is cleanup's
 * job (spec §projected-ast-cleanup), and it depends on this stage having run first: its rule is
 * stated over arguments that are syntactically `null`, which an `absent` is
 * not.
 *
 * Keeping the two apart is what lets each be stated as one rule. Cleanup and
 * the emitter both reject an `absent` that reaches them.
 */
export function finalizeAbsentAll(
  programs: readonly ProjectedProgram[],
): readonly ProjectedProgram[] {
  return programs.map(finalizeAbsentProgram);
}

export function finalizeAbsentProgram(
  program: ProjectedProgram,
): ProjectedProgram {
  return {
    ...program,
    functions: program.functions.map(finalizeFunction),
    body: program.body.map(finalizeStatement),
  };
}

function finalizeFunction(fn: ProjectedFunction): ProjectedFunction {
  return { ...fn, body: finalizeBlock(fn.body) };
}

function finalizeBlock(block: ProjectedBlock): ProjectedBlock {
  return { ...block, statements: block.statements.map(finalizeStatement) };
}

function finalizeStatement(stmt: ProjectedStatement): ProjectedStatement {
  return mapStatementParts(stmt, {
    expression: finalizeExpression,
    block: finalizeBlock,
  });
}

export function finalizeExpression(
  expr: ProjectedExpression,
): ProjectedExpression {
  if (expr.kind === "AbsentExpression") {
    return nullLiteral(expr.span);
  }
  return mapExpressionChildren(expr, finalizeExpression);
}

function nullLiteral(span: Span): NullLiteralExpression {
  return { kind: "NullLiteralExpression", span };
}

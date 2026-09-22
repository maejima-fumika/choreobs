import type { Span } from "../ast/span.js";
import type {
  ProjectedProgram,
  ProjectedFunction,
  ProjectedStatement,
  ProjectedBlock,
  ProjectedExpression,
  ProjectedForInit,
  ProjectedForUpdate,
  ForStatement,
  ExpressionStatement,
  NothingExpression,
} from "../ir/projected.js";
import {
  mapExpressionChildren,
  mapStatementParts,
  mapForInit,
  mapForUpdate,
  type StatementMappers,
} from "../ir/traverse.js";

export function cleanupAll(
  programs: readonly ProjectedProgram[],
): readonly ProjectedProgram[] {
  return programs.map(cleanupProgram);
}

export function cleanupProgram(program: ProjectedProgram): ProjectedProgram {
  return {
    ...program,
    functions: program.functions.map(cleanupFunction),
    body: cleanupStatements(program.body),
  };
}

function cleanupFunction(fn: ProjectedFunction): ProjectedFunction {
  return {
    ...fn,
    body: cleanupBlock(fn.body),
  };
}

function cleanupBlock(block: ProjectedBlock): ProjectedBlock {
  return {
    ...block,
    statements: cleanupStatements(block.statements),
  };
}

function cleanupStatements(
  statements: readonly ProjectedStatement[],
): ProjectedStatement[] {
  const out: ProjectedStatement[] = [];
  for (const stmt of statements) {
    const cleaned = cleanupStatement(stmt);
    if (cleaned !== undefined) {
      out.push(cleaned);
    }
  }
  return out;
}

const MAPPERS: StatementMappers = {
  expression: simplifyExpression,
  block: cleanupBlock,
};

/**
 * Two kinds can lose something and are handled by hand; the rest just need
 * their expressions simplified and their blocks cleaned (spec §statement-cleanup).
 */
function cleanupStatement(stmt: ProjectedStatement): ProjectedStatement | undefined {
  if (stmt.kind === "ExpressionStatement") {
    return cleanupExpressionStatement(stmt);
  }
  if (stmt.kind === "ForStatement") {
    return cleanupFor(stmt);
  }
  return mapStatementParts(stmt, MAPPERS);
}

function cleanupFor(stmt: ForStatement): ProjectedStatement {
  return {
    ...stmt,
    init: stmt.init === undefined ? undefined : cleanupForInit(stmt.init),
    condition: simplifyExpression(stmt.condition),
    update:
      stmt.update === undefined ? undefined : cleanupForUpdate(stmt.update),
    body: cleanupBlock(stmt.body),
  };
}

function cleanupExpressionStatement(
  stmt: ExpressionStatement,
): ProjectedStatement | undefined {
  const expression = simplifyExpression(stmt.expression);
  if (isNullLiteral(expression)) {
    return undefined;
  }
  return { ...stmt, expression };
}

/** A `let` binding in the header always stays; only a discarded slot can go. */
function cleanupForInit(init: ProjectedForInit): ProjectedForInit | undefined {
  return init.kind === "ForLetInit"
    ? mapForInit(init, MAPPERS)
    : cleanupForUpdate(init);
}

/**
 * A header slot that holds only a discarded expression disappears once that
 * expression simplifies to `null` — the `for` equivalent of dropping a `null;`
 * statement (spec §for-projection, §simplification-inside-function-arguments). A binding or a real assignment stays.
 */
function cleanupForUpdate(
  update: ProjectedForUpdate,
): ProjectedForUpdate | undefined {
  const cleaned = mapForUpdate(update, MAPPERS);
  if (cleaned.kind === "ForExpressionInit" && isNullLiteral(cleaned.expression)) {
    return undefined;
  }
  return cleaned;
}

/**
 * Expression simplification (spec §expression-simplification), bottom-up: every argument is
 * simplified before its parent is considered.
 *
 * Only {@link NothingExpression} artifacts fold to `null`, and only when every
 * argument is syntactically `null` after simplification. Ordinary calls are
 * preserved whatever their type says they return, because a call may
 * communicate (spec §statement-cleanup).
 */
export function simplifyExpression(expr: ProjectedExpression): ProjectedExpression {
  if (expr.kind === "AbsentExpression") {
    // Absent finalization runs first and leaves none behind (spec §absent-finalization).
    // The rule below is stated over arguments that are syntactically `null`,
    // which an `absent` is not, so reaching here would silently keep a
    // `nothing(...)` alive that should have folded away.
    throw new Error(
      "internal error: absent must be finalized before cleanup (spec §13.7)",
    );
  }
  if (expr.kind === "NothingExpression") {
    return simplifyNothingExpression(expr);
  }
  return mapExpressionChildren(expr, simplifyExpression);
}

function simplifyNothingExpression(
  expr: NothingExpression,
): ProjectedExpression {
  const parts = expr.parts.map((part) => simplifyExpression(part));
  if (parts.every(isNullLiteral)) {
    return nullLiteral(expr.span);
  }
  return { ...expr, parts };
}

export function isNullLiteral(
  expr: ProjectedExpression,
): expr is import("../ir/projected.js").NullLiteralExpression {
  return expr.kind === "NullLiteralExpression";
}

export function isNothingExpression(
  expr: ProjectedExpression,
): expr is NothingExpression {
  return expr.kind === "NothingExpression";
}

function nullLiteral(span: Span): import("../ir/projected.js").NullLiteralExpression {
  return { kind: "NullLiteralExpression", span };
}

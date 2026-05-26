import type { Span } from "../ast/span.js";
import type {
  ProjectedProgram,
  ProjectedFunction,
  ProjectedStatement,
  ProjectedBlock,
  ProjectedExpression,
  ProjectedForInit,
  ProjectedForUpdate,
  ExpressionStatement,
  NothingExpression,
} from "../ir/projected.js";

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

function cleanupStatement(stmt: ProjectedStatement): ProjectedStatement | undefined {
  switch (stmt.kind) {
    case "AbsentStatement":
      return undefined;
    case "ExpressionStatement":
      return cleanupExpressionStatement(stmt);
    case "LetStatement":
      return {
        ...stmt,
        initializer: simplifyExpression(stmt.initializer),
      };
    case "AssignmentStatement":
      return {
        ...stmt,
        value: simplifyExpression(stmt.value),
      };
    case "SendStatement":
      return {
        ...stmt,
        value: simplifyExpression(stmt.value),
      };
    case "BroadcastStatement":
      return {
        ...stmt,
        value: simplifyExpression(stmt.value),
      };
    case "ReturnStatement":
      return {
        ...stmt,
        value:
          stmt.value === undefined
            ? undefined
            : simplifyExpression(stmt.value),
      };
    case "IfStatement":
      return {
        ...stmt,
        condition: simplifyExpression(stmt.condition),
        then: cleanupBlock(stmt.then),
        else: stmt.else === undefined ? undefined : cleanupBlock(stmt.else),
      };
    case "WhileStatement":
      return {
        ...stmt,
        condition: simplifyExpression(stmt.condition),
        body: cleanupBlock(stmt.body),
      };
    case "ForStatement":
      return {
        ...stmt,
        init: stmt.init === undefined ? undefined : cleanupForInit(stmt.init),
        condition:
          stmt.condition === undefined
            ? undefined
            : simplifyExpression(stmt.condition),
        update:
          stmt.update === undefined ? undefined : cleanupForUpdate(stmt.update),
        body: cleanupBlock(stmt.body),
      };
  }
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

function cleanupForInit(init: ProjectedForInit): ProjectedForInit {
  if (init.kind === "ForLetInit") {
    return {
      ...init,
      initializer: simplifyExpression(init.initializer),
    };
  }
  return {
    ...init,
    value: simplifyExpression(init.value),
  };
}

function cleanupForUpdate(update: ProjectedForUpdate): ProjectedForUpdate {
  return {
    ...update,
    value: simplifyExpression(update.value),
  };
}

/**
 * Stage 1 — expression simplification (spec §13.9.2).
 * Only {@link NothingExpression} artifacts fold to `null`; ordinary calls are preserved.
 */
export function simplifyExpression(expr: ProjectedExpression): ProjectedExpression {
  switch (expr.kind) {
    case "AbsentExpression":
      return nullLiteral(expr.span);
    case "NullLiteralExpression":
    case "IntegerLiteralExpression":
    case "FloatLiteralExpression":
    case "StringLiteralExpression":
    case "BooleanLiteralExpression":
    case "IdentifierExpression":
    case "ReceiveExpression":
      return expr;
    case "NothingExpression":
      return simplifyNothingExpression(expr);
    case "ParenthesizedExpression":
      return {
        ...expr,
        expression: simplifyExpression(expr.expression),
      };
    case "UnaryExpression":
      return {
        ...expr,
        operand: simplifyExpression(expr.operand),
      };
    case "BinaryExpression":
      return {
        ...expr,
        left: simplifyExpression(expr.left),
        right: simplifyExpression(expr.right),
      };
    case "CallExpression":
      return {
        ...expr,
        args: expr.args.map((arg) => simplifyExpression(arg)),
      };
  }
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

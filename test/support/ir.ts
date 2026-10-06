import type { Span } from "../../src/ast/span.js";
import type {
  ProjectedProgram,
  ProjectedStatement,
  ProjectedExpression,
  ExpressionStatement,
  NothingExpression,
} from "../../src/ir/projected.js";

/** Builders for hand-written projected IR, for the passes that rewrite it. */

export const span: Span = { start: 0, end: 1 };

export function program(
  body: ProjectedStatement[],
  endpoint = "bob",
  functions: ProjectedProgram["functions"] = [],
): ProjectedProgram {
  return { kind: "ProjectedProgram", endpoint, imports: [], functions, body, span };
}

export function absent(): ProjectedExpression {
  return { kind: "AbsentExpression", span };
}

export function nullLit(): ProjectedExpression {
  return { kind: "NullLiteralExpression", span };
}

export function ident(name: string): ProjectedExpression {
  return { kind: "IdentifierExpression", name, span };
}

export function nothingExpr(
  ...parts: ProjectedExpression[]
): NothingExpression {
  return { kind: "NothingExpression", parts, span };
}

export function call(
  callee: string,
  ...args: ProjectedExpression[]
): ProjectedExpression {
  return { kind: "CallExpression", callee, args, span };
}

export function exprStmt(expression: ProjectedExpression): ExpressionStatement {
  return { kind: "ExpressionStatement", expression, span };
}

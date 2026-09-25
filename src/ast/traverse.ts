import type { Expression } from "./expressions.js";
import { assertNever } from "../util/exhaustive.js";

/**
 * The direct child expressions of `expr`, in evaluation order (spec §evaluation-order).
 *
 * The checker uses it to find which functions a body calls (§inference-and-recursion).
 * The shape lives here, once, and `assertNever` makes a new expression form a
 * compile error rather than a silently unvisited subtree.
 */
export function childExpressions(expr: Expression): readonly Expression[] {
  switch (expr.kind) {
    case "LiteralExpression":
    case "IdentifierExpression":
      return [];
    case "BinaryExpression":
      return [expr.left, expr.right];
    case "UnaryExpression":
    case "ConversionExpression":
      return [expr.operand];
    case "CallExpression":
      return expr.args;
    case "ArrayLiteralExpression":
      return expr.elements;
    case "IndexExpression":
      return [expr.target, expr.index];
    case "LengthExpression":
      return [expr.target];
    case "PushExpression":
      return [expr.target, expr.value];
    case "ParenthesizedExpression":
      return [expr.expression];
    default:
      return assertNever(expr, "expression");
  }
}

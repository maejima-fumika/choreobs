import type { CallExpression, Expression } from "./expressions.js";
import type { AssignmentTarget, Block, Statement } from "./statements.js";
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
    case "PrintExpression":
      return [expr.value];
    case "ParenthesizedExpression":
      return [expr.expression];
    default:
      return assertNever(expr, "expression");
  }
}

/** The parts a statement holds directly; see {@link statementParts}. */
export interface StatementParts {
  /**
   * The expressions the statement itself evaluates, in source order. Those of
   * an assignment target come first: the index of `xs[i] = v`, in a statement
   * or a `for` header clause.
   */
  readonly expressions: readonly Expression[];
  /** The blocks it holds, in source order. Their statements are not included. */
  readonly blocks: readonly Block[];
}

/**
 * The direct parts of `stmt`.
 *
 * The statement-level counterpart of {@link childExpressions}, for walks that
 * need every expression of a body: the checker's call graph
 * (§inference-and-recursion) reads its calls from here. A `for` header holds
 * expressions in places that are easy to forget, such as the index of an
 * element assigned in its update, so they are listed here once.
 */
export function statementParts(stmt: Statement): StatementParts {
  switch (stmt.kind) {
    case "LetStatement":
      return { expressions: [stmt.initializer], blocks: [] };
    case "LetTransferStatement":
    case "TransferStatement":
      return { expressions: [stmt.source], blocks: [] };
    case "AssignmentStatement":
      return { expressions: [...targetExpressions(stmt.target), stmt.value], blocks: [] };
    case "IfStatement":
      return {
        expressions: [stmt.condition],
        blocks: stmt.else === undefined ? [stmt.then] : [stmt.then, stmt.else],
      };
    case "WhileStatement":
      return { expressions: [stmt.condition], blocks: [stmt.body] };
    case "ForStatement": {
      const init =
        stmt.init === undefined
          ? []
          : stmt.init.kind === "ForLetInit"
            ? [stmt.init.initializer]
            : [...targetExpressions(stmt.init.target), stmt.init.value];
      const update =
        stmt.update === undefined
          ? []
          : [...targetExpressions(stmt.update.target), stmt.update.value];
      return { expressions: [...init, stmt.condition, ...update], blocks: [stmt.body] };
    }
    case "ReturnStatement":
      return { expressions: stmt.value === undefined ? [] : [stmt.value], blocks: [] };
    case "ExpressionStatement":
      return { expressions: [stmt.expression], blocks: [] };
    default:
      return assertNever(stmt, "statement");
  }
}

/**
 * `statements` and every statement nested in their blocks, each before the
 * ones it holds.
 */
export function nestedStatements(statements: readonly Statement[]): Statement[] {
  return statements.flatMap((stmt) => [
    stmt,
    ...statementParts(stmt).blocks.flatMap((block) => nestedStatements(block.statements)),
  ]);
}

/**
 * Every call in `statements` and the blocks they hold, in source order: a call
 * before the calls in its arguments.
 *
 * The checker reads a body's call graph from here (§inference-and-recursion),
 * and the calls a top-level statement makes (§top-level-constant-initialization-order).
 */
export function callsIn(statements: readonly Statement[]): CallExpression[] {
  const calls: CallExpression[] = [];
  const visit = (expr: Expression): void => {
    if (expr.kind === "CallExpression") {
      calls.push(expr);
    }
    for (const child of childExpressions(expr)) {
      visit(child);
    }
  };
  for (const stmt of nestedStatements(statements)) {
    for (const expr of statementParts(stmt).expressions) {
      visit(expr);
    }
  }
  return calls;
}

/** The expressions an assignment target evaluates: the index of an element target. */
function targetExpressions(target: AssignmentTarget): readonly Expression[] {
  return target.kind === "IndexAssignmentTarget" ? [target.index] : [];
}

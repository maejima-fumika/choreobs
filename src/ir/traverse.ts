import type {
  ProjectedExpression,
  ProjectedStatement,
  ProjectedBlock,
  ProjectedAssignmentTarget,
  ProjectedForInit,
  ProjectedForUpdate,
} from "./projected.js";

/**
 * Structural traversal of the projected IR.
 *
 * Three passes walk this IR — absent finalization (spec §13.7), cleanup
 * (spec §13.9) and the communication consistency check (spec §11.5) — and each
 * used to carry its own copy of the shape. That is how cleanup came to miss the
 * index expression of `xs[i] = v`, which then reached code generation as a
 * stray artifact. The shape lives here now, once.
 *
 * Both switches are exhaustive with no `default`, so adding a node to the IR is
 * a compile error in this file rather than a silently skipped slot.
 *
 * Only the *expression* level is shared with the consistency checker. Its
 * statement walk peeks at the following sibling (a broadcast must be followed
 * by the sender's own binding) and gives each header slot its own control path,
 * neither of which a generic traversal can express.
 */

/** Rebuilds `expr` with each direct child expression replaced by `f(child)`. */
export function mapExpressionChildren(
  expr: ProjectedExpression,
  f: (child: ProjectedExpression) => ProjectedExpression,
): ProjectedExpression {
  switch (expr.kind) {
    case "AbsentExpression":
    case "IntegerLiteralExpression":
    case "FloatLiteralExpression":
    case "StringLiteralExpression":
    case "BooleanLiteralExpression":
    case "NullLiteralExpression":
    case "IdentifierExpression":
    case "ReceiveExpression":
      return expr;
    case "BinaryExpression":
      return { ...expr, left: f(expr.left), right: f(expr.right) };
    case "UnaryExpression":
      return { ...expr, operand: f(expr.operand) };
    case "CallExpression":
      return { ...expr, args: expr.args.map(f) };
    case "NothingExpression":
      return { ...expr, parts: expr.parts.map(f) };
    case "IndexExpression":
      return { ...expr, target: f(expr.target), index: f(expr.index) };
    case "PropertyLengthExpression":
      return { ...expr, target: f(expr.target) };
    case "ParenthesizedExpression":
      return { ...expr, expression: f(expr.expression) };
  }
}

/**
 * The direct child expressions of `expr`, in evaluation order.
 *
 * Derived from {@link mapExpressionChildren} so the order a visitor sees can
 * never drift from the order a rewrite rebuilds.
 */
export function childExpressions(
  expr: ProjectedExpression,
): readonly ProjectedExpression[] {
  const children: ProjectedExpression[] = [];
  mapExpressionChildren(expr, (child) => {
    children.push(child);
    return child;
  });
  return children;
}

export interface StatementMappers {
  readonly expression: (expr: ProjectedExpression) => ProjectedExpression;
  readonly block: (block: ProjectedBlock) => ProjectedBlock;
}

/**
 * Rebuilds `stmt` with every expression slot and nested block replaced.
 *
 * Covers the slots that are easy to forget: the index of an array element
 * assignment target, an optional `return` value, an optional `else`, and all
 * three parts of a `for` header.
 */
export function mapStatementParts(
  stmt: ProjectedStatement,
  f: StatementMappers,
): ProjectedStatement {
  switch (stmt.kind) {
    case "ExpressionStatement":
      return { ...stmt, expression: f.expression(stmt.expression) };
    case "LetStatement":
      return { ...stmt, initializer: f.expression(stmt.initializer) };
    case "AssignmentStatement":
      return {
        ...stmt,
        target: mapTargetParts(stmt.target, f),
        value: f.expression(stmt.value),
      };
    case "SendStatement":
    case "BroadcastStatement":
      return { ...stmt, value: f.expression(stmt.value) };
    case "ReturnStatement":
      return {
        ...stmt,
        value: stmt.value === undefined ? undefined : f.expression(stmt.value),
      };
    case "IfStatement":
      return {
        ...stmt,
        condition: f.expression(stmt.condition),
        then: f.block(stmt.then),
        else: stmt.else === undefined ? undefined : f.block(stmt.else),
      };
    case "WhileStatement":
      return {
        ...stmt,
        condition: f.expression(stmt.condition),
        body: f.block(stmt.body),
      };
    case "ForStatement":
      return {
        ...stmt,
        init: stmt.init === undefined ? undefined : mapForInit(stmt.init, f),
        condition: f.expression(stmt.condition),
        update:
          stmt.update === undefined ? undefined : mapForUpdate(stmt.update, f),
        body: f.block(stmt.body),
      };
  }
}

export function mapForInit(
  init: ProjectedForInit,
  f: StatementMappers,
): ProjectedForInit {
  if (init.kind === "ForLetInit") {
    return { ...init, initializer: f.expression(init.initializer) };
  }
  return mapForUpdate(init, f);
}

export function mapForUpdate(
  update: ProjectedForUpdate,
  f: StatementMappers,
): ProjectedForUpdate {
  if (update.kind === "ForExpressionInit") {
    return { ...update, expression: f.expression(update.expression) };
  }
  return {
    ...update,
    target: mapTargetParts(update.target, f),
    value: f.expression(update.value),
  };
}

/** An index target holds an expression of its own (`xs[i] = v`). */
export function mapTargetParts(
  target: ProjectedAssignmentTarget,
  f: StatementMappers,
): ProjectedAssignmentTarget {
  if (target.kind === "IdentifierAssignmentTarget") {
    return target;
  }
  return { ...target, index: f.expression(target.index) };
}

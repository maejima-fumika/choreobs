import type { AstNode } from "./span.js";
import type { LocatedLiteral } from "./literals.js";
import type {
  BinaryOperator,
  UnaryOperator,
} from "./operators.js";

/**
 * Expression AST (spec §5.14).
 *
 * Flattened to a small set of node kinds for uniform visitors and EPP walks.
 * Precedence is resolved by the parser; the tree shape does not encode levels.
 */
export type Expression =
  | BinaryExpression
  | UnaryExpression
  | LiteralExpression
  | ArrayLiteralExpression
  | IdentifierExpression
  | CallExpression
  | IndexExpression
  | LengthExpression
  | PushExpression
  | ParenthesizedExpression;

export interface BinaryExpression extends AstNode {
  readonly kind: "BinaryExpression";
  readonly operator: BinaryOperator;
  readonly left: Expression;
  readonly right: Expression;
}

export interface UnaryExpression extends AstNode {
  readonly kind: "UnaryExpression";
  readonly operator: UnaryOperator;
  readonly operand: Expression;
}

export interface LiteralExpression extends AstNode {
  readonly kind: "LiteralExpression";
  readonly literal: LocatedLiteral;
}

export interface ArrayLiteralExpression extends AstNode {
  readonly kind: "ArrayLiteralExpression";
  readonly elements: readonly Expression[];
  readonly location?: import("./location.js").LocationAnnotation;
}

export interface IdentifierExpression extends AstNode {
  readonly kind: "IdentifierExpression";
  readonly name: string;
}

/** `f(a, b)` — callee is always a simple identifier in v0 (spec §5.14). */
export interface CallExpression extends AstNode {
  readonly kind: "CallExpression";
  readonly callee: string;
  readonly args: readonly Expression[];
}

export interface IndexExpression extends AstNode {
  readonly kind: "IndexExpression";
  readonly target: Expression;
  readonly index: Expression;
}

/**
 * The two array member operations, `xs.length` and `xs.push(v)` (spec §5.14,
 * §7.11.1).
 *
 * Both take an identifier as their receiver by grammar: with no nested arrays
 * and no objects, a variable is the only receiver that could mean anything.
 * The field is typed `Expression` so that widening the receiver later does not
 * silently change these nodes' shape.
 */
export interface LengthExpression extends AstNode {
  readonly kind: "LengthExpression";
  readonly target: Expression;
}

/**
 * `xs.push(v)` — appends to a mutable array.
 *
 * An expression of type `void` (spec §7.2, §7.11.1), so the only place it can
 * stand is an expression statement; every value position rejects it the same
 * way it rejects a call to a `void` function.
 */
export interface PushExpression extends AstNode {
  readonly kind: "PushExpression";
  readonly target: Expression;
  readonly value: Expression;
}

export interface ParenthesizedExpression extends AstNode {
  readonly kind: "ParenthesizedExpression";
  readonly expression: Expression;
}

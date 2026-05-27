import type { AstNode } from "./span.js";
import type { TypeAnnotation } from "./syntax-types.js";
import type { Expression } from "./expressions.js";

export type Statement =
  | LetStatement
  | LetReceiveStatement
  | AssignmentStatement
  | CommStatement
  | IfStatement
  | WhileStatement
  | ForStatement
  | ReturnStatement
  | ExpressionStatement;

/**
 * Ordinary initialized `let` (spec §5.6).
 * `type` is present for `let x: T = e;`, omitted for `let x = e;` (inferred in §7.14.1).
 */
export interface LetStatement extends AstNode {
  readonly kind: "LetStatement";
  readonly name: string;
  readonly type?: TypeAnnotation;
  readonly initializer: Expression;
}

/**
 * Communication `let` (spec §5.6, §7.14.3).
 * `type` is always required; destination type/location are not inferred.
 */
export interface LetReceiveStatement extends AstNode {
  readonly kind: "LetReceiveStatement";
  readonly name: string;
  readonly type: TypeAnnotation;
  readonly source: Expression;
}

/** `x = e;` — lhs is always an identifier (spec §5.7). */
export interface AssignmentStatement extends AstNode {
  readonly kind: "AssignmentStatement";
  readonly name: string;
  readonly value: Expression;
}

/** `y <~ x;` — communication statement (spec §5.8). */
export interface CommStatement extends AstNode {
  readonly kind: "CommStatement";
  readonly name: string;
  readonly source: Expression;
}

/** `if (e) { … } else { … }?` — condition is not an expression result (spec §5.9). */
export interface IfStatement extends AstNode {
  readonly kind: "IfStatement";
  readonly condition: Expression;
  readonly then: Block;
  readonly else?: Block;
}

/** `while (e) { … }` (spec §5.10). */
export interface WhileStatement extends AstNode {
  readonly kind: "WhileStatement";
  readonly condition: Expression;
  readonly body: Block;
}

/** C-style `for` only (spec §5.11). */
export interface ForStatement extends AstNode {
  readonly kind: "ForStatement";
  readonly init?: ForInit;
  readonly condition?: Expression;
  readonly update?: ForUpdate;
  readonly body: Block;
}

export type ForInit = ForLetInit | ForLetReceiveInit | ForAssignmentInit;

/**
 * `let i: T = e` or `let i = e` in for-header (spec §5.11, §7.14.2).
 * `type` omitted when inferred from `initializer`.
 */
export interface ForLetInit extends AstNode {
  readonly kind: "ForLetInit";
  readonly name: string;
  readonly type?: TypeAnnotation;
  readonly initializer: Expression;
}

/** `let y: T <~ e` in for-header (spec §5.11); `type` is always required. */
export interface ForLetReceiveInit extends AstNode {
  readonly kind: "ForLetReceiveInit";
  readonly name: string;
  readonly type: TypeAnnotation;
  readonly source: Expression;
}

/** `i = e` in for-header (no trailing `;`). */
export interface ForAssignmentInit extends AstNode {
  readonly kind: "ForAssignmentInit";
  readonly name: string;
  readonly value: Expression;
}

export type ForUpdate = ForAssignmentInit;

/** `return e;` or `return;` (spec §5.12). */
export interface ReturnStatement extends AstNode {
  readonly kind: "ReturnStatement";
  readonly value?: Expression;
}

/** `e;` (spec §5.13). */
export interface ExpressionStatement extends AstNode {
  readonly kind: "ExpressionStatement";
  readonly expression: Expression;
}

export interface Block extends AstNode {
  readonly kind: "Block";
  readonly statements: readonly Statement[];
}

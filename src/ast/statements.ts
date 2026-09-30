import type { AstNode } from "./span.js";
import type { TypeAnnotation } from "./syntax-types.js";
import type { Expression } from "./expressions.js";

export type Statement =
  | LetStatement
  | LetTransferStatement
  | AssignmentStatement
  | TransferStatement
  | IfStatement
  | WhileStatement
  | ForStatement
  | ReturnStatement
  | ExpressionStatement;

/**
 * Ordinary initialized `let` (spec §let-statement).
 * `type` is present for `let x: T = e;`, omitted for `let x = e;` (inferred in §let-type-inference).
 */
export interface LetStatement extends AstNode {
  readonly kind: "LetStatement";
  readonly name: string;
  readonly type?: TypeAnnotation;
  readonly initializer: Expression;
}

/**
 * Transfer `let` (spec §let-statement, §transfer-let-does-not-infer-destination-type).
 * `type` is always required; destination type/location are not inferred from the
 * source. A destination written without its location is `dyn` (spec §omitted-locations).
 */
export interface LetTransferStatement extends AstNode {
  readonly kind: "LetTransferStatement";
  readonly name: string;
  readonly type: TypeAnnotation;
  readonly source: Expression;
}

/** `x = e;` — lhs is always an identifier (spec §assignment-statement). */
export interface AssignmentStatement extends AstNode {
  readonly kind: "AssignmentStatement";
  readonly target: AssignmentTarget;
  readonly value: Expression;
}

export type AssignmentTarget = IdentifierAssignmentTarget | IndexAssignmentTarget;

export interface IdentifierAssignmentTarget extends AstNode {
  readonly kind: "IdentifierAssignmentTarget";
  readonly name: string;
}

export interface IndexAssignmentTarget extends AstNode {
  readonly kind: "IndexAssignmentTarget";
  readonly name: string;
  readonly index: Expression;
}

/** `y <- x;` — transfer statement (spec §transfer-statement). */
export interface TransferStatement extends AstNode {
  readonly kind: "TransferStatement";
  readonly name: string;
  readonly source: Expression;
}

/** `if (e) { … } else { … }?` — condition is not an expression result (spec §if-statement). */
export interface IfStatement extends AstNode {
  readonly kind: "IfStatement";
  readonly condition: Expression;
  readonly then: Block;
  readonly else?: Block;
}

/** `while (e) { … }` (spec §while-statement). */
export interface WhileStatement extends AstNode {
  readonly kind: "WhileStatement";
  readonly condition: Expression;
  readonly body: Block;
}

/** C-style `for` only (spec §for-statement). */
export interface ForStatement extends AstNode {
  readonly kind: "ForStatement";
  readonly init?: ForInit;
  /** Required: an omitted condition has no location to take (spec §for-statement). */
  readonly condition: Expression;
  readonly update?: ForUpdate;
  readonly body: Block;
}

export type ForInit = ForLetInit | ForAssignmentInit;

/**
 * `let i: T = e` or `let i = e` in for-header (spec §for-statement, §for-initializer-let-type-inference).
 * `type` omitted when inferred from `initializer`.
 */
export interface ForLetInit extends AstNode {
  readonly kind: "ForLetInit";
  readonly name: string;
  readonly type?: TypeAnnotation;
  readonly initializer: Expression;
}

/**
 * `i = e` or `xs[i] = e` in a for-header (no trailing `;`).
 *
 * The target is the same `AssignmentTarget` an assignment statement takes
 * (spec §assignment-statement, §for-statement); the two forms of assignment are not meant to differ
 * inside and outside a for-header.
 */
export interface ForAssignmentInit extends AstNode {
  readonly kind: "ForAssignmentInit";
  readonly target: AssignmentTarget;
  readonly value: Expression;
}

export type ForUpdate = ForAssignmentInit;

/** `return e;` or `return;` (spec §return-statement). */
export interface ReturnStatement extends AstNode {
  readonly kind: "ReturnStatement";
  readonly value?: Expression;
}

/** `e;` (spec §expression-statement). */
export interface ExpressionStatement extends AstNode {
  readonly kind: "ExpressionStatement";
  readonly expression: Expression;
}

export interface Block extends AstNode {
  readonly kind: "Block";
  readonly statements: readonly Statement[];
}

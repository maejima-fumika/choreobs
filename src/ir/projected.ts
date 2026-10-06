import type { Span } from "../ast/span.js";
import type { DeclarationKeyword } from "../ast/statements.js";
import type { BaseType, NumericType } from "../ast/syntax-types.js";
import type {
  ArithmeticOperator,
  RelationalOperator,
  EqualityOperator,
  LogicalOperator,
  UnaryOperator,
} from "../ast/operators.js";

/**
 * ChoreoBS `void` projects to `void` at every endpoint (spec §type-projection),
 * and a `dyn` type to the runtime's `__DynVal` (spec §type-projection).
 *
 * The array types keep their element type here. Code generation writes all
 * three as BlueScript's `any[]` (spec §type-mapping).
 */
export type ProjectedBaseType =
  | BaseType
  | "void"
  | "integer[]"
  | "float[]"
  | "boolean[]"
  | "__DynVal";

/**
 * Projected type: present base type or internal absent (spec §type-projection, §absent).
 * Absent types finalize to `null` in BlueScript (not done in EPP).
 */
export type ProjectedType =
  | { readonly kind: "PresentType"; readonly base: ProjectedBaseType }
  | { readonly kind: "AbsentType" };

/**
 * Payload kinds the communication API can carry (spec §communication-api).
 *
 * This is deliberately a closed set rather than `BaseType`: `void` has no value
 * to send (spec §void). Every array travels as the one kind `array`, since an
 * array is a BlueScript `any[]` whatever its element type (spec §type-mapping).
 * Anything that is not listed here must be rejected before EPP, never
 * defaulted to some other kind.
 */
export type CommKind =
  | "integer"
  | "float"
  | "boolean"
  | "string"
  | "null"
  | "array";

export type ProjectedExpression =
  | AbsentExpression
  | IntegerLiteralExpression
  | FloatLiteralExpression
  | StringLiteralExpression
  | BooleanLiteralExpression
  | NullLiteralExpression
  | IdentifierExpression
  | BinaryExpression
  | UnaryExpression
  | ConversionExpression
  | CallExpression
  | IndexExpression
  | PropertyLengthExpression
  | NothingExpression
  | ParenthesizedExpression
  | ReceiveExpression;

/** Internal absent expression (spec §absent). */
export interface AbsentExpression {
  readonly kind: "AbsentExpression";
  readonly span: Span;
}

export interface IntegerLiteralExpression {
  readonly kind: "IntegerLiteralExpression";
  readonly value: number;
  readonly span: Span;
}

export interface FloatLiteralExpression {
  readonly kind: "FloatLiteralExpression";
  readonly value: number;
  readonly span: Span;
}

export interface StringLiteralExpression {
  readonly kind: "StringLiteralExpression";
  readonly value: string;
  readonly span: Span;
}

export interface BooleanLiteralExpression {
  readonly kind: "BooleanLiteralExpression";
  readonly value: boolean;
  readonly span: Span;
}

export interface NullLiteralExpression {
  readonly kind: "NullLiteralExpression";
  readonly span: Span;
}

export interface IdentifierExpression {
  readonly kind: "IdentifierExpression";
  readonly name: string;
  readonly span: Span;
}

export interface BinaryExpression {
  readonly kind: "BinaryExpression";
  readonly operator:
    | ArithmeticOperator
    | RelationalOperator
    | EqualityOperator
    | LogicalOperator;
  readonly left: ProjectedExpression;
  readonly right: ProjectedExpression;
  readonly span: Span;
}

export interface UnaryExpression {
  readonly kind: "UnaryExpression";
  readonly operator: UnaryOperator;
  readonly operand: ProjectedExpression;
  readonly span: Span;
}

/**
 * Emitted as BlueScript's own `as` (spec §numeric-conversion-code-generation).
 * `source` is the operand's type, which code generation spells out when it
 * differs from `target`.
 */
export interface ConversionExpression {
  readonly kind: "ConversionExpression";
  readonly source: NumericType;
  readonly target: NumericType;
  readonly operand: ProjectedExpression;
  readonly span: Span;
}

export interface CallExpression {
  readonly kind: "CallExpression";
  readonly callee: string;
  readonly args: readonly ProjectedExpression[];
  readonly span: Span;
}

export interface IndexExpression {
  readonly kind: "IndexExpression";
  readonly target: ProjectedExpression;
  readonly index: ProjectedExpression;
  readonly span: Span;
}

export interface PropertyLengthExpression {
  readonly kind: "PropertyLengthExpression";
  readonly target: ProjectedExpression;
  readonly span: Span;
}

/**
 * Compiler-generated `nothing(...)` artifact (spec §absent, §nothing).
 * Distinct from {@link CallExpression} so user-defined functions named `nothing` are preserved.
 */
export interface NothingExpression {
  readonly kind: "NothingExpression";
  readonly parts: readonly ProjectedExpression[];
  readonly span: Span;
}

export interface ParenthesizedExpression {
  readonly kind: "ParenthesizedExpression";
  readonly expression: ProjectedExpression;
  readonly span: Span;
}

/** `receiveInteger("alice", "__top_0")` etc. (spec §transfer-projection). */
export interface ReceiveExpression {
  readonly kind: "ReceiveExpression";
  readonly comm: CommKind;
  readonly sourceEndpoint: string;
  readonly tag: string;
  readonly span: Span;
}

export type ProjectedStatement =
  | LetStatement
  | AssignmentStatement
  | SendStatement
  | BroadcastStatement
  | IfStatement
  | WhileStatement
  | ForStatement
  | ReturnStatement
  | ExpressionStatement;

export interface LetStatement {
  readonly kind: "LetStatement";
  /**
   * The source declaration's keyword, kept in the output (spec §let-projection).
   * A binding EPP introduces itself is a `let`.
   */
  readonly keyword: DeclarationKeyword;
  readonly name: string;
  readonly type: ProjectedType;
  readonly initializer: ProjectedExpression;
  readonly span: Span;
}

export interface AssignmentStatement {
  readonly kind: "AssignmentStatement";
  readonly target: ProjectedAssignmentTarget;
  readonly value: ProjectedExpression;
  readonly span: Span;
}

export type ProjectedAssignmentTarget =
  | ProjectedIdentifierAssignmentTarget
  | ProjectedIndexAssignmentTarget;

export interface ProjectedIdentifierAssignmentTarget {
  readonly kind: "IdentifierAssignmentTarget";
  readonly name: string;
}

export interface ProjectedIndexAssignmentTarget {
  readonly kind: "IndexAssignmentTarget";
  readonly name: string;
  readonly index: ProjectedExpression;
}

export interface SendStatement {
  readonly kind: "SendStatement";
  readonly comm: CommKind;
  readonly destinationEndpoint: string;
  readonly tag: string;
  readonly value: ProjectedExpression;
  readonly span: Span;
}

export interface BroadcastStatement {
  readonly kind: "BroadcastStatement";
  readonly comm: CommKind;
  readonly tag: string;
  readonly value: ProjectedExpression;
  readonly span: Span;
}

export interface IfStatement {
  readonly kind: "IfStatement";
  readonly condition: ProjectedExpression;
  readonly then: ProjectedBlock;
  readonly else?: ProjectedBlock;
  readonly span: Span;
}

export interface WhileStatement {
  readonly kind: "WhileStatement";
  readonly condition: ProjectedExpression;
  readonly body: ProjectedBlock;
  readonly span: Span;
}

export interface ForStatement {
  readonly kind: "ForStatement";
  readonly init?: ProjectedForInit;
  readonly condition: ProjectedExpression;
  readonly update?: ProjectedForUpdate;
  readonly body: ProjectedBlock;
  readonly span: Span;
}

export type ProjectedForInit =
  | ProjectedForLetInit
  | ProjectedForAssignmentInit
  | ProjectedForExpressionInit;

export interface ProjectedForLetInit {
  readonly kind: "ForLetInit";
  readonly name: string;
  readonly type: ProjectedType;
  readonly initializer: ProjectedExpression;
  readonly span: Span;
}

export interface ProjectedForAssignmentInit {
  readonly kind: "ForAssignmentInit";
  readonly target: ProjectedAssignmentTarget;
  readonly value: ProjectedExpression;
  readonly span: Span;
}

/**
 * A for-header slot that is not an assignment here.
 *
 * A for-header has no room for a statement, so when the assignment target is
 * absent at this endpoint the slot either disappears or — if the discarded
 * value still contains a call this endpoint must make (spec §expression-projection) — becomes
 * the bare expression that keeps that call. A dynamic element assignment is
 * one too: it is the `void` call `__dynArraySet(xs, i, v)`, which every endpoint
 * makes (spec §dyn-lowering).
 */
export interface ProjectedForExpressionInit {
  readonly kind: "ForExpressionInit";
  readonly expression: ProjectedExpression;
  readonly span: Span;
}

export type ProjectedForUpdate =
  | ProjectedForAssignmentInit
  | ProjectedForExpressionInit;

export interface ReturnStatement {
  readonly kind: "ReturnStatement";
  readonly value?: ProjectedExpression;
  readonly span: Span;
}

export interface ExpressionStatement {
  readonly kind: "ExpressionStatement";
  readonly expression: ProjectedExpression;
  readonly span: Span;
}

export interface ProjectedBlock {
  readonly kind: "ProjectedBlock";
  readonly statements: readonly ProjectedStatement[];
  readonly span: Span;
}

export interface ProjectedParameter {
  readonly name: string;
  readonly type: ProjectedType;
  readonly span: Span;
}

export interface ProjectedFunction {
  readonly kind: "ProjectedFunction";
  readonly name: string;
  readonly params: readonly ProjectedParameter[];
  readonly returnType: ProjectedType;
  readonly body: ProjectedBlock;
  readonly span: Span;
}

/** Per-endpoint projected program (spec §epp-definition, §top-level-projection). */
export interface ProjectedProgram {
  readonly kind: "ProjectedProgram";
  readonly endpoint: string;
  readonly functions: readonly ProjectedFunction[];
  readonly body: readonly ProjectedStatement[];
  readonly span: Span;
}

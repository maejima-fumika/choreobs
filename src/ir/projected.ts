import type { Span } from "../ast/span.js";
import type { BaseType } from "../ast/syntax-types.js";
import type {
  ArithmeticOperator,
  RelationalOperator,
  EqualityOperator,
  LogicalOperator,
  UnaryOperator,
} from "../ast/operators.js";

/** ChoreoBS `unit` projects to `void` (spec §12.2). */
export type ProjectedBaseType = BaseType | "void";

/**
 * Projected type: present base type or internal absent (spec §12.2, §12.4).
 * Absent types finalize to `null` in BlueScript (not done in EPP).
 */
export type ProjectedType =
  | { readonly kind: "PresentType"; readonly base: ProjectedBaseType }
  | { readonly kind: "AbsentType" };

export type CommKind = "integer" | "float" | "boolean" | "string";

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
  | CallExpression
  | ParenthesizedExpression
  | ReceiveExpression;

/** Internal absent expression (spec §12.4). */
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

export interface CallExpression {
  readonly kind: "CallExpression";
  readonly callee: string;
  readonly args: readonly ProjectedExpression[];
  readonly span: Span;
}

export interface ParenthesizedExpression {
  readonly kind: "ParenthesizedExpression";
  readonly expression: ProjectedExpression;
  readonly span: Span;
}

/** `receiveInteger("alice", "top_0")` etc. (spec §12.9). */
export interface ReceiveExpression {
  readonly kind: "ReceiveExpression";
  readonly comm: CommKind;
  readonly sourceParticipant: string;
  readonly tag: string;
  readonly span: Span;
}

export type ProjectedStatement =
  | AbsentStatement
  | NothingStatement
  | LetStatement
  | AssignmentStatement
  | SendStatement
  | BroadcastStatement
  | IfStatement
  | WhileStatement
  | ForStatement
  | ReturnStatement
  | ExpressionStatement;

/** Statement with no runtime meaning at this participant (spec §12.4). */
export interface AbsentStatement {
  readonly kind: "AbsentStatement";
  readonly span: Span;
}

/**
 * `nothing(...)` placeholder — operands finalize later (spec §12.4, §14).
 * `parts` holds projected subexpressions (often {@link AbsentExpression}).
 */
export interface NothingStatement {
  readonly kind: "NothingStatement";
  readonly parts: readonly ProjectedExpression[];
  readonly span: Span;
}

export interface LetStatement {
  readonly kind: "LetStatement";
  readonly name: string;
  readonly type: ProjectedType;
  readonly initializer: ProjectedExpression;
  readonly span: Span;
}

export interface AssignmentStatement {
  readonly kind: "AssignmentStatement";
  readonly name: string;
  readonly value: ProjectedExpression;
  readonly span: Span;
}

export interface SendStatement {
  readonly kind: "SendStatement";
  readonly comm: CommKind;
  readonly destinationParticipant: string;
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
  readonly condition?: ProjectedExpression;
  readonly update?: ProjectedForUpdate;
  readonly body: ProjectedBlock;
  readonly span: Span;
}

export type ProjectedForInit = ProjectedForLetInit | ProjectedForAssignmentInit;

export interface ProjectedForLetInit {
  readonly kind: "ForLetInit";
  readonly name: string;
  readonly type: ProjectedType;
  readonly initializer: ProjectedExpression;
  readonly span: Span;
}

export interface ProjectedForAssignmentInit {
  readonly kind: "ForAssignmentInit";
  readonly name: string;
  readonly value: ProjectedExpression;
  readonly span: Span;
}

export type ProjectedForUpdate = ProjectedForAssignmentInit;

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

/** Per-participant projected program (spec §12.1, §12.15). */
export interface ProjectedProgram {
  readonly kind: "ProjectedProgram";
  readonly participant: string;
  readonly functions: readonly ProjectedFunction[];
  readonly body: readonly ProjectedStatement[];
  readonly span: Span;
}

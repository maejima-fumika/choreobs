import type { Program } from "./program.js";
import type { TopLevelStatement } from "./program.js";
import type { FunctionDeclaration, Parameter } from "./declarations.js";
import type {
  Statement,
  LetStatement,
  LetTransferStatement,
  AssignmentStatement,
  AssignmentTarget,
  TransferStatement,
  IfStatement,
  WhileStatement,
  ForStatement,
  ReturnStatement,
  ExpressionStatement,
  ForLetInit,
  ForAssignmentInit,
  Block,
} from "./statements.js";
import type {
  Expression,
  BinaryExpression,
  UnaryExpression,
  LiteralExpression,
  ArrayLiteralExpression,
  IdentifierExpression,
  CallExpression,
  IndexExpression,
  ParenthesizedExpression,
} from "./expressions.js";
import type { LocatedLiteral } from "./literals.js";
import type { TypeAnnotation } from "./syntax-types.js";
import type { ExecutionContext } from "./context.js";
import type { Location } from "./location.js";

/**
 * Fully resolved located type `T@L` after type-checking (spec §7.2).
 * Attached to typed AST nodes for EPP and diagnostics.
 */
export interface LocatedType {
  readonly base: TypeAnnotation["base"];
  readonly isArray?: boolean;
  readonly location: Location;
}

/** Communication tag assigned before EPP (spec §11.5). */
export type CommTag = string;

/** How `<-` transfers a value (spec §7.8). */
export type TransferMode = "direct" | "broadcast" | "localCopy";

// ---------------------------------------------------------------------------
// Typed AST — mirrors syntactic nodes with `choreoType` and comm metadata.
// Built by the type checker; not produced by the parser.
// ---------------------------------------------------------------------------

export interface TypedProgram {
  readonly kind: "TypedProgram";
  readonly program: Program;
  readonly items: readonly TypedTopLevelItem[];
}

export type TypedTopLevelItem = TypedFunctionDeclaration | TypedTopLevelStatement;

export interface TypedTopLevelStatement {
  readonly item: TopLevelStatement;
  readonly context: ExecutionContext;
  readonly statement: TypedStatement;
}

export interface TypedFunctionDeclaration {
  readonly decl: FunctionDeclaration;
  readonly context: ExecutionContext;
  readonly returnType: LocatedType;
  readonly params: readonly TypedParameter[];
  readonly body: TypedBlock;
}

export interface TypedParameter {
  readonly param: Parameter;
  readonly type: LocatedType;
}

export type TypedStatement =
  | TypedLetStatement
  | TypedLetTransferStatement
  | TypedAssignmentStatement
  | TypedTransferStatement
  | TypedIfStatement
  | TypedWhileStatement
  | TypedForStatement
  | TypedReturnStatement
  | TypedExpressionStatement;

export interface TypedLetStatement {
  readonly stmt: LetStatement;
  readonly choreoType: LocatedType;
  readonly initializer: TypedExpression;
}

export interface TypedLetTransferStatement {
  readonly stmt: LetTransferStatement;
  readonly choreoType: LocatedType;
  readonly source: TypedExpression;
  readonly transferMode: TransferMode;
  readonly commTag?: CommTag;
}

export interface TypedAssignmentStatement {
  readonly stmt: AssignmentStatement;
  readonly target: TypedAssignmentTarget;
  readonly value: TypedExpression;
}

export interface TypedIdentifierAssignmentTarget {
  readonly target: AssignmentTarget & { readonly kind: "IdentifierAssignmentTarget" };
  readonly targetType: LocatedType;
}

export interface TypedIndexAssignmentTarget {
  readonly target: AssignmentTarget & { readonly kind: "IndexAssignmentTarget" };
  readonly arrayType: LocatedType;
  readonly index: TypedExpression;
  readonly elementType: LocatedType;
}

export type TypedAssignmentTarget =
  | TypedIdentifierAssignmentTarget
  | TypedIndexAssignmentTarget;

export interface TypedTransferStatement {
  readonly stmt: TransferStatement;
  readonly targetType: LocatedType;
  readonly source: TypedExpression;
  readonly transferMode: TransferMode;
  readonly commTag?: CommTag;
}

export interface TypedIfStatement {
  readonly stmt: IfStatement;
  readonly condition: TypedExpression;
  readonly then: TypedBlock;
  readonly else?: TypedBlock;
}

export interface TypedWhileStatement {
  readonly stmt: WhileStatement;
  readonly condition: TypedExpression;
  readonly body: TypedBlock;
}

export interface TypedForStatement {
  readonly stmt: ForStatement;
  readonly init?: TypedForInit;
  readonly condition?: TypedExpression;
  readonly update?: TypedForUpdate;
  readonly body: TypedBlock;
}

export type TypedForInit = TypedForLetInit | TypedForAssignmentInit;

export interface TypedForLetInit {
  readonly init: ForLetInit;
  readonly choreoType: LocatedType;
  readonly initializer: TypedExpression;
}

export interface TypedForAssignmentInit {
  readonly init: ForAssignmentInit;
  readonly targetType: LocatedType;
  readonly value: TypedExpression;
}

export type TypedForUpdate = TypedForAssignmentInit;

export interface TypedReturnStatement {
  readonly stmt: ReturnStatement;
  readonly value?: TypedExpression;
}

export interface TypedExpressionStatement {
  readonly stmt: ExpressionStatement;
  readonly expression: TypedExpression;
}

export interface TypedBlock {
  readonly context: ExecutionContext;
  readonly block: Block;
  readonly statements: readonly TypedStatement[];
}

export type TypedExpression =
  | TypedBinaryExpression
  | TypedUnaryExpression
  | TypedLiteralExpression
  | TypedArrayLiteralExpression
  | TypedIdentifierExpression
  | TypedCallExpression
  | TypedIndexExpression
  | TypedParenthesizedExpression;

export interface TypedBinaryExpression {
  readonly expr: BinaryExpression;
  readonly choreoType: LocatedType;
  readonly left: TypedExpression;
  readonly right: TypedExpression;
}

export interface TypedUnaryExpression {
  readonly expr: UnaryExpression;
  readonly choreoType: LocatedType;
  readonly operand: TypedExpression;
}

export interface TypedLiteralExpression {
  readonly expr: LiteralExpression;
  readonly choreoType: LocatedType;
  readonly literal: LocatedLiteral;
}

export interface TypedArrayLiteralExpression {
  readonly expr: ArrayLiteralExpression;
  readonly choreoType: LocatedType;
  readonly elements: readonly TypedExpression[];
}

export interface TypedIdentifierExpression {
  readonly expr: IdentifierExpression;
  readonly choreoType: LocatedType;
}

export interface TypedCallExpression {
  readonly expr: CallExpression;
  readonly choreoType: LocatedType;
  readonly callee: FunctionSymbol;
  readonly args: readonly TypedExpression[];
}

export interface TypedIndexExpression {
  readonly expr: IndexExpression;
  readonly choreoType: LocatedType;
  readonly target: TypedExpression;
  readonly index: TypedExpression;
}

export interface TypedParenthesizedExpression {
  readonly expr: ParenthesizedExpression;
  readonly choreoType: LocatedType;
  readonly expression: TypedExpression;
}

/** Resolved function for calls and EPP (spec §7.12, §10, §12.11). */
export interface FunctionSymbol {
  readonly name: string;
  readonly context: ExecutionContext;
  readonly params: readonly LocatedType[];
  readonly returnType: LocatedType;
  readonly decl: FunctionDeclaration;
}

/** Narrow typed expressions by syntactic kind. */
export type TypedExpressionOf<K extends Expression["kind"]> = Extract<
  TypedExpression,
  { readonly expr: { readonly kind: K } }
>;

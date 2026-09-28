import type { Program } from "./program.js";
import type { TopLevelStatement } from "./program.js";
import type { FunctionDeclaration, Parameter } from "./declarations.js";
import type {
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
  BinaryExpression,
  UnaryExpression,
  ConversionExpression,
  LiteralExpression,
  ArrayLiteralExpression,
  IdentifierExpression,
  CallExpression,
  IndexExpression,
  LengthExpression,
  PushExpression,
  ParenthesizedExpression,
} from "./expressions.js";
import type { LocatedLiteral } from "./literals.js";
import type { TypeAnnotation } from "./syntax-types.js";
import type { ExecutionContext } from "./context.js";
import type { Location } from "./location.js";
import type { Span } from "./span.js";
import type { DynRuntimeFunction } from "../runtime/dyn.js";

/**
 * Fully resolved located type `T@L` after type-checking (spec §located-types).
 * Attached to typed AST nodes for EPP and diagnostics.
 */
export interface LocatedType {
  readonly base: TypeAnnotation["base"];
  readonly isArray?: boolean;
  readonly location: Location;
}

/** Communication tag assigned before EPP (spec §communication-tags). */
export type CommTag = string;

/**
 * How `<-` transfers a value (spec §transfer-typing).
 *
 * `dynamic` is a transfer with `dyn` on either side (spec-dyn.md, section 3.5).
 * It is tagged like `direct` and `broadcast`, and `lowerDyn` then rewrites it
 * into a `let` or an assignment of `__dynTransfer(...)`, so endpoint projection
 * never sees one.
 */
export type TransferMode = "direct" | "broadcast" | "localCopy" | "dynamic";

// ---------------------------------------------------------------------------
// Typed AST — mirrors syntactic nodes with `choreoType` and comm metadata.
// Built by the type checker; not produced by the parser.
// ---------------------------------------------------------------------------

export interface TypedProgram {
  readonly kind: "TypedProgram";
  readonly program: Program;
  readonly items: readonly TypedTopLevelItem[];
}

/**
 * A typed program after `lowerDyn` (spec-dyn.md, section 8.2): every dynamic
 * operation is a {@link TypedRuntimeCallExpression}, every `dyn` value that
 * meets a concrete location has been injected or cast, and no transfer is
 * `dynamic`. What is left obeys the static location rules throughout.
 *
 * Endpoint projection takes only this, so that no entry point can skip the
 * lowering the way one once skipped tag assignment.
 */
export interface LoweredProgram {
  readonly kind: "LoweredProgram";
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
  readonly condition: TypedExpression;
  readonly update?: TypedForUpdate;
  readonly body: TypedBlock;
}

export type TypedForInit =
  | TypedForLetInit
  | TypedForAssignmentInit
  | TypedForExpressionInit;

export interface TypedForLetInit {
  readonly init: ForLetInit;
  readonly choreoType: LocatedType;
  readonly initializer: TypedExpression;
}

export interface TypedForAssignmentInit {
  readonly init: ForAssignmentInit;
  readonly target: TypedAssignmentTarget;
  readonly value: TypedExpression;
}

export type TypedForUpdate = TypedForAssignmentInit | TypedForExpressionInit;

/**
 * A `for` header slot holding a bare expression. The parser never makes one:
 * `lowerDyn` does, for a dynamic element assignment `xs[i] = v`, which becomes
 * the void call `__dynArraySet(xs, i, v)` (spec-dyn.md, section 12.2) and so is
 * no longer an assignment. It projects to `ProjectedForExpressionInit`.
 */
export interface TypedForExpressionInit {
  readonly init: { readonly kind: "ForExpressionInit"; readonly span: Span };
  readonly expression: TypedExpression;
}

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
  | TypedConversionExpression
  | TypedLiteralExpression
  | TypedArrayLiteralExpression
  | TypedIdentifierExpression
  | TypedCallExpression
  | TypedIndexExpression
  | TypedLengthExpression
  | TypedPushExpression
  | TypedParenthesizedExpression
  | TypedRuntimeCallExpression;

/**
 * A call to a function of the dynamic-location runtime — `__inject`, `__cast`,
 * `__dynPlus`, … (spec-dyn.md, section 8.2).
 *
 * Only `lowerDyn` builds these, so the syntax it stands in for is synthetic:
 * the span is that of the construct it came from. It projects like a call to
 * a choreography function, which every endpoint makes; that is all endpoint
 * projection needs to know about dynamic operations.
 */
export interface TypedRuntimeCallExpression {
  readonly expr: { readonly kind: "RuntimeCallExpression"; readonly span: Span };
  readonly choreoType: LocatedType;
  readonly callee: DynRuntimeFunction;
  readonly args: readonly TypedExpression[];
}

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

export interface TypedConversionExpression {
  readonly expr: ConversionExpression;
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

export interface TypedLengthExpression {
  readonly expr: LengthExpression;
  /** Always `integer@L`, where `L` is the array's location (spec §array-typing). */
  readonly choreoType: LocatedType;
  readonly target: TypedExpression;
}

export interface TypedPushExpression {
  readonly expr: PushExpression;
  /**
   * Always `void` (spec §array-typing). The location is the array's, and is never
   * written or shown (spec §void): it is what tells endpoint projection which
   * endpoints perform the append.
   */
  readonly choreoType: LocatedType;
  readonly target: TypedExpression;
  readonly value: TypedExpression;
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

/** Resolved function for calls and EPP (spec §function-call-typing, §function-rules, §function-projection). */
export interface FunctionSymbol {
  readonly name: string;
  readonly context: ExecutionContext;
  readonly params: readonly LocatedType[];
  readonly returnType: LocatedType;
  readonly decl: FunctionDeclaration;
}

/** Narrow typed expressions by syntactic kind. */
export type TypedExpressionOf<K extends TypedExpression["expr"]["kind"]> = Extract<
  TypedExpression,
  { readonly expr: { readonly kind: K } }
>;

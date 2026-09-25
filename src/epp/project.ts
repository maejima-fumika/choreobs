import type { Span } from "../ast/span.js";
import { specRef } from "../spec/ref.js";
import type { Location } from "../ast/location.js";
import type { CommTag, LocatedType, TransferMode } from "../ast/typed.js";
import type { FunctionDeclaration } from "../ast/declarations.js";
import type {
  TypedProgram,
  TypedFunctionDeclaration,
  TypedTopLevelStatement,
  TypedStatement,
  TypedBlock,
  TypedExpression,
  TypedLetStatement,
  TypedLetTransferStatement,
  TypedAssignmentStatement,
  TypedTransferStatement,
  TypedPushExpression,
  TypedIfStatement,
  TypedWhileStatement,
  TypedForStatement,
  TypedForInit,
  TypedForLetInit,
  TypedForAssignmentInit,
  TypedReturnStatement,
  TypedExpressionStatement,
  TypedLiteralExpression,
  TypedArrayLiteralExpression,
  TypedBinaryExpression,
  TypedUnaryExpression,
  TypedConversionExpression,
  TypedCallExpression,
  TypedIndexExpression,
  TypedLengthExpression,
  TypedParenthesizedExpression,
} from "../ast/typed.js";
import { residesAt } from "../types/located.js";
import type {
  ProjectedProgram,
  ProjectedFunction,
  ProjectedStatement,
  ProjectedBlock,
  ProjectedExpression,
  ProjectedType,
  ProjectedParameter,
  CommKind,
  AbsentExpression,
  ReceiveExpression,
} from "../ir/projected.js";
import { cloneFunction } from "../emit/comm.js";
import {
  ARRAY_SENTINEL,
  PUSH_SENTINEL,
  TRANSFER_TEMP_PREFIX,
} from "../runtime/names.js";

export function projectAll(
  typed: TypedProgram,
  endpoints: readonly string[],
): readonly ProjectedProgram[] {
  return endpoints.map((endpoint) => project(typed, endpoint));
}

export function project(
  typed: TypedProgram,
  endpoint: string,
): ProjectedProgram {
  return new Projector(endpoint).projectProgram(typed);
}

/** A transfer statement's parts, independent of its `let` / assignment form. */
interface TransferParts {
  readonly name: string;
  /** The destination's type, which carries the location the value lands at. */
  readonly type: LocatedType;
  readonly source: TypedExpression;
  readonly mode: TransferMode;
  readonly commTag?: CommTag;
  readonly span: Span;
}

/** Binds a transferred value at its destination: `let x = v;` or `x = v;`. */
type BindTransfer = (value: ProjectedExpression) => ProjectedStatement;

class Projector {
  private loopDepth = 0;
  private transferTemps = 0;

  constructor(private readonly endpoint: string) {}

  projectProgram(typed: TypedProgram): ProjectedProgram {
    const functions: ProjectedFunction[] = [];
    const body: ProjectedStatement[] = [];

    for (const item of typed.items) {
      if ("decl" in item) {
        const fn = this.projectFunctionDecl(item);
        if (fn !== undefined) {
          functions.push(fn);
        }
      } else {
        body.push(...this.flatten(this.projectTopLevelStatement(item)));
      }
    }

    return {
      kind: "ProjectedProgram",
      endpoint: this.endpoint,
      functions,
      body,
      span: typed.program.span,
    };
  }

  private projectFunctionDecl(
    item: TypedFunctionDeclaration,
  ): ProjectedFunction | undefined {
    const decl = item.decl;
    if (!this.shouldEmitFunction(decl)) {
      return undefined;
    }

    const params: ProjectedParameter[] = item.params.map((p) => ({
      name: p.param.name,
      type: this.projectType(p.type),
      span: p.param.span,
    }));

    return {
      kind: "ProjectedFunction",
      name: decl.name,
      params,
      returnType: this.projectType(item.returnType),
      body: this.projectBlock(item.body),
      span: decl.span,
    };
  }

  private shouldEmitFunction(decl: FunctionDeclaration): boolean {
    if (decl.at === undefined) {
      return true;
    }
    return decl.at.kind === "individual" && decl.at.name === this.endpoint;
  }

  private projectTopLevelStatement(
    item: TypedTopLevelStatement,
  ): ProjectedStatement | ProjectedStatement[] {
    return this.projectStatement(item.statement);
  }

  private projectBlock(block: TypedBlock): ProjectedBlock {
    const statements: ProjectedStatement[] = [];
    for (const stmt of block.statements) {
      statements.push(...this.flatten(this.projectStatement(stmt)));
    }
    return {
      kind: "ProjectedBlock",
      statements,
      span: block.block.span,
    };
  }

  private projectStatement(
    stmt: TypedStatement,
  ): ProjectedStatement | ProjectedStatement[] {
    switch (stmt.stmt.kind) {
      case "LetStatement":
        return this.projectLet(stmt as TypedLetStatement);
      case "LetTransferStatement":
        return this.projectLetTransfer(stmt as TypedLetTransferStatement);
      case "AssignmentStatement":
        return this.projectAssignment(stmt as TypedAssignmentStatement);
      case "TransferStatement":
        return this.projectComm(stmt as TypedTransferStatement);
      case "IfStatement":
        return this.projectIf(stmt as TypedIfStatement);
      case "WhileStatement":
        return this.projectWhile(stmt as TypedWhileStatement);
      case "ForStatement":
        return this.projectFor(stmt as TypedForStatement);
      case "ReturnStatement":
        return this.projectReturn(stmt as TypedReturnStatement);
      case "ExpressionStatement":
        return this.projectExpressionStatement(stmt as TypedExpressionStatement);
    }
  }

  private projectLet(
    stmt: TypedLetStatement,
  ): ProjectedStatement {
    const span = stmt.stmt.span;
    if (!this.residesHere(stmt.choreoType.location)) {
      return this.discardStatement(span, stmt.initializer);
    }
    return {
      kind: "LetStatement",
      name: stmt.stmt.name,
      type: this.projectType(stmt.choreoType),
      initializer: this.projectExpression(stmt.initializer),
      span,
    };
  }

  /**
   * A transfer statement's parts, independent of whether it was written as a
   * `let` declaration or as a store into an existing variable (spec §transfer-statement).
   *
   * The two typed nodes share no field for the destination's type — one calls
   * it `choreoType`, the other `targetType` — so projection works from this
   * normalized view plus a {@link BindTransfer} for the form-specific half.
   */
  private transferParts(
    stmt: TypedLetTransferStatement | TypedTransferStatement,
    type: LocatedType,
  ): TransferParts {
    return {
      name: stmt.stmt.name,
      type,
      source: stmt.source,
      mode: stmt.transferMode,
      commTag: stmt.commTag,
      span: stmt.stmt.span,
    };
  }

  private projectLetTransfer(
    stmt: TypedLetTransferStatement,
  ): ProjectedStatement | ProjectedStatement[] {
    const parts = this.transferParts(stmt, stmt.choreoType);
    return this.projectTransfer(parts, (value) => ({
      kind: "LetStatement",
      name: parts.name,
      type: this.projectType(parts.type),
      initializer: value,
      span: parts.span,
    }));
  }

  private projectComm(
    stmt: TypedTransferStatement,
  ): ProjectedStatement | ProjectedStatement[] {
    const parts = this.transferParts(stmt, stmt.targetType);
    return this.projectTransfer(parts, (value) => ({
      kind: "AssignmentStatement",
      target: { kind: "IdentifierAssignmentTarget", name: parts.name },
      value,
      span: parts.span,
    }));
  }

  /**
   * Projects a transfer (spec §transfer-projection).
   *
   * The source is evaluated once at every endpoint that evaluates the
   * statement: as the payload at the sender, and for its computations alone
   * everywhere else, before that endpoint's own receive.
   */
  private projectTransfer(
    parts: TransferParts,
    bind: BindTransfer,
  ): ProjectedStatement | ProjectedStatement[] {
    const { source, span } = parts;

    if (parts.mode === "localCopy") {
      // Nothing is sent, so an endpoint that does not hold the destination is
      // left with the source's computations alone (spec §local-copy).
      if (!this.residesHere(parts.type.location)) {
        return this.discardStatement(span, source);
      }
      return bind(
        this.localCopyInitializer(
          parts.type,
          this.projectExpression(source),
          span,
        ),
      );
    }

    const dst = parts.type.location;
    const src = source.choreoType.location;
    const tag = parts.commTag;
    if (tag === undefined) {
      // Every non-`localCopy` transfer is tagged by `assignCommTags`
      // (spec §communication-tags). Reaching here means that pass was skipped or disagrees
      // with the checker about the transfer mode; emitting an untagged
      // send/receive pair would produce output that looks well formed and
      // pairs the wrong ends.
      throw new Error(
        `internal error: ${parts.mode} transfer '${parts.name}' has no communication tag`,
      );
    }
    const comm = this.commKindForType(parts.type);

    if (dst.kind === "every") {
      return this.projectBroadcastTransfer(parts, bind, src, tag, comm);
    }

    // `src` is individual for a direct transfer (an `@every` source makes it a
    // local copy), but `receiveExpr` still wants a name for the other arm.
    const srcEndpoint = src.kind === "individual" ? src.name : "";

    if (src.kind === "individual" && src.name === this.endpoint) {
      return {
        kind: "SendStatement",
        comm,
        destinationEndpoint: dst.name,
        tag,
        value: this.projectExpression(source),
        span,
      };
    }

    if (dst.name === this.endpoint) {
      return [
        this.sourceEffect(span, source),
        bind(this.receiveExpr(comm, srcEndpoint, tag, span)),
      ];
    }

    return this.discardStatement(span, source);
  }

  /** Broadcast to `@every`: the sender broadcasts, everyone else receives (spec §broadcast-communication). */
  private projectBroadcastTransfer(
    parts: TransferParts,
    bind: BindTransfer,
    src: Location,
    tag: string,
    comm: CommKind,
  ): ProjectedStatement[] {
    const { source, span } = parts;
    const srcEndpoint = src.kind === "individual" ? src.name : "";

    if (src.kind === "individual" && src.name === this.endpoint) {
      // The sender needs the value twice — as the payload and as its own copy
      // — so a temporary keeps it to one evaluation (spec §transfer-typing).
      const { setup, value } = this.evaluateOnce(
        this.projectExpression(source),
        parts.type,
        span,
      );
      return [
        ...setup,
        { kind: "BroadcastStatement", comm, tag, value, span },
        // The sender keeps its own fresh copy, like every receiver does.
        bind(this.localCopyInitializer(parts.type, value, span)),
      ];
    }

    return [
      this.sourceEffect(span, source),
      bind(this.receiveExpr(comm, srcEndpoint, tag, span)),
    ];
  }

  private localCopyInitializer(
    choreoType: LocatedType,
    projectedSource: ProjectedExpression,
    span: Span,
  ): ProjectedExpression {
    if (choreoType.isArray) {
      const comm = this.commKindForType(choreoType);
      return {
        kind: "CallExpression",
        callee: cloneFunction(comm),
        args: [projectedSource],
        span,
      };
    }
    return projectedSource;
  }

  private projectAssignment(
    stmt: TypedAssignmentStatement,
  ): ProjectedStatement {
    const span = stmt.stmt.span;
    const targetLocation = this.assignmentTargetLocation(stmt.target);
    if (!this.residesHere(targetLocation)) {
      return this.discardStatement(
        span,
        ...this.discardedTargetParts(stmt.target, stmt.value),
      );
    }
    return {
      kind: "AssignmentStatement",
      target: this.projectAssignmentTarget(stmt.target),
      value: this.projectExpression(stmt.value),
      span,
    };
  }

  private projectAssignmentTarget(
    target: import("../ast/typed.js").TypedAssignmentTarget,
  ): import("../ir/projected.js").ProjectedAssignmentTarget {
    if (target.target.kind === "IdentifierAssignmentTarget") {
      return {
        kind: "IdentifierAssignmentTarget",
        name: target.target.name,
      };
    }
    const indexTarget = target as import("../ast/typed.js").TypedIndexAssignmentTarget;
    return {
      kind: "IndexAssignmentTarget",
      name: indexTarget.target.name,
      index: this.projectExpression(indexTarget.index),
    };
  }

  /** Where the value an assignment target names lives (spec §assignment-projection). */
  private assignmentTargetLocation(
    target: import("../ast/typed.js").TypedAssignmentTarget,
  ): Location {
    if (target.target.kind === "IdentifierAssignmentTarget") {
      return (target as import("../ast/typed.js").TypedIdentifierAssignmentTarget)
        .targetType.location;
    }
    return (target as import("../ast/typed.js").TypedIndexAssignmentTarget)
      .arrayType.location;
  }

  private projectIf(stmt: TypedIfStatement): ProjectedStatement {
    const projected = {
      kind: "IfStatement" as const,
      condition: this.projectExpression(stmt.condition),
      then: this.projectBlock(stmt.then),
      else: stmt.else ? this.projectBlock(stmt.else) : undefined,
      span: stmt.stmt.span,
    };
    return projected;
  }

  private projectWhile(stmt: TypedWhileStatement): ProjectedStatement {
    this.loopDepth += 1;
    const projected = {
      kind: "WhileStatement" as const,
      condition: this.projectExpression(stmt.condition),
      body: this.projectBlock(stmt.body),
      span: stmt.stmt.span,
    };
    this.loopDepth -= 1;
    return projected;
  }

  private projectFor(stmt: TypedForStatement): ProjectedStatement {
    this.loopDepth += 1;
    const projected = {
      kind: "ForStatement" as const,
      init: stmt.init ? this.projectForInit(stmt.init) : undefined,
      condition: this.projectExpression(stmt.condition),
      update: stmt.update ? this.projectForUpdate(stmt.update) : undefined,
      body: this.projectBlock(stmt.body),
      span: stmt.stmt.span,
    };
    this.loopDepth -= 1;
    return projected;
  }

  private projectForInit(
    init: TypedForInit,
  ): import("../ir/projected.js").ProjectedForInit | undefined {
    if ("init" in init && init.init.kind === "ForLetInit") {
      return this.projectForLetInit(init as TypedForLetInit);
    }
    return this.projectForAssignmentInit(init as TypedForAssignmentInit);
  }

  private projectForLetInit(init: TypedForLetInit): import("../ir/projected.js").ProjectedForLetInit {
    return {
      kind: "ForLetInit",
      name: init.init.name,
      type: this.projectType(init.choreoType),
      initializer: this.projectExpression(init.initializer),
      span: init.init.span,
    };
  }

  /**
   * A for-header slot holds an expression, not a statement, so an assignment
   * whose target is absent here cannot become the evaluation-only *statement*
   * §assignment-projection would produce. The discarded expressions go into a `nothing(...)`
   * that stays in the slot instead; cleanup drops the slot altogether if that
   * simplifies to `null` (spec §for-projection).
   */
  private projectForAssignmentInit(
    init: TypedForAssignmentInit,
  ): import("../ir/projected.js").ProjectedForInit | undefined {
    const span = init.init.span;
    if (!this.residesHere(this.assignmentTargetLocation(init.target))) {
      return {
        kind: "ForExpressionInit",
        expression: this.discardedValue(
          span,
          ...this.discardedTargetParts(init.target, init.value),
        ),
        span,
      };
    }
    return {
      kind: "ForAssignmentInit",
      target: this.projectAssignmentTarget(init.target),
      value: this.projectExpression(init.value),
      span,
    };
  }

  private projectForUpdate(
    init: TypedForAssignmentInit,
  ): import("../ir/projected.js").ProjectedForUpdate | undefined {
    const projected = this.projectForAssignmentInit(init);
    if (projected === undefined || projected.kind === "ForLetInit") {
      return undefined;
    }
    return projected;
  }

  private projectReturn(stmt: TypedReturnStatement): ProjectedStatement {
    const span = stmt.stmt.span;
    if (stmt.value === undefined) {
      return { kind: "ReturnStatement", span };
    }
    const value = this.projectExpression(stmt.value);
    return { kind: "ReturnStatement", value, span };
  }

  private projectExpressionStatement(
    stmt: TypedExpressionStatement,
  ): ProjectedStatement {
    const span = stmt.stmt.span;
    return {
      kind: "ExpressionStatement",
      expression: this.projectExpression(stmt.expression),
      span,
    };
  }

  /**
   * Projects an expression to this endpoint (spec §expression-projection).
   *
   * Where the result value resides here, the expression is preserved as it
   * stands. Where it does not, the outer operation is not performed at all and
   * {@link projectDiscarded} keeps just the computations the subexpressions
   * still owe this endpoint, in source order.
   */
  private projectExpression(expr: TypedExpression): ProjectedExpression {
    if (!this.residesHere(expr.choreoType.location)) {
      return this.projectDiscarded(expr);
    }

    switch (expr.expr.kind) {
      case "LiteralExpression":
        return this.projectLiteral(expr as TypedLiteralExpression);
      case "ArrayLiteralExpression": {
        const arrayExpr = expr as TypedArrayLiteralExpression;
        return {
          kind: "CallExpression",
          callee: ARRAY_SENTINEL,
          args: arrayExpr.elements.map((e) => this.projectExpression(e)),
          span: expr.expr.span,
        };
      }
      case "IdentifierExpression":
        return {
          kind: "IdentifierExpression",
          name: expr.expr.name,
          span: expr.expr.span,
        };
      case "BinaryExpression": {
        const bin = expr as TypedBinaryExpression;
        return {
          kind: "BinaryExpression",
          operator: bin.expr.operator,
          left: this.projectExpression(bin.left),
          right: this.projectExpression(bin.right),
          span: expr.expr.span,
        };
      }
      case "UnaryExpression": {
        const un = expr as TypedUnaryExpression;
        return {
          kind: "UnaryExpression",
          operator: un.expr.operator,
          operand: this.projectExpression(un.operand),
          span: expr.expr.span,
        };
      }
      case "ConversionExpression": {
        const conv = expr as TypedConversionExpression;
        return {
          kind: "ConversionExpression",
          target: conv.expr.target,
          operand: this.projectExpression(conv.operand),
          span: expr.expr.span,
        };
      }
      case "CallExpression":
        return this.projectCall(expr as TypedCallExpression);
      case "IndexExpression": {
        const indexExpr = expr as TypedIndexExpression;
        return {
          kind: "IndexExpression",
          target: this.projectExpression(indexExpr.target),
          index: this.projectExpression(indexExpr.index),
          span: expr.expr.span,
        };
      }
      case "LengthExpression": {
        const lengthExpr = expr as TypedLengthExpression;
        return {
          kind: "PropertyLengthExpression",
          target: this.projectExpression(lengthExpr.target),
          span: expr.expr.span,
        };
      }
      case "PushExpression": {
        // `xs.push(v)` is emitted unchanged (spec §array-operation-code-generation). The `void` result
        // carries the array's location, so this arm is reached exactly at the
        // endpoints that hold the array.
        const push = expr as TypedPushExpression;
        return {
          kind: "CallExpression",
          callee: PUSH_SENTINEL,
          args: [
            this.projectExpression(push.target),
            this.projectExpression(push.value),
          ],
          span: expr.expr.span,
        };
      }
      case "ParenthesizedExpression": {
        const paren = expr as TypedParenthesizedExpression;
        const inner = this.projectExpression(paren.expression);
        return {
          kind: "ParenthesizedExpression",
          expression: inner,
          span: expr.expr.span,
        };
      }
    }
  }

  /**
   * Projects an expression whose result value is not wanted here (spec §expression-projection).
   *
   * The outer operator or callee is not reproduced: either this endpoint has
   * no value to apply it to, or — for a discarded transfer source — nobody
   * here wants the result. What is reproduced is the *evaluation* of the
   * operands, structurally and in source order, inside a `nothing(...)` that
   * discards their values and yields `null` (spec §nothing). A choreography
   * function runs at every endpoint (spec §function-projection), so a call nested anywhere
   * in here survives even though its result does not.
   *
   * The recursion stays on this side throughout: a subexpression whose value
   * happens to reside here is still only evaluated, never handed back as a
   * value. A call's *arguments* are the exception — the call does want those
   * values, so {@link projectCall} projects them normally.
   *
   * Nested `nothing(...)` artifacts are left nested; flattening them is not
   * part of Core v0 (spec §projected-ast-cleanup).
   */
  private projectDiscarded(expr: TypedExpression): ProjectedExpression {
    const span = expr.expr.span;
    switch (expr.expr.kind) {
      case "LiteralExpression":
      case "IdentifierExpression":
        return this.absentExpr(span);
      case "BinaryExpression": {
        const bin = expr as TypedBinaryExpression;
        // `&&` and `||` included: they do not short-circuit (spec §evaluation-order),
        // so hoisting both operands runs exactly what the source runs (§logical-operator-projection).
        return this.nothingExpression(
          [this.projectDiscarded(bin.left), this.projectDiscarded(bin.right)],
          span,
        );
      }
      case "UnaryExpression": {
        const un = expr as TypedUnaryExpression;
        return this.nothingExpression([this.projectDiscarded(un.operand)], span);
      }
      // Like parentheses, a conversion contributes nothing of its own where its
      // value is not wanted: only the operand's evaluation is kept
      // (spec §numeric-conversion-projection).
      case "ConversionExpression":
        return this.projectDiscarded((expr as TypedConversionExpression).operand);
      case "ParenthesizedExpression": {
        const paren = expr as TypedParenthesizedExpression;
        return this.projectDiscarded(paren.expression);
      }
      case "CallExpression":
        return this.projectCall(expr as TypedCallExpression);
      case "IndexExpression": {
        const index = expr as TypedIndexExpression;
        return this.nothingExpression(
          [
            this.projectDiscarded(index.target),
            this.projectDiscarded(index.index),
          ],
          span,
        );
      }
      case "LengthExpression": {
        // The receiver is a variable (spec §expressions), so reading it cannot call
        // anything and the length itself is not taken here: nothing is left to
        // evaluate. Cleanup removes the `nothing()` (spec §projected-ast-cleanup).
        return this.nothingExpression([], span);
      }
      case "PushExpression": {
        // The append belongs to the array, so it does not happen here; the
        // argument is still evaluated (spec §evaluation-order). The receiver is a variable
        // (spec §expressions), so evaluating it has no effect to preserve — the same
        // reason `discardedTargetParts` drops it for `xs[i] = v`.
        const push = expr as TypedPushExpression;
        return this.nothingExpression([this.projectDiscarded(push.value)], span);
      }
      case "ArrayLiteralExpression": {
        const array = expr as TypedArrayLiteralExpression;
        return this.nothingExpression(
          array.elements.map((e) => this.projectDiscarded(e)),
          span,
        );
      }
    }
  }

  private projectLiteral(expr: TypedLiteralExpression): ProjectedExpression {
    const raw = expr.literal.literal;
    const span = expr.literal.span;
    switch (raw.kind) {
      case "IntegerLiteral":
        return { kind: "IntegerLiteralExpression", value: raw.value, span };
      case "FloatLiteral":
        return { kind: "FloatLiteralExpression", value: raw.value, span };
      case "StringLiteral":
        return { kind: "StringLiteralExpression", value: raw.value, span };
      case "BooleanLiteral":
        return { kind: "BooleanLiteralExpression", value: raw.value, span };
      case "NullLiteral":
        return { kind: "NullLiteralExpression", span };
    }
  }

  /**
   * A call projects to a call wherever this endpoint runs the callee — that is
   * at every endpoint for a choreography function, and only at its own for a
   * local one (spec §function-projection).
   *
   * Where the callee is not generated here, the call itself disappears but its
   * arguments do not: they are ordinary expressions that may hold choreography
   * calls of their own, so their projections are kept in order (spec §expression-projection).
   * A local function with no arguments therefore leaves `nothing()`, which
   * cleanup removes (spec §projected-ast-cleanup).
   */
  private projectCall(expr: TypedCallExpression): ProjectedExpression {
    const span = expr.expr.span;
    const args = expr.args.map((a) => this.projectExpression(a));
    if (!this.shouldEmitFunction(expr.callee.decl)) {
      return this.nothingExpression(args, span);
    }
    return {
      kind: "CallExpression",
      callee: expr.expr.callee,
      args,
      span,
    };
  }

  private projectType(type: LocatedType): ProjectedType {
    // `void` holds no value, so there is nothing that could be absent here.
    if (type.base === "void" && type.isArray !== true) {
      return { kind: "PresentType", base: "void" };
    }
    if (!this.residesHere(type.location)) {
      return { kind: "AbsentType" };
    }
    return { kind: "PresentType", base: this.projectedBase(type) };
  }

  /**
   * BlueScript type name for a resident located type (spec §type-mapping).
   *
   * Exhaustive on purpose: the array arm used to fall back to `boolean[]` for
   * anything that was not `integer` or `float`, which quietly rendered an
   * unsupported element type as a supported one. The checker rejects those
   * (spec §array-types, §unsupported-array-element-type), so reaching the throw is an internal bug.
   */
  private projectedBase(
    type: LocatedType,
  ): import("../ir/projected.js").ProjectedBaseType {
    if (type.isArray === true) {
      switch (type.base) {
        case "integer":
          return "integer[]";
        case "float":
          return "float[]";
        case "boolean":
          return "boolean[]";
        default:
          throw new Error(
            `internal error: '${type.base}[]' is not a supported array type ${specRef("array-types")}`,
          );
      }
    }
    return type.base;
  }

  /**
   * A compiler-generated `nothing(e1, ..., en)` artifact (spec §nothing).
   *
   * It evaluates each part once, left to right, discards their values and
   * yields `null`. Cleanup folds it away when every part turns out to be a
   * plain `null`, including the zero-argument `nothing()` (spec §projected-ast-cleanup).
   */
  private nothingExpression(
    parts: readonly ProjectedExpression[],
    span: Span,
  ): import("../ir/projected.js").NothingExpression {
    return { kind: "NothingExpression", parts, span };
  }

  /**
   * Projects a statement whose store, binding or callee does not exist here.
   *
   * The store is dropped, but the expressions the original semantics evaluates
   * are kept as an evaluation-only expression statement, in source order
   * (spec §expression-projection). Cleanup deletes the statement if it simplifies to `null`,
   * which is what happens when none of the expressions owed this endpoint any
   * computation (spec §projected-ast-cleanup).
   */
  private discardStatement(
    span: Span,
    ...exprs: readonly TypedExpression[]
  ): ProjectedStatement {
    return {
      kind: "ExpressionStatement",
      expression: this.discardedValue(span, ...exprs),
      span,
    };
  }

  /**
   * The statements an endpoint runs for a transfer's source expression before
   * its own receive or copy (spec §transfer-projection).
   *
   * A transfer evaluates its source once at every endpoint that evaluates it,
   * not only at the sender: the source may call a choreography function, and
   * that function runs everywhere (spec §function-projection). The sender evaluates it as the
   * payload; everyone else evaluates it for its computations alone, and must do
   * so before the receive so that the calls inside it line up with the sender's.
   * When it owes this endpoint nothing, cleanup removes the statement again.
   */
  private sourceEffect(span: Span, source: TypedExpression): ProjectedStatement {
    return this.discardStatement(span, source);
  }

  /**
   * One expression that evaluates `exprs` in order and yields `null`.
   *
   * A single expression needs no wrapper: its own projection already discards
   * whatever value is left (spec §expression-projection). Two or more need `nothing(...)` to
   * hold them in one slot.
   */
  private discardedValue(
    span: Span,
    ...exprs: readonly TypedExpression[]
  ): ProjectedExpression {
    const parts = exprs.map((expr) => this.projectDiscarded(expr));
    return parts.length === 1 ? parts[0]! : this.nothingExpression(parts, span);
  }

  /**
   * The expressions an assignment still evaluates when its target is absent
   * here, in the order the source evaluates them (spec §evaluation-order).
   *
   * For `xs[i] = v` that is the index and then the value; the receiver `xs` is
   * an identifier in Core v0, so evaluating it has no effect to preserve.
   */
  private discardedTargetParts(
    target: import("../ast/typed.js").TypedAssignmentTarget,
    value: TypedExpression,
  ): TypedExpression[] {
    if (target.target.kind === "IndexAssignmentTarget") {
      const indexTarget =
        target as import("../ast/typed.js").TypedIndexAssignmentTarget;
      return [indexTarget.index, value];
    }
    return [value];
  }

  /**
   * Makes a projected expression safe to use more than once.
   *
   * A broadcast needs the source value twice at the sender: once as the payload
   * and once for the sender's own binding. The source is an arbitrary
   * expression and may call a function, so projecting it into both positions
   * would evaluate it twice and could send one value while keeping another.
   * The transfer's source is evaluated exactly once (spec §transfer-typing), so anything
   * that is not already a stable reference is bound to a temporary first.
   */
  private evaluateOnce(
    source: ProjectedExpression,
    type: LocatedType,
    span: Span,
  ): { setup: ProjectedStatement[]; value: ProjectedExpression } {
    if (this.isStableExpression(source)) {
      return { setup: [], value: source };
    }
    const name = `${TRANSFER_TEMP_PREFIX}${this.transferTemps}`;
    this.transferTemps += 1;
    return {
      setup: [
        {
          kind: "LetStatement",
          name,
          type: this.projectType(type),
          initializer: source,
          span,
        },
      ],
      value: { kind: "IdentifierExpression", name, span },
    };
  }

  /** Re-reading this expression cannot call anything or observe a change. */
  private isStableExpression(expr: ProjectedExpression): boolean {
    switch (expr.kind) {
      case "IdentifierExpression":
      case "IntegerLiteralExpression":
      case "FloatLiteralExpression":
      case "StringLiteralExpression":
      case "BooleanLiteralExpression":
      case "NullLiteralExpression":
      case "AbsentExpression":
        return true;
      default:
        return false;
    }
  }

  private receiveExpr(
    comm: CommKind,
    sourceEndpoint: string,
    tag: string,
    span: Span,
  ): ReceiveExpression {
    return {
      kind: "ReceiveExpression",
      comm,
      sourceEndpoint,
      tag,
      span,
    };
  }

  /**
   * Scalar payload kind for a transferred base type (spec §communication-api).
   *
   * Exhaustive on purpose. An earlier version defaulted every unrecognised base
   * type to `"integer"`, which silently emitted `sendInteger` for values that
   * were not integers at all. Anything not transferable must be rejected by the
   * checker (spec §transfer-typing), so reaching the throws below is an internal bug.
   */
  private commKind(base: LocatedType["base"]): CommKind {
    switch (base) {
      case "integer":
      case "float":
      case "boolean":
      case "string":
      case "null":
        return base;
      case "void":
        throw new Error(
          `internal error: \`void\` has no value to transfer ${specRef("void", "invalid-use-of-void")}`,
        );
      default: {
        const unexpected: never = base;
        throw new Error(
          `internal error: unhandled transfer base type '${String(unexpected)}'`,
        );
      }
    }
  }

  private commKindForType(type: LocatedType): CommKind {
    if (type.isArray === true) {
      switch (type.base) {
        case "integer":
          return "integerArray";
        case "float":
          return "floatArray";
        case "boolean":
          return "booleanArray";
        default:
          throw new Error(
            `internal error: '${type.base}[]' is not a supported array type ${specRef("array-types")}`,
          );
      }
    }
    return this.commKind(type.base);
  }

  /** Does this endpoint hold a copy of a value at `location`? (spec §location-matching-and-residency, §type-projection) */
  private residesHere(location: Location): boolean {
    return residesAt(location, this.endpoint);
  }

  private absentExpr(span: Span): AbsentExpression {
    return { kind: "AbsentExpression", span };
  }

  private flatten(
    stmt: ProjectedStatement | ProjectedStatement[],
  ): ProjectedStatement[] {
    return Array.isArray(stmt) ? stmt : [stmt];
  }
}

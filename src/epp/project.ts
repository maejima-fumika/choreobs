import type { Span } from "../ast/span.js";
import type { Location } from "../ast/location.js";
import type {
  LocatedType,
  TypedIdentifierAssignmentTarget,
  TypedIndexAssignmentTarget,
} from "../ast/typed.js";
import type { FunctionDeclaration } from "../ast/declarations.js";
import type {
  TypedProgram,
  TypedFunctionDeclaration,
  TypedTopLevelStatement,
  TypedStatement,
  TypedBlock,
  TypedExpression,
  TypedLetStatement,
  TypedLetReceiveStatement,
  TypedAssignmentStatement,
  TypedCommStatement,
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
  TypedCallExpression,
  TypedIndexExpression,
  TypedParenthesizedExpression,
} from "../ast/typed.js";
import { available, isDynamic } from "../types/located.js";
import {
  PACK_DYNAMIC,
  REQUIRE_CONDITION,
  DYN_MOVE,
  DYN_ARRAY_GET,
  DYN_ARRAY_SET,
  DYN_ARRAY_PUSH,
  DYN_ARRAY_LENGTH,
  EVERY_CONSTANT,
  dynBinaryCallee,
  dynUnaryCallee,
  requireScalarCallee,
  requireArrayCallee,
} from "../lowering/runtime.js";
import type {
  ProjectedProgram,
  ProjectedFunction,
  ProjectedStatement,
  ProjectedBlock,
  ProjectedExpression,
  ProjectedType,
  ProjectedParameter,
  ProjectedAssignmentTarget,
  ProjectedForInit,
  ProjectedForLetInit,
  ProjectedForAssignmentInit,
  ProjectedBaseType,
  CommKind,
  AbsentExpression,
  AbsentStatement,
  ExpressionStatement,
  NothingExpression,
  ReceiveExpression,
  RuntimeCallExpression,
  DynValueExpression,
  MethodCallExpression,
  PropertyAccessExpression,
  NullLiteralExpression,
  StringLiteralExpression,
  IdentifierExpression,
} from "../ir/projected.js";
import { cloneFunction } from "../emit/comm.js";

export function projectAll(
  typed: TypedProgram,
  participants: readonly string[],
): readonly ProjectedProgram[] {
  return participants.map((participant) => project(typed, participant));
}

export function project(
  typed: TypedProgram,
  participant: string,
): ProjectedProgram {
  return new Projector(participant).projectProgram(typed);
}

class Projector {
  private readonly useLocation: Location;
  private loopDepth = 0;
  private ifDepth = 0;
  private currentReturnType: LocatedType | undefined;

  constructor(private readonly participant: string) {
    this.useLocation = { kind: "concrete", name: participant };
  }

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
      participant: this.participant,
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

    const previousReturnType = this.currentReturnType;
    this.currentReturnType = item.returnType;
    const fnBody = this.projectBlock(item.body);
    this.currentReturnType = previousReturnType;

    return {
      kind: "ProjectedFunction",
      name: decl.name,
      params,
      returnType: this.projectType(item.returnType),
      body: fnBody,
      span: decl.span,
    };
  }

  private shouldEmitFunction(decl: FunctionDeclaration): boolean {
    if (decl.at.kind !== "concrete") {
      return true;
    }
    return decl.at.name === this.participant;
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
      case "LetReceiveStatement":
        return this.projectLetReceive(stmt as TypedLetReceiveStatement);
      case "AssignmentStatement":
        return this.projectAssignment(stmt as TypedAssignmentStatement);
      case "CommStatement":
        return this.projectComm(stmt as TypedCommStatement);
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

  private projectLet(stmt: TypedLetStatement): ProjectedStatement {
    const span = stmt.stmt.span;
    if (!this.isAvailable(stmt.choreoType.location)) {
      // The target is a static location unavailable here. Preserve initializers
      // that contain dynamic runtime helper calls (spec §18.10, §18.18).
      const projected = this.projectExpression(stmt.initializer);
      if (this.containsGradualHelper(projected)) {
        return this.nothingForExpression(stmt.initializer, span);
      }
      if (this.loopDepth > 0) {
        return this.absentStatement(span);
      }
      if (this.ifDepth > 0) {
        return this.nothingForExpression(stmt.initializer, span);
      }
      if (stmt.initializer.expr.kind === "CallExpression") {
        return this.nothingForExpression(stmt.initializer, span);
      }
      return this.absentStatement(span);
    }
    return {
      kind: "LetStatement",
      name: stmt.stmt.name,
      type: this.projectType(stmt.choreoType),
      initializer: this.projectExpression(stmt.initializer),
      span,
    };
  }

  private projectLetReceive(
    stmt: TypedLetReceiveStatement,
  ): ProjectedStatement | ProjectedStatement[] {
    if (this.isGradualComm(stmt.choreoType, stmt.source.choreoType)) {
      return this.projectDynamicComm(
        true,
        stmt.stmt.name,
        stmt.choreoType,
        stmt.source,
        stmt.commTag!,
        stmt.stmt.span,
      );
    }

    if (stmt.commMode === "localization") {
      return this.projectLocalizationLetReceive(stmt);
    }

    const span = stmt.stmt.span;
    const dst = stmt.choreoType.location;
    const src = stmt.source.choreoType.location;
    const tag = stmt.commTag!;
    const name = stmt.stmt.name;
    const comm = this.commKindForType(stmt.choreoType);

    if (dst.kind === "every") {
      return this.projectBroadcastReceive(
        name,
        stmt.choreoType,
        src,
        tag,
        comm,
        stmt.source,
        span,
      );
    }

    const dstParticipant = dst.kind === "concrete" ? dst.name : "";
    const srcParticipant = src.kind === "concrete" ? src.name : "";

    if (this.participant === srcParticipant) {
      return {
        kind: "SendStatement",
        comm,
        destinationParticipant: dstParticipant,
        tag,
        value: this.projectExpression(stmt.source),
        span,
      };
    }

    if (this.participant === dstParticipant) {
      return {
        kind: "LetStatement",
        name,
        type: this.projectType(stmt.choreoType),
        initializer: this.receiveExpr(comm, srcParticipant, tag, span),
        span,
      };
    }

    return this.absentStatement(span);
  }

  private projectBroadcastReceive(
    name: string,
    choreoType: LocatedType,
    src: Location,
    tag: string,
    comm: CommKind,
    source: TypedExpression,
    span: Span,
  ): ProjectedStatement | ProjectedStatement[] {
    const srcParticipant = src.kind === "concrete" ? src.name : "";
    const projectedSource = this.projectExpression(source);

    if (this.participant === srcParticipant) {
      const senderInitializer =
        choreoType.isArray
          ? ({
              kind: "CallExpression",
              callee: cloneFunction(comm),
              args: [projectedSource],
              span,
            } as ProjectedExpression)
          : projectedSource;
      return [
        {
          kind: "BroadcastStatement",
          comm,
          tag,
          value: projectedSource,
          span,
        },
        {
          kind: "LetStatement",
          name,
          type: this.projectType(choreoType),
          initializer: senderInitializer,
          span,
        },
      ];
    }

    return {
      kind: "LetStatement",
      name,
      type: this.projectType(choreoType),
      initializer: this.receiveExpr(comm, srcParticipant, tag, span),
      span,
    };
  }

  private projectComm(
    stmt: TypedCommStatement,
  ): ProjectedStatement | ProjectedStatement[] {
    if (this.isGradualComm(stmt.targetType, stmt.source.choreoType)) {
      return this.projectDynamicComm(
        false,
        stmt.stmt.name,
        stmt.targetType,
        stmt.source,
        stmt.commTag!,
        stmt.stmt.span,
      );
    }

    if (stmt.commMode === "localization") {
      return this.projectLocalizationComm(stmt);
    }

    const span = stmt.stmt.span;
    const dst = stmt.targetType.location;
    const src = stmt.source.choreoType.location;
    const tag = stmt.commTag!;
    const name = stmt.stmt.name;
    const comm = this.commKindForType(stmt.targetType);

    if (dst.kind === "every") {
      return this.projectBroadcastComm(
        name,
        src,
        tag,
        comm,
        stmt.source,
        span,
      );
    }

    const dstParticipant = dst.kind === "concrete" ? dst.name : "";
    const srcParticipant = src.kind === "concrete" ? src.name : "";

    if (this.participant === srcParticipant) {
      return {
        kind: "SendStatement",
        comm,
        destinationParticipant: dstParticipant,
        tag,
        value: this.projectExpression(stmt.source),
        span,
      };
    }

    if (this.participant === dstParticipant) {
      return {
        kind: "AssignmentStatement",
        target: { kind: "IdentifierAssignmentTarget", name },
        value: this.receiveExpr(comm, srcParticipant, tag, span),
        span,
      };
    }

    return this.absentStatement(span);
  }

  /**
   * Dynamic communication via `dynMove` (spec §18.13). Used for both
   * communication lets (`isLet`) and communication to existing variables.
   */
  private projectDynamicComm(
    isLet: boolean,
    name: string,
    targetType: LocatedType,
    source: TypedExpression,
    tag: string,
    span: Span,
  ): ProjectedStatement {
    const from = isDynamic(source.choreoType)
      ? this.projectExpression(source)
      : this.packValue(source);

    const dynamicDest = isDynamic(targetType);
    let toLocation: ProjectedExpression;
    if (dynamicDest) {
      toLocation = isLet
        ? this.everyRef(span)
        : this.propertyAccess(this.identifier(name, span), "location", span);
    } else {
      toLocation = this.locationRef(targetType.location, span);
    }

    let result: ProjectedExpression = this.runtimeCall(
      DYN_MOVE,
      [from, this.stringLiteral(tag, span), toLocation],
      span,
    );

    if (!dynamicDest) {
      const callee = targetType.isArray
        ? requireArrayCallee(targetType.base)
        : requireScalarCallee(targetType.base);
      result = this.runtimeCall(
        callee,
        [result, this.locationRef(targetType.location, span)],
        span,
      );
    }

    const available = dynamicDest || this.isAvailable(targetType.location);
    if (!available) {
      return { kind: "ExpressionStatement", expression: result, span };
    }
    if (isLet) {
      return {
        kind: "LetStatement",
        name,
        type: this.projectType(targetType),
        initializer: result,
        span,
      };
    }
    return {
      kind: "AssignmentStatement",
      target: { kind: "IdentifierAssignmentTarget", name },
      value: result,
      span,
    };
  }

  private projectLocalizationLetReceive(
    stmt: TypedLetReceiveStatement,
  ): ProjectedStatement {
    const span = stmt.stmt.span;
    const dst = stmt.choreoType.location;
    if (dst.kind !== "concrete" || this.participant !== dst.name) {
      return this.absentStatement(span);
    }
    const projectedSource = this.projectExpression(stmt.source);
    const initializer = this.localizationInitializer(
      stmt.choreoType,
      projectedSource,
      span,
    );
    return {
      kind: "LetStatement",
      name: stmt.stmt.name,
      type: this.projectType(stmt.choreoType),
      initializer,
      span,
    };
  }

  private projectLocalizationComm(
    stmt: TypedCommStatement,
  ): ProjectedStatement {
    const span = stmt.stmt.span;
    const dst = stmt.targetType.location;
    if (dst.kind !== "concrete" || this.participant !== dst.name) {
      return this.absentStatement(span);
    }
    const projectedSource = this.projectExpression(stmt.source);
    const value = this.localizationInitializer(
      stmt.targetType,
      projectedSource,
      span,
    );
    return {
      kind: "AssignmentStatement",
      target: { kind: "IdentifierAssignmentTarget", name: stmt.stmt.name },
      value,
      span,
    };
  }

  private localizationInitializer(
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

  /** Broadcast to `@every`: sender broadcasts; all participants assign from receive or local copy (§11.3). */
  private projectBroadcastComm(
    name: string,
    src: Location,
    tag: string,
    comm: CommKind,
    source: TypedExpression,
    span: Span,
  ): ProjectedStatement | ProjectedStatement[] {
    const srcParticipant = src.kind === "concrete" ? src.name : "";
    const projectedSource = this.projectExpression(source);

    if (src.kind === "concrete" && src.name === this.participant) {
      return [
        {
          kind: "BroadcastStatement",
          comm,
          tag,
          value: projectedSource,
          span,
        },
        {
          kind: "AssignmentStatement",
          target: { kind: "IdentifierAssignmentTarget", name },
          value: projectedSource,
          span,
        },
      ];
    }

    return {
      kind: "AssignmentStatement",
      target: { kind: "IdentifierAssignmentTarget", name },
      value: this.receiveExpr(comm, srcParticipant, tag, span),
      span,
    };
  }

  private projectAssignment(
    stmt: TypedAssignmentStatement,
  ): ProjectedStatement {
    const span = stmt.stmt.span;
    if (stmt.target.target.kind === "IndexAssignmentTarget") {
      const indexTarget = stmt.target as TypedIndexAssignmentTarget;
      if (
        isDynamic(indexTarget.arrayType) ||
        isDynamic(indexTarget.index.choreoType) ||
        isDynamic(stmt.value.choreoType)
      ) {
        // Dynamic array set (spec §18.14.2): emitted at every endpoint; the
        // runtime helper performs the location check and per-owner mutation.
        const arrOperand = isDynamic(indexTarget.arrayType)
          ? this.identifier(indexTarget.target.name, span)
          : this.packIdentifier(
              indexTarget.target.name,
              indexTarget.arrayType,
              span,
            );
        return {
          kind: "ExpressionStatement",
          expression: this.runtimeCall(
            DYN_ARRAY_SET,
            [
              arrOperand,
              this.dynOperand(indexTarget.index),
              this.dynOperand(stmt.value),
            ],
            span,
          ),
          span,
        };
      }
    }

    let targetLocation: Location;
    if (stmt.target.target.kind === "IdentifierAssignmentTarget") {
      targetLocation = (stmt.target as TypedIdentifierAssignmentTarget).targetType
        .location;
    } else {
      targetLocation = (stmt.target as TypedIndexAssignmentTarget).arrayType
        .location;
    }
    if (!this.isAvailable(targetLocation)) {
      return this.nothingForExpression(stmt.value, span);
    }
    return {
      kind: "AssignmentStatement",
      target: this.projectAssignmentTarget(stmt),
      value: this.projectExpression(stmt.value),
      span,
    };
  }

  private projectAssignmentTarget(
    stmt: TypedAssignmentStatement,
  ): ProjectedAssignmentTarget {
    if (stmt.target.target.kind === "IdentifierAssignmentTarget") {
      return {
        kind: "IdentifierAssignmentTarget",
        name: stmt.target.target.name,
      };
    }
    const indexTarget = stmt.target as TypedIndexAssignmentTarget;
    return {
      kind: "IndexAssignmentTarget",
      name: indexTarget.target.name,
      index: this.projectExpression(indexTarget.index),
    };
  }

  private projectIf(stmt: TypedIfStatement): ProjectedStatement {
    this.ifDepth += 1;
    const projected = {
      kind: "IfStatement" as const,
      condition: this.projectExpression(stmt.condition),
      then: this.projectBlock(stmt.then),
      else: stmt.else ? this.projectBlock(stmt.else) : undefined,
      span: stmt.stmt.span,
    };
    this.ifDepth -= 1;
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
      condition: stmt.condition
        ? this.projectExpression(stmt.condition)
        : undefined,
      update: stmt.update ? this.projectForUpdate(stmt.update) : undefined,
      body: this.projectBlock(stmt.body),
      span: stmt.stmt.span,
    };
    this.loopDepth -= 1;
    return projected;
  }

  private projectForInit(init: TypedForInit): ProjectedForInit {
    if ("init" in init && init.init.kind === "ForLetInit") {
      return this.projectForLetInit(init as TypedForLetInit);
    }
    return this.projectForAssignmentInit(init as TypedForAssignmentInit);
  }

  private projectForLetInit(init: TypedForLetInit): ProjectedForLetInit {
    return {
      kind: "ForLetInit",
      name: init.init.name,
      type: this.projectType(init.choreoType),
      initializer: this.projectExpression(init.initializer),
      span: init.init.span,
    };
  }

  private projectForAssignmentInit(
    init: TypedForAssignmentInit,
  ): ProjectedForAssignmentInit {
    return {
      kind: "ForAssignmentInit",
      name: init.init.name,
      value: this.projectExpression(init.value),
      span: init.init.span,
    };
  }

  private projectForUpdate(
    init: TypedForAssignmentInit,
  ): ProjectedForAssignmentInit {
    return this.projectForAssignmentInit(init);
  }

  private projectReturn(stmt: TypedReturnStatement): ProjectedStatement {
    const span = stmt.stmt.span;
    if (stmt.value === undefined) {
      return { kind: "ReturnStatement", span };
    }
    const rt = this.currentReturnType;
    if (
      rt !== undefined &&
      !isDynamic(rt) &&
      !this.isAvailable(rt.location) &&
      stmt.value.gradual !== undefined
    ) {
      // Non-owner endpoint of a static return whose value needed a dynamic
      // coercion: return null rather than running the require (spec §18.10.5).
      return { kind: "ReturnStatement", value: this.absentExpr(span), span };
    }
    const value = this.projectExpression(stmt.value);
    return { kind: "ReturnStatement", value, span };
  }

  private projectExpressionStatement(
    stmt: TypedExpressionStatement,
  ): ProjectedStatement {
    const span = stmt.stmt.span;
    const expr = stmt.expression;

    if (!this.isAvailable(expr.choreoType.location)) {
      return this.nothingForExpression(expr, span);
    }

    const projected = this.projectExpression(expr);
    if (this.isAbsentExpr(projected)) {
      return this.nothingForExpression(expr, span);
    }
    return {
      kind: "ExpressionStatement",
      expression: projected,
      span,
    };
  }

  private projectExpression(expr: TypedExpression): ProjectedExpression {
    return this.applyCoercion(expr, this.lowerValue(expr));
  }

  /** Apply a use-site gradual coercion recorded by the checker (spec §18). */
  private applyCoercion(
    expr: TypedExpression,
    lowered: ProjectedExpression,
  ): ProjectedExpression {
    const g = expr.gradual;
    if (g === undefined) {
      return lowered;
    }
    const span = expr.expr.span;
    switch (g.kind) {
      case "pack":
        return this.packValue(expr);
      case "copyWrapper":
        return this.methodCall(lowered, "copyWrapper", [], span);
      case "requireScalar":
        return this.runtimeCall(
          requireScalarCallee(expr.choreoType.base),
          [lowered, this.locationRef(g.at, span)],
          span,
        );
      case "requireArray":
        return this.runtimeCall(
          requireArrayCallee(expr.choreoType.base),
          [lowered, this.locationRef(g.at, span)],
          span,
        );
      case "requireCondition":
        return this.runtimeCall(REQUIRE_CONDITION, [lowered], span);
    }
  }

  /** Project the value of an expression without its use-site coercion. */
  private lowerValue(expr: TypedExpression): ProjectedExpression {
    const span = expr.expr.span;

    if (expr.expr.kind === "LiteralExpression" && isDynamic(expr.choreoType)) {
      // Unlocated / @dynamic literal -> new DynValue(value, EVERY) (spec §18.3).
      return this.dynValue(
        this.projectLiteral(expr as TypedLiteralExpression),
        this.everyRef(span),
        span,
      );
    }
    if (
      expr.expr.kind === "ArrayLiteralExpression" &&
      isDynamic(expr.choreoType)
    ) {
      const arr = expr as TypedArrayLiteralExpression;
      const payload: ProjectedExpression = {
        kind: "CallExpression",
        callee: "__array",
        args: arr.elements.map((e) => this.rawPayload(e)),
        span,
      };
      return this.dynValue(payload, this.everyRef(span), span);
    }

    if (!this.isAvailable(expr.choreoType.location)) {
      return this.absentExpr(span);
    }

    switch (expr.expr.kind) {
      case "LiteralExpression":
        return this.projectLiteral(expr as TypedLiteralExpression);
      case "ArrayLiteralExpression": {
        const arrayExpr = expr as TypedArrayLiteralExpression;
        return {
          kind: "CallExpression",
          callee: "__array",
          args: arrayExpr.elements.map((e) => this.projectExpression(e)),
          span,
        };
      }
      case "IdentifierExpression":
        return this.identifier(expr.expr.name, span);
      case "BinaryExpression":
        return this.lowerBinary(expr as TypedBinaryExpression);
      case "UnaryExpression":
        return this.lowerUnary(expr as TypedUnaryExpression);
      case "CallExpression":
        return this.lowerCall(expr as TypedCallExpression);
      case "IndexExpression":
        return this.lowerIndex(expr as TypedIndexExpression);
      case "ParenthesizedExpression": {
        const paren = expr as TypedParenthesizedExpression;
        return {
          kind: "ParenthesizedExpression",
          expression: this.projectExpression(paren.expression),
          span,
        };
      }
    }
  }

  private lowerBinary(expr: TypedBinaryExpression): ProjectedExpression {
    const span = expr.expr.span;
    if (isDynamic(expr.choreoType)) {
      return this.runtimeCall(
        dynBinaryCallee(expr.expr.operator),
        [this.dynOperand(expr.left), this.dynOperand(expr.right)],
        span,
      );
    }
    return {
      kind: "BinaryExpression",
      operator: expr.expr.operator,
      left: this.projectExpression(expr.left),
      right: this.projectExpression(expr.right),
      span,
    };
  }

  private lowerUnary(expr: TypedUnaryExpression): ProjectedExpression {
    const span = expr.expr.span;
    if (isDynamic(expr.choreoType)) {
      return this.runtimeCall(
        dynUnaryCallee(expr.expr.operator),
        [this.dynOperand(expr.operand)],
        span,
      );
    }
    return {
      kind: "UnaryExpression",
      operator: expr.expr.operator,
      operand: this.projectExpression(expr.operand),
      span,
    };
  }

  private lowerCall(expr: TypedCallExpression): ProjectedExpression {
    const span = expr.expr.span;
    if (expr.expr.callee === "length" && expr.args.length === 1) {
      const arg = expr.args[0]!;
      if (isDynamic(arg.choreoType)) {
        return this.runtimeCall(DYN_ARRAY_LENGTH, [this.dynOperand(arg)], span);
      }
      return {
        kind: "PropertyLengthExpression",
        target: this.projectExpression(arg),
        span,
      };
    }
    if (expr.expr.callee === "push" && expr.args.length === 2) {
      const xs = expr.args[0]!;
      const v = expr.args[1]!;
      if (isDynamic(xs.choreoType) || isDynamic(v.choreoType)) {
        return this.runtimeCall(
          DYN_ARRAY_PUSH,
          [this.dynOperand(xs), this.dynOperand(v)],
          span,
        );
      }
      return {
        kind: "CallExpression",
        callee: "__push",
        args: [this.projectExpression(xs), this.projectExpression(v)],
        span,
      };
    }
    const decl = expr.callee.decl;
    if (!this.shouldEmitFunction(decl)) {
      return this.absentExpr(span);
    }
    return {
      kind: "CallExpression",
      callee: expr.expr.callee,
      args: expr.args.map((a) => this.projectExpression(a)),
      span,
    };
  }

  private lowerIndex(expr: TypedIndexExpression): ProjectedExpression {
    const span = expr.expr.span;
    if (isDynamic(expr.choreoType)) {
      return this.runtimeCall(
        DYN_ARRAY_GET,
        [this.dynOperand(expr.target), this.dynOperand(expr.index)],
        span,
      );
    }
    return {
      kind: "IndexExpression",
      target: this.projectExpression(expr.target),
      index: this.projectExpression(expr.index),
      span,
    };
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

  /** Raw scalar payload for an element of a dynamic array literal (spec §18.14). */
  private rawPayload(element: TypedExpression): ProjectedExpression {
    if (element.expr.kind === "LiteralExpression") {
      return this.projectLiteral(element as TypedLiteralExpression);
    }
    return this.projectExpression(element);
  }

  /** Produce a `DynValue` operand for a dynamic operator/array helper (spec §18.12). */
  private dynOperand(operand: TypedExpression): ProjectedExpression {
    if (isDynamic(operand.choreoType)) {
      return this.projectExpression(operand);
    }
    return this.packValue(operand);
  }

  /** `packDynamic(value-or-null, location)` for a statically located value (spec §18.9). */
  private packValue(expr: TypedExpression): ProjectedExpression {
    const loc = expr.choreoType.location;
    const span = expr.expr.span;
    const value = this.isAvailable(loc)
      ? this.lowerValue(expr)
      : this.nullLiteral(span);
    return this.runtimeCall(
      PACK_DYNAMIC,
      [value, this.locationRef(loc, span)],
      span,
    );
  }

  /** `packDynamic(name-or-null, location)` for a statically located array variable (spec §18.14.2). */
  private packIdentifier(
    name: string,
    type: LocatedType,
    span: Span,
  ): ProjectedExpression {
    const value = this.isAvailable(type.location)
      ? this.identifier(name, span)
      : this.nullLiteral(span);
    return this.runtimeCall(
      PACK_DYNAMIC,
      [value, this.locationRef(type.location, span)],
      span,
    );
  }

  private projectType(type: LocatedType): ProjectedType {
    if (isDynamic(type)) {
      return { kind: "PresentType", base: "DynValue" };
    }
    if (!this.isAvailable(type.location)) {
      return { kind: "AbsentType" };
    }
    const base: ProjectedBaseType = type.isArray
      ? type.base === "integer"
        ? "integer[]"
        : type.base === "float"
          ? "float[]"
          : "boolean[]"
      : type.base === "unit"
        ? "void"
        : type.base;
    return { kind: "PresentType", base };
  }

  private nothingForExpression(
    expr: TypedExpression,
    span: Span,
  ): ExpressionStatement {
    return {
      kind: "ExpressionStatement",
      expression: this.nothingExpression(expr),
      span,
    };
  }

  private nothingExpression(expr: TypedExpression): NothingExpression {
    return {
      kind: "NothingExpression",
      parts: this.nothingParts(expr),
      span: expr.expr.span,
    };
  }

  private nothingParts(expr: TypedExpression): ProjectedExpression[] {
    if (expr.expr.kind === "BinaryExpression") {
      const bin = expr as TypedBinaryExpression;
      if (isDynamic(bin.choreoType)) {
        return [this.projectExpression(bin)];
      }
      return [
        this.projectExpression(bin.left),
        this.projectExpression(bin.right),
      ];
    }
    if (expr.expr.kind === "CallExpression") {
      const call = expr as TypedCallExpression;
      const argParts = call.args.map((arg) => this.projectExpression(arg));
      // Non-owner local call: keep argument expressions containing dynamic
      // helper calls so they still run (spec §18.16.4, §18.18).
      if (argParts.some((part) => this.containsGradualHelper(part))) {
        return argParts;
      }
      // Core v0: all-absent args finalize to nothing(null, ..., null).
      if (argParts.every((part) => this.isAbsentExpr(part))) {
        return argParts;
      }
      return [this.lowerCall(call)];
    }
    return [this.projectExpression(expr)];
  }

  private receiveExpr(
    comm: CommKind,
    sourceParticipant: string,
    tag: string,
    span: Span,
  ): ReceiveExpression {
    return {
      kind: "ReceiveExpression",
      comm,
      sourceParticipant,
      tag,
      span,
    };
  }

  private commKind(base: LocatedType["base"]): CommKind {
    const kind = (base === "integer" || base === "float" || base === "boolean" || base === "string")
      ? base
      : "integer";
    return kind;
  }

  private commKindForType(type: LocatedType): CommKind {
    if (type.isArray) {
      if (type.base === "integer") {
        return "integerArray";
      }
      if (type.base === "float") {
        return "floatArray";
      }
      if (type.base === "boolean") {
        return "booleanArray";
      }
    }
    return this.commKind(type.base);
  }

  private isGradualComm(target: LocatedType, source: LocatedType): boolean {
    return isDynamic(target) || isDynamic(source);
  }

  private isAvailable(location: Location): boolean {
    if (location.kind === "dynamic") {
      return true;
    }
    return available(location, this.useLocation);
  }

  /** Runtime location reference: `EVERY` for `@every`, `"name"` for concrete (spec §18.8). */
  private locationRef(location: Location, span: Span): ProjectedExpression {
    if (location.kind === "concrete") {
      return this.stringLiteral(location.name, span);
    }
    return this.everyRef(span);
  }

  private everyRef(span: Span): IdentifierExpression {
    return { kind: "IdentifierExpression", name: EVERY_CONSTANT, span };
  }

  private identifier(name: string, span: Span): IdentifierExpression {
    return { kind: "IdentifierExpression", name, span };
  }

  private stringLiteral(value: string, span: Span): StringLiteralExpression {
    return { kind: "StringLiteralExpression", value, span };
  }

  private dynValue(
    value: ProjectedExpression,
    location: ProjectedExpression,
    span: Span,
  ): DynValueExpression {
    return { kind: "DynValueExpression", value, location, span };
  }

  private runtimeCall(
    callee: string,
    args: readonly ProjectedExpression[],
    span: Span,
  ): RuntimeCallExpression {
    return { kind: "RuntimeCallExpression", callee, args, span };
  }

  private methodCall(
    receiver: ProjectedExpression,
    method: string,
    args: readonly ProjectedExpression[],
    span: Span,
  ): MethodCallExpression {
    return { kind: "MethodCallExpression", receiver, method, args, span };
  }

  private propertyAccess(
    receiver: ProjectedExpression,
    property: string,
    span: Span,
  ): PropertyAccessExpression {
    return { kind: "PropertyAccessExpression", receiver, property, span };
  }

  /** Whether a projected expression contains a dynamic runtime helper call (spec §18.18). */
  private containsGradualHelper(expr: ProjectedExpression): boolean {
    switch (expr.kind) {
      case "RuntimeCallExpression":
        return true;
      case "DynValueExpression":
        return (
          this.containsGradualHelper(expr.value) ||
          this.containsGradualHelper(expr.location)
        );
      case "MethodCallExpression":
        return (
          this.containsGradualHelper(expr.receiver) ||
          expr.args.some((a) => this.containsGradualHelper(a))
        );
      case "PropertyAccessExpression":
        return this.containsGradualHelper(expr.receiver);
      case "ParenthesizedExpression":
        return this.containsGradualHelper(expr.expression);
      case "BinaryExpression":
        return (
          this.containsGradualHelper(expr.left) ||
          this.containsGradualHelper(expr.right)
        );
      case "UnaryExpression":
        return this.containsGradualHelper(expr.operand);
      case "CallExpression":
        return expr.args.some((a) => this.containsGradualHelper(a));
      case "IndexExpression":
        return (
          this.containsGradualHelper(expr.target) ||
          this.containsGradualHelper(expr.index)
        );
      case "PropertyLengthExpression":
        return this.containsGradualHelper(expr.target);
      case "NothingExpression":
        return expr.parts.some((p) => this.containsGradualHelper(p));
      default:
        return false;
    }
  }

  private absentExpr(span: Span): AbsentExpression {
    return { kind: "AbsentExpression", span };
  }

  private nullLiteral(span: Span): NullLiteralExpression {
    return { kind: "NullLiteralExpression", span };
  }

  private absentStatement(span: Span): AbsentStatement {
    return { kind: "AbsentStatement", span };
  }

  private isAbsentExpr(expr: ProjectedExpression): expr is AbsentExpression {
    return expr.kind === "AbsentExpression";
  }

  private flatten(
    stmt: ProjectedStatement | ProjectedStatement[],
  ): ProjectedStatement[] {
    return Array.isArray(stmt) ? stmt : [stmt];
  }
}

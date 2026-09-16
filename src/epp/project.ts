import type { Span } from "../ast/span.js";
import type { Location } from "../ast/location.js";
import type { LocatedType } from "../ast/typed.js";
import type { FunctionDeclaration } from "../ast/declarations.js";
import type {
  TypedProgram,
  TypedTopLevelItem,
  TypedFunctionDeclaration,
  TypedTopLevelStatement,
  TypedStatement,
  TypedBlock,
  TypedExpression,
  TypedLetStatement,
  TypedLetTransferStatement,
  TypedAssignmentStatement,
  TypedTransferStatement,
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

class Projector {
  private loopDepth = 0;
  private ifDepth = 0;

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
    if (decl.at.kind === "every") {
      return true;
    }
    return decl.at.name === this.endpoint;
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

  private projectLet(stmt: TypedLetStatement): ProjectedStatement {
    const span = stmt.stmt.span;
    if (!this.residesHere(stmt.choreoType.location)) {
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

  private projectLetTransfer(
    stmt: TypedLetTransferStatement,
  ): ProjectedStatement | ProjectedStatement[] {
    if (stmt.transferMode === "localCopy") {
      return this.projectLocalCopyLetTransfer(stmt);
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

    const dstEndpoint = dst.name;
    const srcEndpoint = src.kind === "individual" ? src.name : "";

    if (this.endpoint === srcEndpoint) {
      return {
        kind: "SendStatement",
        comm,
        destinationEndpoint: dstEndpoint,
        tag,
        value: this.projectExpression(stmt.source),
        span,
      };
    }

    if (this.endpoint === dstEndpoint) {
      return {
        kind: "LetStatement",
        name,
        type: this.projectType(stmt.choreoType),
        initializer: this.receiveExpr(comm, srcEndpoint, tag, span),
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
    const srcEndpoint = src.kind === "individual" ? src.name : "";
    const projectedSource = this.projectExpression(source);

    if (this.endpoint === srcEndpoint) {
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
      initializer: this.receiveExpr(comm, srcEndpoint, tag, span),
      span,
    };
  }

  private projectComm(
    stmt: TypedTransferStatement,
  ): ProjectedStatement | ProjectedStatement[] {
    if (stmt.transferMode === "localCopy") {
      return this.projectLocalCopyTransfer(stmt);
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
        stmt.targetType,
        src,
        tag,
        comm,
        stmt.source,
        span,
      );
    }

    const dstEndpoint = dst.name;
    const srcEndpoint = src.kind === "individual" ? src.name : "";

    if (this.endpoint === srcEndpoint) {
      return {
        kind: "SendStatement",
        comm,
        destinationEndpoint: dstEndpoint,
        tag,
        value: this.projectExpression(stmt.source),
        span,
      };
    }

    if (this.endpoint === dstEndpoint) {
      return {
        kind: "AssignmentStatement",
        target: { kind: "IdentifierAssignmentTarget", name },
        value: this.receiveExpr(comm, srcEndpoint, tag, span),
        span,
      };
    }

    return this.absentStatement(span);
  }

  private projectLocalCopyLetTransfer(
    stmt: TypedLetTransferStatement,
  ): ProjectedStatement {
    const span = stmt.stmt.span;
    const dst = stmt.choreoType.location;
    if (!this.residesHere(dst)) {
      return this.absentStatement(span);
    }
    const projectedSource = this.projectExpression(stmt.source);
    const initializer = this.localCopyInitializer(
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

  private projectLocalCopyTransfer(
    stmt: TypedTransferStatement,
  ): ProjectedStatement {
    const span = stmt.stmt.span;
    const dst = stmt.targetType.location;
    if (!this.residesHere(dst)) {
      return this.absentStatement(span);
    }
    const projectedSource = this.projectExpression(stmt.source);
    const value = this.localCopyInitializer(
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

  /** Broadcast to `@every`: sender broadcasts; all endpoints assign from receive or local copy (§11.3). */
  private projectBroadcastComm(
    name: string,
    targetType: LocatedType,
    src: Location,
    tag: string,
    comm: CommKind,
    source: TypedExpression,
    span: Span,
  ): ProjectedStatement | ProjectedStatement[] {
    const srcEndpoint = src.kind === "individual" ? src.name : "";
    const projectedSource = this.projectExpression(source);

    if (src.kind === "individual" && src.name === this.endpoint) {
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
          // The sender keeps its own fresh copy, like every receiver does.
          value: this.localCopyInitializer(targetType, projectedSource, span),
          span,
        },
      ];
    }

    return {
      kind: "AssignmentStatement",
      target: { kind: "IdentifierAssignmentTarget", name },
      value: this.receiveExpr(comm, srcEndpoint, tag, span),
      span,
    };
  }

  private projectAssignment(
    stmt: TypedAssignmentStatement,
  ): ProjectedStatement {
    const span = stmt.stmt.span;
    let targetLocation: Location;
    if (stmt.target.target.kind === "IdentifierAssignmentTarget") {
      targetLocation = (stmt.target as import("../ast/typed.js").TypedIdentifierAssignmentTarget).targetType.location;
    } else {
      targetLocation = (stmt.target as import("../ast/typed.js").TypedIndexAssignmentTarget).arrayType.location;
    }
    if (!this.residesHere(targetLocation)) {
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
  ): import("../ir/projected.js").ProjectedAssignmentTarget {
    if (stmt.target.target.kind === "IdentifierAssignmentTarget") {
      return {
        kind: "IdentifierAssignmentTarget",
        name: stmt.target.target.name,
      };
    }
    const indexTarget = stmt.target as import("../ast/typed.js").TypedIndexAssignmentTarget;
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

  private projectForInit(init: TypedForInit): import("../ir/projected.js").ProjectedForInit {
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

  private projectForAssignmentInit(
    init: TypedForAssignmentInit,
  ): import("../ir/projected.js").ProjectedForAssignmentInit {
    return {
      kind: "ForAssignmentInit",
      name: init.init.name,
      value: this.projectExpression(init.value),
      span: init.init.span,
    };
  }

  private projectForUpdate(
    init: TypedForAssignmentInit,
  ): import("../ir/projected.js").ProjectedForAssignmentInit {
    return this.projectForAssignmentInit(init);
  }

  private projectReturn(stmt: TypedReturnStatement): ProjectedStatement {
    const span = stmt.stmt.span;
    if (stmt.value === undefined) {
      return { kind: "ReturnStatement", span };
    }
    const value = this.projectExpression(stmt.value);
    if (this.isAbsentExpr(value)) {
      return { kind: "ReturnStatement", value, span };
    }
    return { kind: "ReturnStatement", value, span };
  }

  private projectExpressionStatement(
    stmt: TypedExpressionStatement,
  ): ProjectedStatement {
    const span = stmt.stmt.span;
    const expr = stmt.expression;

    if (!this.residesHere(expr.choreoType.location)) {
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
    if (!this.residesHere(expr.choreoType.location)) {
      return this.absentExpr(expr.expr.span);
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
          span: expr.expr.span,
        };
      }
      case "IdentifierExpression":
        return {
          kind: "IdentifierExpression",
          name: expr.expr.name,
          span: expr.expr.span,
        };
      case "BinaryExpression":
        return this.projectBinary(expr as TypedBinaryExpression);
      case "UnaryExpression":
        return this.projectUnary(expr as TypedUnaryExpression);
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

  private projectBinary(expr: TypedBinaryExpression): ProjectedExpression {
    return {
      kind: "BinaryExpression",
      operator: expr.expr.operator,
      left: this.projectExpression(expr.left),
      right: this.projectExpression(expr.right),
      span: expr.expr.span,
    };
  }

  private projectUnary(expr: TypedUnaryExpression): ProjectedExpression {
    return {
      kind: "UnaryExpression",
      operator: expr.expr.operator,
      operand: this.projectExpression(expr.operand),
      span: expr.expr.span,
    };
  }

  private projectCall(expr: TypedCallExpression): ProjectedExpression {
    if (expr.expr.callee === "length" && expr.args.length === 1) {
      return {
        kind: "PropertyLengthExpression",
        target: this.projectExpression(expr.args[0]!),
        span: expr.expr.span,
      };
    }
    if (expr.expr.callee === "push" && expr.args.length === 2) {
      return {
        kind: "CallExpression",
        callee: "__push",
        args: [this.projectExpression(expr.args[0]!), this.projectExpression(expr.args[1]!)],
        span: expr.expr.span,
      };
    }
    const decl = expr.callee.decl;
    if (!this.shouldEmitFunction(decl)) {
      return this.absentExpr(expr.expr.span);
    }

    return {
      kind: "CallExpression",
      callee: expr.expr.callee,
      args: expr.args.map((a) => this.projectExpression(a)),
      span: expr.expr.span,
    };
  }

  private projectType(type: LocatedType): ProjectedType {
    if (!this.residesHere(type.location)) {
      return { kind: "AbsentType" };
    }
    const base: import("../ir/projected.js").ProjectedBaseType = type.isArray
      ? (type.base === "integer"
        ? "integer[]"
        : type.base === "float"
          ? "float[]"
          : "boolean[]")
      : type.base === "unit"
        ? "void"
        : type.base;
    return { kind: "PresentType", base };
  }

  private nothingForExpression(
    expr: TypedExpression,
    span: Span,
  ): import("../ir/projected.js").ExpressionStatement {
    return {
      kind: "ExpressionStatement",
      expression: this.nothingExpression(expr),
      span,
    };
  }

  private nothingExpression(
    expr: TypedExpression,
  ): import("../ir/projected.js").NothingExpression {
    return {
      kind: "NothingExpression",
      parts: this.nothingParts(expr),
      span: expr.expr.span,
    };
  }

  private nothingParts(expr: TypedExpression): ProjectedExpression[] {
    if (expr.expr.kind === "BinaryExpression") {
      const bin = expr as TypedBinaryExpression;
      return [
        this.projectExpression(bin.left),
        this.projectExpression(bin.right),
      ];
    }
    if (expr.expr.kind === "CallExpression") {
      const call = expr as TypedCallExpression;
      const argParts = call.args.map((arg) => this.projectExpression(arg));
      if (argParts.every((part) => part.kind === "AbsentExpression")) {
        return argParts;
      }
      return [this.projectCall(call)];
    }
    return [this.projectExpression(expr)];
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

  /** Does this endpoint hold a copy of a value at `location`? (spec §7.6, §12.2) */
  private residesHere(location: Location): boolean {
    return residesAt(location, this.endpoint);
  }

  private absentExpr(span: Span): AbsentExpression {
    return { kind: "AbsentExpression", span };
  }

  private absentStatement(span: Span): import("../ir/projected.js").AbsentStatement {
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

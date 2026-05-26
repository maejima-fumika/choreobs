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
  TypedBinaryExpression,
  TypedUnaryExpression,
  TypedCallExpression,
  TypedParenthesizedExpression,
} from "../ast/typed.js";
import { available } from "../types/located.js";
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
    const span = stmt.stmt.span;
    const dst = stmt.choreoType.location;
    const src = stmt.source.choreoType.location;
    const tag = stmt.commTag;
    const name = stmt.stmt.name;
    const comm = this.commKind(stmt.choreoType.base);

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

    const dstParticipant = dst.name;
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
          initializer: projectedSource,
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
    const span = stmt.stmt.span;
    const dst = stmt.targetType.location;
    const src = stmt.source.choreoType.location;
    const tag = stmt.commTag;
    const name = stmt.stmt.name;
    const comm = this.commKind(stmt.targetType.base);

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

    const dstParticipant = dst.name;
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
        name,
        value: this.receiveExpr(comm, srcParticipant, tag, span),
        span,
      };
    }

    return this.absentStatement(span);
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
          name,
          value: projectedSource,
          span,
        },
      ];
    }

    return {
      kind: "AssignmentStatement",
      name,
      value: this.receiveExpr(comm, srcParticipant, tag, span),
      span,
    };
  }

  private projectAssignment(
    stmt: TypedAssignmentStatement,
  ): ProjectedStatement {
    const span = stmt.stmt.span;
    if (!this.isAvailable(stmt.targetType.location)) {
      return this.nothingForExpression(stmt.value, span);
    }
    return {
      kind: "AssignmentStatement",
      name: stmt.stmt.name,
      value: this.projectExpression(stmt.value),
      span,
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
    if (!this.isAvailable(expr.choreoType.location)) {
      return this.absentExpr(expr.expr.span);
    }

    switch (expr.expr.kind) {
      case "LiteralExpression":
        return this.projectLiteral(expr as TypedLiteralExpression);
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
    if (!this.isAvailable(type.location)) {
      return { kind: "AbsentType" };
    }
    const base = type.base === "unit" ? "void" : type.base;
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
    if (base === "integer" || base === "float" || base === "boolean" || base === "string") {
      return base;
    }
    return "integer";
  }

  private isAvailable(location: Location): boolean {
    return available(location, this.useLocation);
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

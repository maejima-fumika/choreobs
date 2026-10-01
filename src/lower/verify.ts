import type { Span } from "../ast/span.js";
import type { Location } from "../ast/location.js";
import type { ExecutionContext } from "../ast/context.js";
import type {
  LocatedType,
  LoweredProgram,
  TypedArrayLiteralExpression,
  TypedAssignmentStatement,
  TypedAssignmentTarget,
  TypedBinaryExpression,
  TypedBlock,
  TypedCallExpression,
  TypedConversionExpression,
  TypedExpression,
  TypedExpressionStatement,
  TypedForAssignmentInit,
  TypedForExpressionInit,
  TypedForInit,
  TypedForLetInit,
  TypedForStatement,
  TypedForUpdate,
  TypedIfStatement,
  TypedIndexAssignmentTarget,
  TypedIndexExpression,
  TypedLengthExpression,
  TypedLetStatement,
  TypedLetTransferStatement,
  TypedLiteralExpression,
  TypedParenthesizedExpression,
  TypedPushExpression,
  TypedPrintExpression,
  TypedReturnStatement,
  TypedRuntimeCallExpression,
  TypedStatement,
  TypedTransferStatement,
  TypedUnaryExpression,
  TypedWhileStatement,
} from "../ast/typed.js";
import {
  DYN,
  contextAsLocation,
  formatLocatedType,
  formatLocation,
  isDyn,
  locationsEqual,
} from "../types/located.js";
import {
  DYN_RUNTIME,
  runtimeLocationName,
  type ArgumentShape,
  type DynRuntimeFunction,
} from "../runtime/dyn.js";

/**
 * Checks what `lowerDyn` promises (spec §dyn-lowering): the lowered
 * program obeys the *static* location rules, with the runtime functions typed
 * as in the table of spec §runtime-functions.
 *
 * The checker accepts a `dyn` value wherever `~` holds, and `lowerDyn` must
 * then insert an inject or a cast at exactly those places. A place it misses
 * would not fail anywhere later: endpoint projection would emit a `__DynVal`
 * where a plain value is expected, or the reverse, and the output would look
 * well formed. So this runs on every compilation, and a violation is an
 * internal error.
 */
export function verifyLowered(program: LoweredProgram): void {
  for (const item of program.items) {
    const verifier = new LoweredVerifier(item.context);
    if ("decl" in item) {
      for (const param of item.params) {
        verifier.located(param.type.location, "parameter", param.param.span);
      }
      verifier.located(item.returnType.location, "return type", item.decl.span);
      verifier.block(item.body, item.returnType);
    } else {
      verifier.statement(item.statement, undefined);
    }
  }
}

class LoweredVerifier {
  /**
   * The context of the item being checked. A local function holds no `dyn` at
   * all (spec §local-function-strict-location-rule) — no value, type or runtime call. That is
   * one of the reasons every endpoint performs the same dynamic operations in
   * the same order (spec §dyn), so it is checked here rather than trusted.
   */
  constructor(private readonly context: ExecutionContext) {}

  located(location: Location, what: string, span: Span): void {
    if (this.context.kind === "local" && isDyn(location)) {
      this.fail(`a dyn ${what} in a local function`, span);
    }
  }

  block(block: TypedBlock, returnType: LocatedType | undefined): void {
    for (const stmt of block.statements) {
      this.statement(stmt, returnType);
    }
  }

  statement(stmt: TypedStatement, returnType: LocatedType | undefined): void {
    const context = this.context;
    switch (stmt.stmt.kind) {
      case "LetStatement": {
        const let_ = stmt as TypedLetStatement;
        this.placed(let_.initializer, let_.choreoType.location, "let initializer");
        return;
      }
      case "LetTransferStatement": {
        const transfer = stmt as TypedLetTransferStatement;
        this.staticTransfer(transfer.transferMode, transfer.choreoType, transfer.source);
        return;
      }
      case "AssignmentStatement": {
        const assignment = stmt as TypedAssignmentStatement;
        this.assignment(assignment.target, assignment.value);
        return;
      }
      case "TransferStatement": {
        const transfer = stmt as TypedTransferStatement;
        this.staticTransfer(transfer.transferMode, transfer.targetType, transfer.source);
        return;
      }
      case "IfStatement": {
        const ifStmt = stmt as TypedIfStatement;
        this.placed(ifStmt.condition, contextAsLocation(context), "condition");
        this.block(ifStmt.then, returnType);
        if (ifStmt.else !== undefined) {
          this.block(ifStmt.else, returnType);
        }
        return;
      }
      case "WhileStatement": {
        const whileStmt = stmt as TypedWhileStatement;
        this.placed(whileStmt.condition, contextAsLocation(context), "condition");
        this.block(whileStmt.body, returnType);
        return;
      }
      case "ForStatement": {
        const forStmt = stmt as TypedForStatement;
        if (forStmt.init !== undefined) {
          this.forClause(forStmt.init);
        }
        this.placed(forStmt.condition, contextAsLocation(context), "condition");
        if (forStmt.update !== undefined) {
          this.forClause(forStmt.update);
        }
        this.block(forStmt.body, returnType);
        return;
      }
      case "ReturnStatement": {
        const ret = stmt as TypedReturnStatement;
        if (ret.value !== undefined && returnType !== undefined) {
          this.placed(ret.value, returnType.location, "return value");
        }
        return;
      }
      case "ExpressionStatement":
        this.expr((stmt as TypedExpressionStatement).expression);
        return;
    }
  }

  private staticTransfer(
    mode: string,
    destination: LocatedType,
    source: TypedExpression,
  ): void {
    if (mode === "dynamic") {
      this.fail("a dynamic transfer was not lowered", source.expr.span);
    }
    this.expr(source);
    this.concrete(destination.location, "transfer destination", source.expr.span);
    this.concrete(source.choreoType.location, "transfer source", source.expr.span);
  }

  private forClause(clause: TypedForInit | TypedForUpdate): void {
    switch (clause.init.kind) {
      case "ForLetInit": {
        const letInit = clause as TypedForLetInit;
        this.placed(letInit.initializer, letInit.choreoType.location, "let initializer");
        return;
      }
      case "ForAssignmentInit": {
        const assignment = clause as TypedForAssignmentInit;
        this.assignment(assignment.target, assignment.value);
        return;
      }
      case "ForExpressionInit":
        this.expr((clause as TypedForExpressionInit).expression);
        return;
    }
  }

  private assignment(target: TypedAssignmentTarget, value: TypedExpression): void {
    if (target.target.kind === "IdentifierAssignmentTarget") {
      const identifier = target as import("../ast/typed.js").TypedIdentifierAssignmentTarget;
      this.placed(value, identifier.targetType.location, "assigned value");
      return;
    }
    const index = target as TypedIndexAssignmentTarget;
    const location = index.arrayType.location;
    this.concrete(location, "element assignment", value.expr.span);
    this.placed(index.index, location, "array index");
    this.placed(value, location, "assigned element");
  }

  private expr(expr: TypedExpression): void {
    const location = expr.choreoType.location;
    const span = expr.expr.span;
    this.located(location, "value", span);
    switch (expr.expr.kind) {
      case "LiteralExpression":
        this.concrete(location, "literal", span);
        return;
      case "ArrayLiteralExpression": {
        const array = expr as TypedArrayLiteralExpression;
        this.concrete(location, "array literal", span);
        for (const element of array.elements) {
          this.placed(element, location, "array element");
        }
        return;
      }
      case "IdentifierExpression":
        return;
      case "BinaryExpression": {
        const binary = expr as TypedBinaryExpression;
        this.concrete(location, "binary operation", span);
        this.placed(binary.left, location, "operand");
        this.placed(binary.right, location, "operand");
        return;
      }
      case "UnaryExpression": {
        const unary = expr as TypedUnaryExpression;
        this.concrete(location, "unary operation", span);
        this.placed(unary.operand, location, "operand");
        return;
      }
      case "ConversionExpression": {
        const conversion = expr as TypedConversionExpression;
        this.concrete(location, "conversion", span);
        this.placed(conversion.operand, location, "operand");
        return;
      }
      case "CallExpression": {
        const call = expr as TypedCallExpression;
        call.args.forEach((arg, i) => {
          this.placed(arg, call.callee.params[i]!.location, "argument");
        });
        return;
      }
      case "IndexExpression": {
        const index = expr as TypedIndexExpression;
        this.concrete(location, "array access", span);
        this.placed(index.target, location, "array");
        this.placed(index.index, location, "array index");
        return;
      }
      case "LengthExpression": {
        const length = expr as TypedLengthExpression;
        this.concrete(location, "array length", span);
        this.placed(length.target, location, "array");
        return;
      }
      case "PushExpression": {
        const push = expr as TypedPushExpression;
        this.concrete(location, "push", span);
        this.placed(push.target, location, "array");
        this.placed(push.value, location, "pushed value");
        return;
      }
      case "PrintExpression": {
        const print = expr as TypedPrintExpression;
        this.concrete(location, "print", span);
        this.placed(print.value, location, "printed value");
        return;
      }
      case "ParenthesizedExpression":
        this.expr((expr as TypedParenthesizedExpression).expression);
        return;
      case "RuntimeCallExpression":
        this.runtimeCall(expr as TypedRuntimeCallExpression);
        return;
    }
  }

  private runtimeCall(call: TypedRuntimeCallExpression): void {
    const signature = DYN_RUNTIME[call.callee];
    const span = call.expr.span;
    if (this.context.kind === "local") {
      this.fail(`a call to ${call.callee} in a local function`, span);
    }
    if (call.args.length !== signature.args.length) {
      this.fail(
        `${call.callee} takes ${signature.args.length} argument(s), got ${call.args.length}`,
        span,
      );
    }
    call.args.forEach((arg, i) => {
      this.argument(call.callee, arg, signature.args[i]!);
    });
    const result = call.choreoType;
    switch (signature.result) {
      case "dyn":
        if (!isDyn(result.location)) {
          this.fail(`${call.callee} must yield a dyn value, not ${formatLocatedType(result)}`, span);
        }
        return;
      case "void":
        if (result.base !== "void") {
          this.fail(`${call.callee} yields no value, not ${formatLocatedType(result)}`, span);
        }
        return;
      case "named": {
        const named = this.constantValue(call.args[1]!);
        this.concrete(result.location, call.callee, span);
        if (runtimeLocationName(result.location) !== named) {
          this.fail(
            `${call.callee}(…, "${named}") must yield a value at ${named}, not ${formatLocatedType(result)}`,
            span,
          );
        }
        return;
      }
    }
  }

  private argument(
    callee: DynRuntimeFunction,
    arg: TypedExpression,
    shape: ArgumentShape,
  ): void {
    const span = arg.expr.span;
    switch (shape) {
      case "dyn":
        this.placed(arg, DYN, `${callee} argument`);
        return;
      case "concrete":
        this.expr(arg);
        this.concrete(arg.choreoType.location, `${callee} argument`, span);
        return;
      case "constant":
        this.constantValue(arg);
        return;
      case "payload":
        if (
          arg.expr.kind !== "LiteralExpression" ||
          arg.choreoType.location.kind !== "every"
        ) {
          this.fail(`${callee} takes a literal at every`, span);
        }
        return;
    }
  }

  /** The value of a compiler-supplied `string@every` literal argument. */
  private constantValue(arg: TypedExpression): string {
    if (arg.expr.kind === "LiteralExpression") {
      const raw = (arg as TypedLiteralExpression).literal.literal;
      if (raw.kind === "StringLiteral" && arg.choreoType.location.kind === "every") {
        return raw.value;
      }
    }
    return this.fail("expected a string@every constant argument", arg.expr.span);
  }

  /** `expr` must sit exactly at `location`: no `~` is left after lowering. */
  private placed(expr: TypedExpression, location: Location, what: string): void {
    this.expr(expr);
    if (!locationsEqual(expr.choreoType.location, location)) {
      this.fail(
        `${what} is ${formatLocatedType(expr.choreoType)} where ${formatLocation(location)} is required`,
        expr.expr.span,
      );
    }
  }

  /** Only identifiers, calls and runtime calls may still produce `dyn` values. */
  private concrete(location: Location, what: string, span: Span): void {
    if (isDyn(location)) {
      this.fail(`${what} at dyn was not lowered`, span);
    }
  }

  private fail(message: string, span: Span): never {
    throw new Error(
      `internal error: dynamic-location lowering left ${message} (at offset ${span.start})`,
    );
  }
}

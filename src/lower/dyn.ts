import type { Span } from "../ast/span.js";
import type { Location } from "../ast/location.js";
import type { ExecutionContext } from "../ast/context.js";
import type { LocatedLiteral } from "../ast/literals.js";
import type {
  AssignmentStatement,
  ExpressionStatement,
  LetStatement,
} from "../ast/statements.js";
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
  TypedFunctionDeclaration,
  TypedIdentifierExpression,
  TypedIfStatement,
  TypedIndexAssignmentTarget,
  TypedIndexExpression,
  TypedLengthExpression,
  TypedLetStatement,
  TypedLetTransferStatement,
  TypedLiteralExpression,
  TypedParenthesizedExpression,
  TypedProgram,
  TypedPushExpression,
  TypedReturnStatement,
  TypedRuntimeCallExpression,
  TypedStatement,
  TypedTopLevelItem,
  TypedTopLevelStatement,
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
  joinLocations,
  locatedType,
  locationsEqual,
} from "../types/located.js";
import { commKindForType } from "../comm/kind.js";
import {
  DYN_BINARY,
  DYN_UNARY,
  type DynRuntimeFunction,
} from "../runtime/dyn.js";

/**
 * Dynamic-location lowering (spec-dyn.md, sections 3.3–3.5 and 8.2) — the
 * stage between tag assignment and endpoint projection.
 *
 * The checker types a program with `~` and `⊔`, so a `dyn` value may meet a
 * concrete location anywhere the rules allow it. This pass makes each such
 * meeting explicit, and turns every dynamic operation into a call to the
 * runtime:
 *
 * - where a value is placed at a location it is not at, `coerce` inserts
 *   `__inject(e, "q")` (to `dyn`) or `__cast(e, "q")` (from `dyn`);
 * - a `dyn` literal, array literal, operator, conversion or array operation
 *   becomes the runtime function that performs it;
 * - a dynamic transfer becomes a `let` or an assignment of `__dynTransfer`,
 *   carrying the tag `assignCommTags` gave the transfer (section 11.1).
 *
 * What comes out obeys the static location rules everywhere, with the runtime
 * functions as ordinary callees made at every endpoint. Endpoint projection
 * therefore needs no rule of its own for them (section 8.2), and
 * `verifyLowered` can check the result against the static rules alone.
 *
 * A program without `dyn` comes out as it went in: every rewrite here is
 * conditional on a `dyn` location, so the static output cannot change.
 */
export function lowerDyn(typed: TypedProgram): LoweredProgram {
  const lowerer = new DynLowerer();
  return {
    kind: "LoweredProgram",
    program: typed.program,
    items: typed.items.map((item) => lowerer.item(item)),
  };
}

/** What the statements of one body are checked against. */
interface Scope {
  readonly context: ExecutionContext;
  /** The enclosing function's return type; absent at top level. */
  readonly returnType?: LocatedType;
}

const EVERY: Location = { kind: "every" };

class DynLowerer {
  item(item: TypedTopLevelItem): TypedTopLevelItem {
    if ("decl" in item) {
      const fn: TypedFunctionDeclaration = item;
      const scope: Scope = { context: fn.context, returnType: fn.returnType };
      return { ...fn, body: this.block(fn.body, scope) };
    }
    const top: TypedTopLevelStatement = item;
    return {
      ...top,
      statement: this.statement(top.statement, { context: top.context }),
    };
  }

  // --- statements ---------------------------------------------------------

  private block(block: TypedBlock, scope: Scope): TypedBlock {
    return {
      ...block,
      statements: block.statements.map((stmt) => this.statement(stmt, scope)),
    };
  }

  private statement(stmt: TypedStatement, scope: Scope): TypedStatement {
    switch (stmt.stmt.kind) {
      case "LetStatement": {
        const let_ = stmt as TypedLetStatement;
        return {
          ...let_,
          initializer: this.coerced(let_.initializer, let_.choreoType.location),
        };
      }
      case "LetTransferStatement":
        return this.letTransfer(stmt as TypedLetTransferStatement);
      case "AssignmentStatement":
        return this.assignment(stmt as TypedAssignmentStatement);
      case "TransferStatement":
        return this.transfer(stmt as TypedTransferStatement);
      case "IfStatement": {
        const ifStmt = stmt as TypedIfStatement;
        return {
          ...ifStmt,
          condition: this.condition(ifStmt.condition, scope),
          then: this.block(ifStmt.then, scope),
          else: ifStmt.else === undefined ? undefined : this.block(ifStmt.else, scope),
        };
      }
      case "WhileStatement": {
        const whileStmt = stmt as TypedWhileStatement;
        return {
          ...whileStmt,
          condition: this.condition(whileStmt.condition, scope),
          body: this.block(whileStmt.body, scope),
        };
      }
      case "ForStatement": {
        const forStmt = stmt as TypedForStatement;
        return {
          ...forStmt,
          init: forStmt.init === undefined ? undefined : this.forInit(forStmt.init),
          condition: this.condition(forStmt.condition, scope),
          update:
            forStmt.update === undefined ? undefined : this.forUpdate(forStmt.update),
          body: this.block(forStmt.body, scope),
        };
      }
      case "ReturnStatement": {
        const ret = stmt as TypedReturnStatement;
        if (ret.value === undefined || scope.returnType === undefined) {
          return ret;
        }
        return { ...ret, value: this.coerced(ret.value, scope.returnType.location) };
      }
      case "ExpressionStatement": {
        const exprStmt = stmt as TypedExpressionStatement;
        return { ...exprStmt, expression: this.expr(exprStmt.expression) };
      }
    }
  }

  /**
   * A condition is required at the context's location: `every` in a
   * choreography, so a `dyn` one is cast there (spec-dyn.md, section 15).
   */
  private condition(condition: TypedExpression, scope: Scope): TypedExpression {
    return this.coerced(condition, contextAsLocation(scope.context));
  }

  private letTransfer(stmt: TypedLetTransferStatement): TypedStatement {
    if (stmt.transferMode !== "dynamic") {
      return { ...stmt, source: this.expr(stmt.source) };
    }
    // `let a: T@L <- e;` becomes `let a: T@L = [__cast(]__dynTransfer(...)[)];`
    // (spec-dyn.md, section 3.5), and projects as the `let` it now is.
    const let_: LetStatement = {
      kind: "LetStatement",
      name: stmt.stmt.name,
      type: stmt.stmt.type,
      initializer: stmt.stmt.source,
      span: stmt.stmt.span,
    };
    const lowered: TypedLetStatement = {
      stmt: let_,
      choreoType: stmt.choreoType,
      initializer: this.dynamicTransfer(stmt.choreoType, stmt.source, stmt.commTag, stmt.stmt.span),
    };
    return lowered;
  }

  private transfer(stmt: TypedTransferStatement): TypedStatement {
    if (stmt.transferMode !== "dynamic") {
      return { ...stmt, source: this.expr(stmt.source) };
    }
    // `a <- e;` becomes `a = [__cast(]__dynTransfer(...)[)];` (spec-dyn.md, section 3.5).
    const target = {
      kind: "IdentifierAssignmentTarget" as const,
      name: stmt.stmt.name,
      span: stmt.stmt.span,
    };
    const assignment: AssignmentStatement = {
      kind: "AssignmentStatement",
      target,
      value: stmt.stmt.source,
      span: stmt.stmt.span,
    };
    const lowered: TypedAssignmentStatement = {
      stmt: assignment,
      target: { target, targetType: stmt.targetType },
      value: this.dynamicTransfer(stmt.targetType, stmt.source, stmt.commTag, stmt.stmt.span),
    };
    return lowered;
  }

  /**
   * `__dynTransfer(tag, kind, "L", coerce(e → T@dyn))`, cast to the
   * destination when that is concrete (spec-dyn.md, sections 3.5 and 11).
   */
  private dynamicTransfer(
    destination: LocatedType,
    source: TypedExpression,
    tag: string | undefined,
    span: Span,
  ): TypedExpression {
    if (tag === undefined) {
      // Every dynamic transfer is tagged, like every transfer that may
      // communicate (spec-dyn.md, section 11.1). Without one the endpoints
      // could not pair the communication the runtime decides on.
      throw new Error(
        `internal error: dynamic transfer at ${span.start} has no communication tag`,
      );
    }
    const transferred = this.call(
      "__dynTransfer",
      [
        this.constant(tag, span),
        this.constant(commKindForType(destination), span),
        this.constant(formatLocation(destination.location), span),
        this.coerced(source, DYN),
      ],
      { ...destination, location: DYN },
      span,
    );
    return this.coerce(transferred, destination.location);
  }

  private assignment(stmt: TypedAssignmentStatement): TypedStatement {
    const span = stmt.stmt.span;
    if (this.isDynamicElementAssignment(stmt.target, stmt.value)) {
      const expressionStatement: ExpressionStatement = {
        kind: "ExpressionStatement",
        expression: stmt.stmt.value,
        span,
      };
      const lowered: TypedExpressionStatement = {
        stmt: expressionStatement,
        expression: this.dynamicElementSet(
          stmt.target as TypedIndexAssignmentTarget,
          stmt.value,
          span,
        ),
      };
      return lowered;
    }
    const { target, value } = this.assignmentParts(stmt.target, stmt.value);
    return { ...stmt, target, value };
  }

  private forInit(init: TypedForInit): TypedForInit {
    switch (init.init.kind) {
      case "ForLetInit": {
        const letInit = init as TypedForLetInit;
        return {
          ...letInit,
          initializer: this.coerced(letInit.initializer, letInit.choreoType.location),
        };
      }
      case "ForAssignmentInit":
        return this.forAssignment(init as TypedForAssignmentInit);
      case "ForExpressionInit": {
        const exprInit = init as TypedForExpressionInit;
        return { ...exprInit, expression: this.expr(exprInit.expression) };
      }
    }
  }

  private forUpdate(update: TypedForUpdate): TypedForUpdate {
    if (update.init.kind === "ForExpressionInit") {
      const exprInit = update as TypedForExpressionInit;
      return { ...exprInit, expression: this.expr(exprInit.expression) };
    }
    return this.forAssignment(update as TypedForAssignmentInit);
  }

  /**
   * A `for` header has no room for a statement, so a dynamic element
   * assignment there becomes a bare expression slot.
   */
  private forAssignment(
    init: TypedForAssignmentInit,
  ): TypedForAssignmentInit | TypedForExpressionInit {
    if (this.isDynamicElementAssignment(init.target, init.value)) {
      return {
        init: { kind: "ForExpressionInit", span: init.init.span },
        expression: this.dynamicElementSet(
          init.target as TypedIndexAssignmentTarget,
          init.value,
          init.init.span,
        ),
      };
    }
    const { target, value } = this.assignmentParts(init.target, init.value);
    return { ...init, target, value };
  }

  /** The target and value of an assignment that stays one. */
  private assignmentParts(
    target: TypedAssignmentTarget,
    value: TypedExpression,
  ): { readonly target: TypedAssignmentTarget; readonly value: TypedExpression } {
    if (target.target.kind === "IdentifierAssignmentTarget") {
      const identifier = target as import("../ast/typed.js").TypedIdentifierAssignmentTarget;
      return {
        target,
        value: this.coerced(value, identifier.targetType.location),
      };
    }
    const index = target as TypedIndexAssignmentTarget;
    return {
      target: { ...index, index: this.expr(index.index) },
      value: this.coerced(value, index.arrayType.location),
    };
  }

  /**
   * `xs[i] = v` is dynamic when the array, the index or the value is `dyn`
   * (spec-dyn.md, section 3.2): `arrAlice[iAlice] = valDyn` included.
   */
  private isDynamicElementAssignment(
    target: TypedAssignmentTarget,
    value: TypedExpression,
  ): boolean {
    if (target.target.kind !== "IndexAssignmentTarget") {
      return false;
    }
    const index = target as TypedIndexAssignmentTarget;
    return isDyn(
      joinLocations(
        joinLocations(index.arrayType.location, index.index.choreoType.location),
        value.choreoType.location,
      ),
    );
  }

  /**
   * `__dynArraySet(xs, i, v)`, arguments in the order the assignment evaluates
   * them (spec-dyn.md, section 12.2; spec §evaluation-order).
   */
  private dynamicElementSet(
    target: TypedIndexAssignmentTarget,
    value: TypedExpression,
    span: Span,
  ): TypedExpression {
    const array: TypedIdentifierExpression = {
      expr: {
        kind: "IdentifierExpression",
        name: target.target.name,
        span: target.target.span,
      },
      choreoType: target.arrayType,
    };
    return this.call(
      "__dynArraySet",
      [
        this.coerce(array, DYN),
        this.coerced(target.index, DYN),
        this.coerced(value, DYN),
      ],
      locatedType("void", DYN),
      span,
    );
  }

  // --- expressions --------------------------------------------------------

  /** Lowers `expr` and places it at `location` (spec-dyn.md, section 3.3). */
  private coerced(expr: TypedExpression, location: Location): TypedExpression {
    return this.coerce(this.expr(expr), location);
  }

  /**
   * `coerce(e : S@L → S@L')` on an already lowered `e` (spec-dyn.md, section
   * 3.3): nothing when the locations agree, `inj<q>` into `dyn`, `cast<q>` out
   * of it. Only the location changes; the base type never does (section 3.4).
   */
  private coerce(expr: TypedExpression, location: Location): TypedExpression {
    const from = expr.choreoType.location;
    if (locationsEqual(from, location)) {
      return expr;
    }
    const span = expr.expr.span;
    if (isDyn(location)) {
      return this.call(
        "__inject",
        [expr, this.constant(formatLocation(from), span)],
        { ...expr.choreoType, location: DYN },
        span,
      );
    }
    if (isDyn(from)) {
      return this.call(
        "__cast",
        [expr, this.constant(formatLocation(location), span)],
        { ...expr.choreoType, location },
        span,
      );
    }
    // Two different concrete locations never meet: the checker requires `~`.
    throw new Error(
      `internal error: cannot place ${formatLocatedType(expr.choreoType)} at ${formatLocation(location)}`,
    );
  }

  private expr(expr: TypedExpression): TypedExpression {
    const span = expr.expr.span;
    switch (expr.expr.kind) {
      case "LiteralExpression": {
        const literal = expr as TypedLiteralExpression;
        if (!isDyn(literal.choreoType.location)) {
          return literal;
        }
        // `c@dyn` is `__dynUnbound(c)`: the same payload everywhere, and a
        // fresh unbound location variable (spec-dyn.md, section 5.1).
        const payload: TypedLiteralExpression = {
          ...literal,
          choreoType: { ...literal.choreoType, location: EVERY },
        };
        return this.call("__dynUnbound", [payload], literal.choreoType, span);
      }
      case "ArrayLiteralExpression":
        return this.arrayLiteral(expr as TypedArrayLiteralExpression);
      case "IdentifierExpression":
        return expr;
      case "BinaryExpression": {
        const binary = expr as TypedBinaryExpression;
        const left = this.expr(binary.left);
        const right = this.expr(binary.right);
        if (!isDyn(binary.choreoType.location)) {
          return { ...binary, left, right };
        }
        // A static operand is injected first (spec-dyn.md, section 3.3).
        return this.call(
          DYN_BINARY[binary.expr.operator],
          [this.coerce(left, DYN), this.coerce(right, DYN)],
          binary.choreoType,
          span,
        );
      }
      case "UnaryExpression": {
        const unary = expr as TypedUnaryExpression;
        const operand = this.expr(unary.operand);
        if (!isDyn(unary.choreoType.location)) {
          return { ...unary, operand };
        }
        return this.call(DYN_UNARY[unary.expr.operator], [operand], unary.choreoType, span);
      }
      case "ConversionExpression":
        return this.conversion(expr as TypedConversionExpression);
      case "CallExpression": {
        const call = expr as TypedCallExpression;
        return {
          ...call,
          args: call.args.map((arg, i) =>
            this.coerced(arg, call.callee.params[i]!.location),
          ),
        };
      }
      case "IndexExpression": {
        const index = expr as TypedIndexExpression;
        const target = this.expr(index.target);
        const position = this.expr(index.index);
        if (!isDyn(index.choreoType.location)) {
          return { ...index, target, index: position };
        }
        return this.call(
          "__dynArrayGet",
          [this.coerce(target, DYN), this.coerce(position, DYN)],
          index.choreoType,
          span,
        );
      }
      case "LengthExpression": {
        const length = expr as TypedLengthExpression;
        const target = this.expr(length.target);
        if (!isDyn(length.choreoType.location)) {
          return { ...length, target };
        }
        return this.call("__dynArrayLength", [target], length.choreoType, span);
      }
      case "PushExpression": {
        const push = expr as TypedPushExpression;
        const target = this.expr(push.target);
        const value = this.expr(push.value);
        if (!isDyn(push.choreoType.location)) {
          return { ...push, target, value };
        }
        return this.call(
          "__dynArrayPush",
          [this.coerce(target, DYN), this.coerce(value, DYN)],
          push.choreoType,
          span,
        );
      }
      case "ParenthesizedExpression": {
        const paren = expr as TypedParenthesizedExpression;
        const inner = this.expr(paren.expression);
        // A call needs no parentheses of its own; keeping the source's would
        // only wrap `__dynPlus(a, b)` in another pair.
        if (inner.expr.kind === "RuntimeCallExpression") {
          return inner;
        }
        return { ...paren, expression: inner };
      }
      case "RuntimeCallExpression":
        return expr;
    }
  }

  /**
   * `[e1, …, en]@dyn` is built one element at a time onto a typed empty array,
   * whatever the elements are (spec-dyn.md, section 5.2). A concrete array
   * literal stays a literal; its `dyn` elements are cast to its location.
   */
  private arrayLiteral(array: TypedArrayLiteralExpression): TypedExpression {
    const location = array.choreoType.location;
    const elements = array.elements.map((element) => this.coerced(element, location));
    if (!isDyn(location)) {
      return { ...array, elements };
    }
    const span = array.expr.span;
    let built: TypedExpression = this.call(
      "__dynArrayNew",
      [this.constant(commKindForType(array.choreoType), span)],
      array.choreoType,
      span,
    );
    for (const element of elements) {
      built = this.call("__dynArrayAppend", [built, element], array.choreoType, span);
    }
    return built;
  }

  /**
   * `e as T` on a `dyn` operand (spec-dyn.md, sections 3.4 and 10.5): one
   * runtime function per pair of types, and nothing when the type stays the
   * same, since the payload is already in its representation. A concrete
   * operand keeps BlueScript's own `as`.
   */
  private conversion(conversion: TypedConversionExpression): TypedExpression {
    const operand = this.expr(conversion.operand);
    if (!isDyn(operand.choreoType.location)) {
      return { ...conversion, operand };
    }
    if (operand.choreoType.base === conversion.choreoType.base) {
      return operand;
    }
    return this.call(
      conversion.choreoType.base === "float" ? "__dynIntegerToFloat" : "__dynFloatToInteger",
      [operand],
      conversion.choreoType,
      conversion.expr.span,
    );
  }

  // --- construction -------------------------------------------------------

  private call(
    callee: DynRuntimeFunction,
    args: readonly TypedExpression[],
    choreoType: LocatedType,
    span: Span,
  ): TypedRuntimeCallExpression {
    return {
      expr: { kind: "RuntimeCallExpression", span },
      choreoType,
      callee,
      args,
    };
  }

  /**
   * A string argument the compiler supplies — a location, a kind or a tag.
   * It is `string@every`, the same at every endpoint (spec-dyn.md, section 8.2).
   */
  private constant(value: string, span: Span): TypedLiteralExpression {
    const literal: LocatedLiteral = {
      kind: "LocatedLiteral",
      literal: { kind: "StringLiteral", value, span },
      span,
    };
    return {
      expr: { kind: "LiteralExpression", literal, span },
      choreoType: locatedType("string", EVERY),
      literal,
    };
  }
}

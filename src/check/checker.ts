import type { Span } from "../ast/span.js";
import type { Program, TopLevelItem, TopLevelStatement } from "../ast/program.js";
import type { FunctionDeclaration } from "../ast/declarations.js";
import type {
  Statement,
  Block,
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
  ForInit,
  ForLetInit,
  ForAssignmentInit,
} from "../ast/statements.js";
import type {
  Expression,
  BinaryExpression,
  UnaryExpression,
  LiteralExpression,
  ArrayLiteralExpression,
  IdentifierExpression,
  CallExpression,
  IndexExpression,
  LengthExpression,
  PushExpression,
  ParenthesizedExpression,
} from "../ast/expressions.js";
import type { ExecutionContext } from "../ast/context.js";
import type { Location } from "../ast/location.js";
import type {
  TypedProgram,
  TypedTopLevelItem,
  TypedTopLevelStatement,
  TypedFunctionDeclaration,
  TypedParameter,
  TypedStatement,
  TypedBlock,
  TypedExpression,
  TypedLetStatement,
  TypedLetTransferStatement,
  TypedAssignmentStatement,
  TypedAssignmentTarget,
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
  TypedBinaryExpression,
  TypedUnaryExpression,
  TypedLiteralExpression,
  TypedArrayLiteralExpression,
  TypedIdentifierExpression,
  TypedCallExpression,
  TypedIndexExpression,
  TypedLengthExpression,
  TypedParenthesizedExpression,
  LocatedType,
  TransferMode,
  FunctionSymbol,
} from "../ast/typed.js";
import type { ChoreoBSConfig } from "../config/types.js";
import { CHOREOGRAPHY_CONTEXT } from "../ast/context.js";
import {
  contextAsLocation,
  formatLocatedType,
  isArraySubtype,
  locatedType,
  locationsEqual,
} from "../types/located.js";
import {
  TypeResolveError,
  rawLiteralBaseType,
  resolveLiteralType,
  resolveTypeAnnotation,
  validateArrayTypeAnnotation,
} from "./resolve.js";
import type { SpecRefs } from "../spec/ref.js";
import { typeCheckError, type TypeCheckError } from "./errors.js";
import { assertNever } from "../util/exhaustive.js";
import { childExpressions } from "../ast/traverse.js";
import { isReservedRuntimeName } from "../runtime/names.js";
import {
  checkReturnCoverage,
  inferReturnTypeFromCandidates,
  type ReturnCandidate,
} from "./inference.js";
import {
  isRecursiveComponent,
  stronglyConnectedComponents,
} from "./recursion.js";

export interface TypeCheckResult {
  readonly typed: TypedProgram | null;
  readonly errors: readonly TypeCheckError[];
}

export function typeCheck(
  program: Program,
  config: ChoreoBSConfig,
): TypeCheckResult {
  const checker = new TypeChecker(program, config);
  return checker.check();
}

/** How a {@link TypeChecker.nameHolder} result reads in a diagnostic. */
function describeHolder(holder: "runtime" | "endpoint" | "function"): string {
  switch (holder) {
    case "runtime":
      return "a reserved runtime name";
    case "endpoint":
      return "an endpoint name";
    case "function":
      return "a function name";
  }
}

/**
 * The location a function's body is anchored at, for return type inference.
 * A choreography function is anchored at `every` (spec §function-return-type-inference).
 */
function functionLocationOf(decl: FunctionDeclaration): Location {
  return decl.at ?? { kind: "every" };
}

/**
 * Thrown by {@link TypeChecker.error} to abandon the rest of type checking.
 *
 * Checking stops at the first error (spec §compile-time-errors). Continuing would mean inventing
 * a type for the construct that just failed, and every later diagnostic derived
 * from that invented type would be noise.
 */
class FailFast extends Error {}

class TypeChecker {
  private readonly errors: TypeCheckError[] = [];
  private readonly functions = new Map<string, FunctionDeclaration>();
  private readonly resolvedReturnTypes = new Map<string, LocatedType>();
  /** Used to check `@L` against the declared set; the set itself is validated
   * by `validateEndpoints` before the checker runs (spec §choreobs-json). */
  private readonly endpoints: Set<string>;
  private currentFunction: FunctionDeclaration | undefined;
  /** Resolved return type for the function currently being type-checked. */
  private currentFunctionReturnType: LocatedType | undefined;
  /**
   * Set while inferring an omitted return type (spec §function-return-type-inference). The body is
   * checked by the ordinary machinery, but there is no declared type yet to
   * check a `return` against, so each one is collected here instead.
   */
  private returnCandidates: ReturnCandidate[] | undefined;
  private inTopLevel = false;
  private readonly topLevelEnv = new Map<string, LocatedType>();
  private envStack: Map<string, LocatedType>[] = [];

  constructor(
    private readonly program: Program,
    config: ChoreoBSConfig,
  ) {
    this.endpoints = new Set(config.endpoints);
  }

  check(): TypeCheckResult {
    try {
      return this.checkProgram();
    } catch (e) {
      if (e instanceof FailFast) {
        return { typed: null, errors: this.errors };
      }
      throw e;
    }
  }

  private checkProgram(): TypeCheckResult {
    this.collectFunctions();
    this.checkRecursion();
    this.resolveExplicitFunctionSignatures();
    this.inferOmittedReturnTypes();
    const items: TypedTopLevelItem[] = [];
    for (const item of this.program.items) {
      items.push(this.checkTopLevelItem(item));
    }
    const typed: TypedProgram = {
      kind: "TypedProgram",
      program: this.program,
      items,
    };
    return {
      typed: this.errors.length === 0 ? typed : null,
      errors: this.errors,
    };
  }

  private collectFunctions(): void {
    for (const item of this.program.items) {
      if (item.kind !== "FunctionDeclaration") {
        continue;
      }
      this.rejectNameConflict(item.name, "function", item.span);
      const existing = this.functions.get(item.name);
      if (existing !== undefined) {
        this.error(
          `duplicate function '${item.name}'`,
          item.span,
          ["function-names"],
        );
      }
      this.functions.set(item.name, item);
      if (item.at !== undefined) {
        if (item.at.kind === "every") {
          this.error(
            `function '${item.name}': 'every' is not a function location. A declared location makes a function local and must be individual.`,
            item.span,
            ["function-kinds", "every-on-a-function-declaration"],
          );
        }
        this.validateLocation(item.at, item.span);
      }
    }
  }

  /** Recursion rules (spec §inference-and-recursion, §recursion), over the whole call graph. */
  private checkRecursion(): void {
    const names = [...this.functions.keys()];
    const callGraph = new Map<string, readonly string[]>();
    for (const name of names) {
      const decl = this.functions.get(name)!;
      const callees = [...this.collectCalleeNames(decl.body)].filter((callee) =>
        this.functions.has(callee),
      );
      callGraph.set(name, callees);
    }
    const successors = (name: string): readonly string[] =>
      callGraph.get(name) ?? [];
    const components = stronglyConnectedComponents(names, successors);
    for (const component of components) {
      if (!isRecursiveComponent(component, successors)) {
        continue;
      }
      for (const name of component) {
        const decl = this.functions.get(name);
        if (decl === undefined) {
          continue;
        }
        if (decl.at === undefined) {
          this.error(
            `choreography function '${name}' cannot be recursive`,
            decl.span,
            ["recursion"],
          );
        }
        if (decl.returnType === undefined) {
          this.error(
            `function '${name}' with omitted return type cannot be recursive`,
            decl.span,
            ["inference-and-recursion"],
          );
        }
      }
    }
  }

  private resolveExplicitFunctionSignatures(): void {
    for (const decl of this.functions.values()) {
      if (decl.returnType === undefined) {
        continue;
      }
      const returnType = this.resolveReturnType(decl.returnType, decl);
      this.validateLocalFunctionLocatedType(
        decl,
        returnType,
        decl.returnType.span,
        "return type",
      );
      this.resolvedReturnTypes.set(decl.name, returnType);
    }
  }

  private inferOmittedReturnTypes(): void {
    const pending = [...this.functions.values()].filter(
      (decl) => !this.resolvedReturnTypes.has(decl.name),
    );
    let progress = true;
    while (pending.length > 0 && progress) {
      progress = false;
      for (let i = pending.length - 1; i >= 0; i--) {
        const decl = pending[i]!;
        if (!this.calleesReadyForInference(decl)) {
          continue;
        }
        if (this.inferReturnTypeFor(decl)) {
          pending.splice(i, 1);
          progress = true;
        }
      }
    }
    for (const decl of pending) {
      this.error(
        `cannot infer return type for '${decl.name}': depends on other functions with omitted return types that are not yet resolved`,
        decl.span,
        ["function-return-type-inference"],
      );
    }
  }

  private calleesReadyForInference(decl: FunctionDeclaration): boolean {
    const callees = this.collectCalleeNames(decl.body);
    for (const name of callees) {
      if (name === decl.name) {
        continue;
      }
      if (this.functions.has(name) && !this.resolvedReturnTypes.has(name)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Infers one function's omitted return type by checking its body (§function-return-type-inference).
   *
   * The body goes through the ordinary `checkBlock`, in the same scope
   * `checkFunction` would open, with `returnCandidates` set so that each
   * `return` reports its type instead of being checked against one. The typed
   * tree it produces is discarded; `checkFunction` builds the real one later,
   * once the inferred type exists to validate returns against.
   *
   * Sharing the walk is what keeps the two from drifting: a statement form
   * that binds a name, or a rule about what may appear in a body, is written
   * once and both passes see it.
   */
  private inferReturnTypeFor(decl: FunctionDeclaration): boolean {
    const { env } = this.buildParameterEnv(decl);
    const candidates: ReturnCandidate[] = [];
    this.currentFunction = decl;
    this.returnCandidates = candidates;
    this.pushEnv(env);
    this.checkBlock(decl.body, decl.context, true);
    this.popEnv();
    this.returnCandidates = undefined;
    this.currentFunction = undefined;
    this.currentFunctionReturnType = undefined;
    const inferred = inferReturnTypeFromCandidates(
      decl.body,
      functionLocationOf(decl),
      candidates,
    );
    if (!inferred.ok) {
      this.error(inferred.message, decl.span, inferred.spec);
    }
    this.validateLocalFunctionLocatedType(
      decl,
      inferred.value,
      decl.span,
      "return type",
    );
    this.resolvedReturnTypes.set(decl.name, inferred.value);
    return true;
  }

  /** Return type after resolution or inference; does not read raw AST annotations. */
  private getResolvedReturnType(decl: FunctionDeclaration): LocatedType {
    const resolved = this.resolvedReturnTypes.get(decl.name);
    if (resolved !== undefined) {
      return resolved;
    }
    if (decl.returnType !== undefined) {
      const returnType = this.resolveReturnType(decl.returnType, decl);
      this.resolvedReturnTypes.set(decl.name, returnType);
      return returnType;
    }
    this.error(
      `function '${decl.name}' has no resolved return type`,
      decl.span,
    );
  }

  private collectCalleeNames(block: Block): Set<string> {
    const names = new Set<string>();
    const visitExpr = (expr: Expression): void => {
      if (expr.kind === "CallExpression") {
        names.add(expr.callee);
      }
      for (const child of childExpressions(expr)) {
        visitExpr(child);
      }
    };
    const visitStmt = (stmt: Statement): void => {
      switch (stmt.kind) {
        case "ReturnStatement":
          if (stmt.value !== undefined) {
            visitExpr(stmt.value);
          }
          break;
        case "LetStatement":
          visitExpr(stmt.initializer);
          break;
        case "LetTransferStatement":
          visitExpr(stmt.source);
          break;
        case "AssignmentStatement":
          if (stmt.target.kind === "IndexAssignmentTarget") {
            visitExpr(stmt.target.index);
          }
          visitExpr(stmt.value);
          break;
        case "TransferStatement":
          visitExpr(stmt.source);
          break;
        case "IfStatement":
          visitExpr(stmt.condition);
          for (const s of stmt.then.statements) {
            visitStmt(s);
          }
          if (stmt.else !== undefined) {
            for (const s of stmt.else.statements) {
              visitStmt(s);
            }
          }
          break;
        case "WhileStatement":
          visitExpr(stmt.condition);
          for (const s of stmt.body.statements) {
            visitStmt(s);
          }
          break;
        case "ForStatement":
          if (stmt.init?.kind === "ForLetInit") {
            visitExpr(stmt.init.initializer);
          } else if (stmt.init?.kind === "ForAssignmentInit") {
            visitExpr(stmt.init.value);
          }
          if (stmt.condition !== undefined) {
            visitExpr(stmt.condition);
          }
          if (stmt.update !== undefined) {
            visitExpr(stmt.update.value);
          }
          for (const s of stmt.body.statements) {
            visitStmt(s);
          }
          break;
        case "ExpressionStatement":
          visitExpr(stmt.expression);
          break;
        default:
          assertNever(stmt, "statement");
      }
    };
    for (const stmt of block.statements) {
      visitStmt(stmt);
    }
    return names;
  }

  private checkTopLevelItem(item: TopLevelItem): TypedTopLevelItem {
    if (item.kind === "FunctionDeclaration") {
      return this.checkFunction(item);
    }
    return this.checkTopLevelStatement(item);
  }

  private checkTopLevelStatement(item: TopLevelStatement): TypedTopLevelStatement {
    this.currentFunction = undefined;
    this.currentFunctionReturnType = undefined;
    this.inTopLevel = true;
    const statement = this.checkStatement(item.statement, CHOREOGRAPHY_CONTEXT, false);
    this.inTopLevel = false;
    return {
      item,
      context: CHOREOGRAPHY_CONTEXT,
      statement,
    };
  }

  /**
   * The scope a function body opens in: its parameters, resolved and checked
   * (spec §function-call-typing, §parameter-types-are-not-inferred).
   *
   * Shared with return type inference, which opens the same scope over the
   * same body. Two copies of this would be two chances to disagree about
   * which parameter wins a duplicate, or whether a reserved name is caught.
   */
  private buildParameterEnv(decl: FunctionDeclaration): {
    readonly env: Map<string, LocatedType>;
    readonly params: TypedParameter[];
  } {
    const params: TypedParameter[] = [];
    const env = new Map<string, LocatedType>();
    for (const param of decl.params) {
      const type = this.resolveType(param.type);
      this.validateLocalFunctionLocatedType(
        decl,
        type,
        param.span,
        "parameter",
      );
      this.rejectNameConflict(param.name, "parameter", param.span);
      if (env.has(param.name)) {
        this.error(
          `duplicate parameter '${param.name}' in the same scope`,
          param.span,
        );
      } else {
        env.set(param.name, type);
      }
      params.push({ param, type });
    }
    return { env, params };
  }

  private checkFunction(decl: FunctionDeclaration): TypedFunctionDeclaration {
    this.currentFunction = decl;
    const returnType = this.getResolvedReturnType(decl);
    this.currentFunctionReturnType = returnType;
    const { env, params } = this.buildParameterEnv(decl);
    this.pushEnv(env);
    const body = this.checkBlock(decl.body, decl.context, true);
    this.popEnv();
    this.validateExplicitReturnCoverage(decl, returnType);
    this.currentFunction = undefined;
    this.currentFunctionReturnType = undefined;
    return {
      decl,
      context: decl.context,
      returnType,
      params,
      body,
    };
  }

  /**
   * Return coverage for a function that *declares* a non-`void` return type
   * (spec §return-typing, §missing-return-in-a-non-void-function).
   *
   * The inferred case is handled during inference (spec §return-coverage-for-non-void-functions); this is the
   * same conservative analysis applied to the explicit case, which otherwise
   * let a function fall off its end and emit BlueScript that returns nothing.
   *
   * Deliberately run after the body has been checked: the checker is fail-fast,
   * so reporting this first would hide the body's real type errors.
   */
  private validateExplicitReturnCoverage(
    decl: FunctionDeclaration,
    returnType: LocatedType,
  ): void {
    if (decl.returnType === undefined || returnType.base === "void") {
      return;
    }
    if (!checkReturnCoverage(decl.body)) {
      this.error(
        `function '${decl.name}' must return a value on all paths for return type ${formatLocatedType(returnType)}`,
        decl.span,
        ["return-typing", "missing-return-in-a-non-void-function"],
      );
    }
  }

  private checkBlock(
    block: Block,
    ctx: ExecutionContext,
    inFunction: boolean,
  ): TypedBlock {
    this.pushEnv(new Map());
    const statements: TypedStatement[] = [];
    for (const stmt of block.statements) {
      statements.push(this.checkStatement(stmt, ctx, inFunction));
    }
    this.popEnv();
    return { context: ctx, block, statements };
  }

  private checkStatement(
    stmt: Statement,
    ctx: ExecutionContext,
    inFunction: boolean,
  ): TypedStatement {
    switch (stmt.kind) {
      case "LetStatement":
        return this.checkLet(stmt, ctx);
      case "LetTransferStatement":
        return this.checkLetReceive(stmt, ctx);
      case "AssignmentStatement":
        return this.checkAssignment(stmt, ctx);
      case "TransferStatement":
        return this.checkComm(stmt, ctx);
      case "IfStatement":
        return this.checkIf(stmt, ctx, inFunction);
      case "WhileStatement":
        return this.checkWhile(stmt, ctx, inFunction);
      case "ForStatement":
        return this.checkFor(stmt, ctx, inFunction);
      case "ReturnStatement":
        return this.checkReturn(stmt, ctx, inFunction);
      case "ExpressionStatement":
        return this.checkExpressionStatement(stmt, ctx);
    }
  }

  private checkLet(
    stmt: LetStatement,
    ctx: ExecutionContext,
  ): TypedLetStatement {
    const initializer = this.checkExpression(stmt.initializer, ctx);
    if (
      stmt.type === undefined &&
      stmt.initializer.kind === "ArrayLiteralExpression" &&
      stmt.initializer.elements.length === 0
    ) {
      this.error("cannot infer empty array element type", stmt.span,
        ["cannot-infer-empty-array-element-type"]);
    }
    const choreoType =
      stmt.type !== undefined
        ? this.resolveLetType(stmt.type, initializer, stmt.span)
        : this.inferredValueType(initializer, stmt.span);
    this.requireExpressionAvailable(choreoType.location, ctx, stmt.span);
    this.defineLocal(stmt.name, choreoType, stmt.span);
    return { stmt, choreoType, initializer };
  }

  /**
   * The type an omitted annotation infers from its initializer.
   *
   * An annotated `let` reaches `resolveType`, which rejects `void` (spec §void,
   * §invalid-use-of-void). The inferred path never sees an annotation, so the same rejection
   * has to happen here — otherwise a call to a `void` function would bind a
   * variable of a type that holds no value.
   */
  private inferredValueType(
    initializer: TypedExpression,
    span: Span,
  ): LocatedType {
    this.requireValueExpression(initializer, span);
    return initializer.choreoType;
  }

  /** Rejects a void computation where a value is required (spec §located-types). */
  private requireValueExpression(expr: TypedExpression, span: Span): void {
    if (expr.choreoType.base === "void" && expr.choreoType.isArray !== true) {
      this.error(
        "expression produces no value: `void` may only be used as a function return type",
        span,
        ["located-types", "void", "invalid-use-of-void"],
      );
    }
  }

  private resolveLetType(
    ann: import("../ast/syntax-types.js").TypeAnnotation,
    initializer: TypedExpression,
    span: Span,
  ): LocatedType {
    // An initialized `let` may omit the location; it comes from the
    // initializer (spec §let-type-inference). Transfer `let` goes through `resolveType`
    // directly and keeps requiring an explicit destination (spec §transfer-let-does-not-infer-destination-type).
    const choreoType = this.resolveType(
      ann,
      initializer.choreoType.location,
    );
    this.validateLocalFunctionLocatedType(
      this.currentFunction,
      choreoType,
      span,
      "variable type",
    );
    if (choreoType.isArray) {
      if (!initializer.choreoType.isArray) {
        this.error(
          `cannot assign ${formatLocatedType(initializer.choreoType)} to ${formatLocatedType(choreoType)}`,
          span,
        );
      }
      if (initializer.expr.kind === "ArrayLiteralExpression") {
        if (initializer.expr.elements.length === 0) {
          return choreoType;
        }
        const expectedElement = locatedType(choreoType.base, choreoType.location);
        const typedArray = initializer as TypedArrayLiteralExpression;
        for (const element of typedArray.elements) {
          this.validateAssignmentLike(expectedElement, element.choreoType, element.expr.span);
        }
        return choreoType;
      }
      this.validateAssignmentLike(choreoType, initializer.choreoType, span);
      return choreoType;
    }
    this.validateAssignmentLike(choreoType, initializer.choreoType, span);
    return choreoType;
  }

  private checkLetReceive(
    stmt: LetTransferStatement,
    ctx: ExecutionContext,
  ): TypedLetTransferStatement {
    const choreoType = this.resolveType(stmt.type);
    // The destination of a transfer `let` is a variable the body declares, so
    // inside `function f@P` it must be located at `P` like any other local
    // (spec §local-function-strict-location-rule). Without this the checker would accept a send out of a
    // function body that only exists at `P`, leaving the peer with no matching
    // receive (spec §function-kinds).
    this.validateLocalFunctionLocatedType(
      this.currentFunction,
      choreoType,
      stmt.type.span,
      "variable type",
    );
    const source = this.checkExpression(stmt.source, ctx);
    const transferMode = this.validateTransfer(choreoType, source.choreoType, stmt.span);
    this.defineLocal(stmt.name, choreoType, stmt.span);
    // The tag is assigned after checking, by `assignCommTags` (spec §communication-tags).
    return { stmt, choreoType, source, transferMode };
  }

  private checkAssignment(
    stmt: AssignmentStatement,
    ctx: ExecutionContext,
  ): TypedAssignmentStatement {
    const value = this.checkExpression(stmt.value, ctx);
    return { stmt, target: this.checkAssignmentTarget(stmt.target, value, ctx, stmt.span), value };
  }

  /**
   * Checks an assignment target against the value being stored (spec §assignment-statement,
   * §assignment-typing, §array-typing). Shared by assignment statements and `for` header clauses,
   * which take the same target shapes (spec §for-statement).
   */
  private checkAssignmentTarget(
    target: AssignmentTarget,
    value: TypedExpression,
    ctx: ExecutionContext,
    span: Span,
  ): TypedAssignmentTarget {
    if (target.kind === "IdentifierAssignmentTarget") {
      const targetType = this.lookupVariable(target.name, span);
      this.validateAssignmentLike(targetType, value.choreoType, span);
      return { target, targetType };
    }
    const arrayType = this.lookupVariable(target.name, span);
    if (!arrayType.isArray) {
      this.error("index assignment target must be an array value", span);
    }
    const index = this.checkExpression(target.index, ctx);
    if (index.choreoType.base !== "integer" || index.choreoType.isArray) {
      this.error("array index must have type integer", target.index.span);
    }
    const elementType = locatedType(arrayType.base, arrayType.location);
    this.validateAssignmentLike(elementType, value.choreoType, span);
    if (!locationsEqual(index.choreoType.location, arrayType.location)) {
      this.error("array index must be at the same location as the array", span,
        ["invalid-array-index-location"]);
    }
    return { target, arrayType, index, elementType };
  }

  private checkComm(
    stmt: TransferStatement,
    ctx: ExecutionContext,
  ): TypedTransferStatement {
    const targetType = this.lookupVariable(stmt.name, stmt.span);
    const source = this.checkExpression(stmt.source, ctx);
    const transferMode = this.validateTransfer(targetType, source.choreoType, stmt.span);
    return { stmt, targetType, source, transferMode };
  }

  private checkIf(
    stmt: IfStatement,
    ctx: ExecutionContext,
    inFunction: boolean,
  ): TypedIfStatement {
    const condition = this.checkCondition(stmt.condition, ctx);
    const then = this.checkBlock(stmt.then, ctx, inFunction);
    const elseBlock = stmt.else
      ? this.checkBlock(stmt.else, ctx, inFunction)
      : undefined;
    return { stmt, condition, then, else: elseBlock };
  }

  private checkWhile(
    stmt: WhileStatement,
    ctx: ExecutionContext,
    inFunction: boolean,
  ): TypedWhileStatement {
    const condition = this.checkCondition(stmt.condition, ctx);
    const body = this.checkBlock(stmt.body, ctx, inFunction);
    return { stmt, condition, body };
  }

  private checkFor(
    stmt: ForStatement,
    ctx: ExecutionContext,
    inFunction: boolean,
  ): TypedForStatement {
    this.pushEnv(new Map());
    let init: TypedForInit | undefined;
    if (stmt.init !== undefined) {
      init = this.checkForInit(stmt.init, ctx);
    }
    const condition = this.checkCondition(stmt.condition, ctx);
    const update = stmt.update
      ? this.checkForUpdate(stmt.update, ctx)
      : undefined;
    const body = this.checkBlock(stmt.body, ctx, inFunction);
    this.popEnv();
    return { stmt, init, condition, update, body };
  }

  private checkForInit(
    init: ForInit,
    ctx: ExecutionContext,
  ): TypedForInit {
    switch (init.kind) {
      case "ForLetInit":
        return this.checkForLetInit(init, ctx);
      case "ForAssignmentInit":
        return this.checkForAssignmentInit(init, ctx);
    }
  }

  private checkForLetInit(
    init: ForLetInit,
    ctx: ExecutionContext,
  ): TypedForLetInit {
    const initializer = this.checkExpression(init.initializer, ctx);
    if (
      init.type === undefined &&
      init.initializer.kind === "ArrayLiteralExpression" &&
      init.initializer.elements.length === 0
    ) {
      this.error("cannot infer empty array element type", init.span,
        ["cannot-infer-empty-array-element-type"]);
    }
    const choreoType =
      init.type !== undefined
        ? this.resolveLetType(init.type, initializer, init.span)
        : this.inferredValueType(initializer, init.span);
    this.requireExpressionAvailable(choreoType.location, ctx, init.span);
    this.defineLocal(init.name, choreoType, init.span);
    return { init, choreoType, initializer };
  }

  private checkForAssignmentInit(
    init: ForAssignmentInit,
    ctx: ExecutionContext,
  ): TypedForAssignmentInit {
    const value = this.checkExpression(init.value, ctx);
    const target = this.checkAssignmentTarget(init.target, value, ctx, init.span);
    return { init, target, value };
  }

  private checkForUpdate(
    init: ForAssignmentInit,
    ctx: ExecutionContext,
  ): TypedForAssignmentInit {
    return this.checkForAssignmentInit(init, ctx);
  }

  private checkReturn(
    stmt: ReturnStatement,
    ctx: ExecutionContext,
    inFunction: boolean,
  ): TypedReturnStatement {
    // Inferring this function's return type: there is nothing to check the
    // `return` against yet, so record what it produces (spec §function-return-type-inference).
    if (this.returnCandidates !== undefined) {
      return this.collectReturnCandidate(stmt, ctx, this.returnCandidates);
    }
    if (
      !inFunction ||
      this.currentFunction === undefined ||
      this.currentFunctionReturnType === undefined
    ) {
      this.error("'return' outside function", stmt.span);
    }
    return this.checkReturnAgainstResolvedType(
      stmt,
      this.currentFunctionReturnType,
      ctx
    );
  }

  private collectReturnCandidate(
    stmt: ReturnStatement,
    ctx: ExecutionContext,
    out: ReturnCandidate[],
  ): TypedReturnStatement {
    if (stmt.value === undefined) {
      out.push({ kind: "void", span: stmt.span });
      return { stmt };
    }
    const value = this.typeReturnValueExpression(stmt.value, ctx);
    out.push({ kind: "value", type: value.choreoType, span: stmt.span });
    return { stmt, value };
  }

  private typeReturnValueExpression(
    expr: Expression,
    ctx: ExecutionContext,
  ): TypedExpression {
    return this.checkExpression(expr, ctx);
  }

  private checkReturnAgainstResolvedType(
    stmt: ReturnStatement,
    returnType: LocatedType,
    ctx: ExecutionContext,
  ): TypedReturnStatement {
    if (stmt.value === undefined) {
      if (returnType.base !== "void") {
        this.error(
          `expected return value of type ${formatLocatedType(returnType)}`,
          stmt.span,
        );
      }
      return { stmt };
    }
    if (returnType.base === "void") {
      this.error(
        "return with value not allowed for void return type",
        stmt.span,
        ["return-typing"],
      );
    }
    const value = this.typeReturnValueExpression(
      stmt.value,
      ctx
    );
    this.validateReturnLike(returnType, value.choreoType, stmt.span);
    return { stmt, value };
  }



  private checkExpressionStatement(
    stmt: ExpressionStatement,
    ctx: ExecutionContext,
  ): TypedExpressionStatement {
    const expression = this.checkExpression(stmt.expression, ctx);
    return { stmt, expression };
  }

  private checkCondition(
    expr: Expression,
    ctx: ExecutionContext,
  ): TypedExpression {
    const typed = this.checkExpression(expr, ctx);
    if (typed.choreoType.base !== "boolean") {
      this.error("condition must have type boolean", expr.span);
    }
    if (ctx.kind === "choreography") {
      if (typed.choreoType.location.kind !== "every") {
        this.error(
          "condition must be boolean@every in a choreography context",
          expr.span,
          ["if-condition-typing"],
        );
      }
    } else if (!locationsEqual(typed.choreoType.location, contextAsLocation(ctx))) {
      const loc =
        typed.choreoType.location.kind === "every"
          ? "every"
          : typed.choreoType.location.name;
      this.error(
        `condition must be boolean@${ctx.endpoint} in local function, got boolean@${loc}`,
        expr.span,
        ["if-condition-typing", "while-and-for-condition-typing"],
      );
    }
    return typed;
  }

  private checkExpression(
    expr: Expression,
    ctx: ExecutionContext,
  ): TypedExpression {
    switch (expr.kind) {
      case "BinaryExpression":
        return this.checkBinary(expr, ctx);
      case "UnaryExpression":
        return this.checkUnary(expr, ctx);
      case "LiteralExpression":
        return this.checkLiteral(expr, ctx);
      case "ArrayLiteralExpression":
        return this.checkArrayLiteral(expr, ctx);
      case "IdentifierExpression":
        return this.checkIdentifier(expr, ctx);
      case "CallExpression":
        return this.checkCall(expr, ctx);
      case "IndexExpression":
        return this.checkIndex(expr, ctx);
      case "LengthExpression":
        return this.checkLength(expr, ctx);
      case "PushExpression":
        return this.checkPush(expr, ctx);
      case "ParenthesizedExpression":
        return this.checkParen(expr, ctx);
    }
  }

  private checkBinary(
    expr: BinaryExpression,
    ctx: ExecutionContext,
  ): TypedBinaryExpression {
    const left = this.checkExpression(expr.left, ctx);
    const right = this.checkExpression(expr.right, ctx);
    const choreoType = this.binaryResultType(
      expr.operator,
      left.choreoType,
      right.choreoType,
      ctx,
      expr.span,
    );
    this.requireShortCircuitOperandsCallFree(expr);
    return { expr, choreoType, left, right };
  }

  /**
   * `&&` and `||` evaluate their right operand only when the left one does not
   * already decide the result (spec §evaluation-order), and that decision is made from a
   * value that lives at one location. An endpoint where the result is absent
   * has no way to learn which way the branch went, so it cannot know whether to
   * run a choreography call hidden in either operand — and a choreography
   * function runs at every endpoint (spec §function-projection). Core v0 therefore forbids
   * such a call in either operand outright (spec §choreography-call-in-a-short-circuit-operand).
   *
   * Looking for a call written directly in the operand is enough: a local
   * function cannot call a choreography one (spec §calling-choreography-from-local), so no call reachable
   * from here can communicate unless it appears in the operand itself.
   */
  private requireShortCircuitOperandsCallFree(expr: BinaryExpression): void {
    if (expr.operator !== "&&" && expr.operator !== "||") {
      return;
    }
    for (const operand of [expr.left, expr.right]) {
      const callee = this.findChoreographyCall(operand);
      if (callee !== undefined) {
        this.error(
          `operand of '${expr.operator}' must not contain a call to choreography function ` +
            `'${callee}'`,
          expr.span,
          ["operators", "choreography-call-in-a-short-circuit-operand"],
        );
      }
    }
  }

  /** Name of a choreography function called anywhere inside `expr`, if any. */
  private findChoreographyCall(expr: Expression): string | undefined {
    if (expr.kind === "CallExpression") {
      const decl = this.functions.get(expr.callee);
      if (decl !== undefined && decl.at === undefined) {
        return expr.callee;
      }
    }
    for (const child of childExpressions(expr)) {
      const found = this.findChoreographyCall(child);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  private binaryResultType(
    operator: BinaryExpression["operator"],
    left: LocatedType,
    right: LocatedType,
    ctx: ExecutionContext,
    span: Span,
  ): LocatedType {
    const arith = ["+", "-", "*", "/", "%"] as const;
    const rel = ["<", "<=", ">", ">="] as const;
    const eq = ["===", "!=="] as const;
    const log = ["&&", "||"] as const;

    if ((arith as readonly string[]).includes(operator)) {
      if (operator === "+" && left.base === "string" && right.base === "string") {
        return this.locationAwareBinary(left, right, "string", ctx, span);
      }
      if (!this.isNumeric(left) || !this.isNumeric(right)) {
        this.error(
          `operator '${operator}' requires numeric operands`,
          span,
        );
      }
      const base: LocatedType["base"] =
        left.base === "float" || right.base === "float" ? "float" : "integer";
      return this.locationAwareBinary(left, right, base, ctx, span);
    }
    if ((rel as readonly string[]).includes(operator)) {
      if (!this.isNumeric(left) || !this.isNumeric(right)) {
        this.error(`operator '${operator}' requires numeric operands`, span);
      }
      return this.locationAwareBinary(left, right, "boolean", ctx, span);
    }
    if ((eq as readonly string[]).includes(operator)) {
      if (left.isArray || right.isArray) {
        this.error("array equality is not supported", span,
          ["invalid-array-equality"]);
      }
      // `void === void` passes the same-base-type test below, so it needs its
      // own rejection: a void computation produces nothing to compare, and
      // letting it through emits BlueScript that compares two statements
      // (spec §located-types, §invalid-comparison-or-equality-operands).
      if (left.base === "void" || right.base === "void") {
        this.error(
          `operator '${operator}' requires operands that produce a value; \`void\` does not`,
          span,
          ["located-types", "invalid-comparison-or-equality-operands"],
        );
      }
      if (left.base !== right.base) {
        this.error(
          `operator '${operator}' requires operands of the same base type`,
          span,
        );
      }
      return this.locationAwareBinary(left, right, "boolean", ctx, span);
    }
    if ((log as readonly string[]).includes(operator)) {
      if (left.base !== "boolean" || right.base !== "boolean") {
        this.error(`operator '${operator}' requires boolean operands`, span);
      }
      return this.locationAwareBinary(left, right, "boolean", ctx, span);
    }
    return left;
  }

  private checkUnary(
    expr: UnaryExpression,
    ctx: ExecutionContext,
  ): TypedUnaryExpression {
    const operand = this.checkExpression(expr.operand, ctx);
    // Unary operators are scalar-only. Testing `base` alone would let a
    // `boolean[]` through `!` and an `integer[]` through `-`, since an array
    // type carries its element type in `base` (spec §operators, §invalid-unary-operand).
    if (expr.operator === "!") {
      if (operand.choreoType.isArray === true || operand.choreoType.base !== "boolean") {
        this.error(
          `operator '!' requires a boolean operand, got ${formatLocatedType(operand.choreoType)}`,
          expr.span,
          ["operators", "invalid-unary-operand"],
        );
      }
      this.requireExpressionAvailable(operand.choreoType.location, ctx, expr.span);
      return {
        expr,
        choreoType: locatedType("boolean", operand.choreoType.location),
        operand,
      };
    }
    if (operand.choreoType.isArray === true || !this.isNumeric(operand.choreoType)) {
      this.error(
        `unary '-' requires a numeric operand, got ${formatLocatedType(operand.choreoType)}`,
        expr.span,
        ["operators", "invalid-unary-operand"],
      );
    }
    this.requireExpressionAvailable(operand.choreoType.location, ctx, expr.span);
    return { expr, choreoType: operand.choreoType, operand };
  }

  private checkLiteral(
    expr: LiteralExpression,
    ctx: ExecutionContext,
  ): TypedLiteralExpression {
    const choreoType = this.resolveLiteral(expr.literal);
    this.requireExpressionAvailable(choreoType.location, ctx, expr.span);
    return { expr, choreoType, literal: expr.literal };
  }

  private checkArrayLiteral(
    expr: ArrayLiteralExpression,
    ctx: ExecutionContext,
  ): TypedArrayLiteralExpression {
    let location = expr.location?.location;
    if (location === undefined) {
      this.error(
        "array literal location annotation required",
        expr.span,
        ["array-literals", "array-literal-without-required-location"],
      );
    }
    const elements = expr.elements.map((element) =>
      this.typeArrayElementExpression(element, location, ctx),
    );
    if (elements.length === 0) {
      return { expr, choreoType: locatedType("integer", location, true), elements };
    }
    for (const element of elements) {
      this.requireValueExpression(element, element.expr.span);
    }
    let elementBase = elements[0]!.choreoType.base;
    for (let i = 1; i < elements.length; i++) {
      const next = elements[i]!.choreoType.base;
      const lub = this.lubArrayElementBase(elementBase, next, expr.span);
      elementBase = lub;
    }
    return { expr, choreoType: locatedType(elementBase, location, true), elements };
  }

  private typeArrayElementExpression(
    element: Expression,
    arrayLocation: Location,
    ctx: ExecutionContext,
  ): TypedExpression {
    if (
      element.kind === "LiteralExpression" &&
      element.literal.location === undefined
    ) {
      const base = rawLiteralBaseType(element.literal.literal);
      return {
        expr: element,
        choreoType: locatedType(base, arrayLocation),
        literal: element.literal,
      } as TypedLiteralExpression;
    }
    const typed = this.checkExpression(element, ctx);
    if (!locationsEqual(typed.choreoType.location, arrayLocation)) {
      this.error("array element must be at the same location as the array literal", element.span);
    }
    return typed;
  }

  private lubArrayElementBase(
    a: LocatedType["base"],
    b: LocatedType["base"],
    span: Span,
  ): LocatedType["base"] {
    if (a === b) {
      return a;
    }
    if ((a === "integer" && b === "float") || (a === "float" && b === "integer")) {
      return "float";
    }
    this.error("array literal has incompatible mixed element types", span);
  }

  private checkIdentifier(
    expr: IdentifierExpression,
    ctx: ExecutionContext,
  ): TypedIdentifierExpression {
    const choreoType = this.lookupVariable(expr.name, expr.span);
    this.requireExpressionAvailable(choreoType.location, ctx, expr.span);
    return { expr, choreoType };
  }

  /**
   * Reports a callee that names no function (spec §namespaces).
   *
   * Since one name is held by at most one thing, this can name what the callee
   * actually is instead of only reporting the absence of a function.
   */
  private reportNotAFunction(name: string, span: Span): never {
    const holder = this.nameHolder(name);
    if (holder !== undefined) {
      this.error(
        `'${name}' is ${describeHolder(holder)}, not a function`,
        span,
        ["namespaces"],
      );
    }
    if (this.findVariable(name) !== undefined) {
      this.error(`'${name}' is a variable, not a function`, span, ["namespaces"]);
    }
    this.error(`undefined function '${name}'`, span);
  }

  private checkCall(
    expr: CallExpression,
    ctx: ExecutionContext,
  ): TypedCallExpression {
    const decl = this.functions.get(expr.callee);
    if (decl === undefined) {
      this.reportNotAFunction(expr.callee, expr.span);
    }
    this.validateCallTarget(decl, expr.span);
    const symbol = this.functionSymbol(decl);
    const params = symbol.params;
    if (expr.args.length !== params.length) {
      this.error(
        `function '${expr.callee}' expects ${params.length} argument(s), got ${expr.args.length}`,
        expr.span,
      );
    }
    const args: TypedExpression[] = [];
    for (let i = 0; i < expr.args.length; i++) {
      const arg = this.checkExpression(expr.args[i]!, ctx);
      const param = params[i];
      if (param !== undefined) {
        this.validateCallArgument(param, arg.choreoType, expr.args[i]!.span);
      }
      args.push(arg);
    }
    this.requireExpressionAvailable(symbol.returnType.location, ctx, expr.span);
    return {
      expr,
      choreoType: symbol.returnType,
      callee: symbol,
      args,
    };
  }

  /**
   * `xs.push(v)` (spec §expressions, §array-typing).
   *
   * The result is `void`: appending produces nothing to bind, so every value
   * position rejects it exactly as it rejects a call to a `void` function
   * (spec §located-types, §invalid-use-of-void). The location carried on that `void` is the array's,
   * which is never written or shown (spec §void) but tells endpoint projection
   * where the append happens (spec §array-projection).
   */
  private checkPush(
    expr: PushExpression,
    ctx: ExecutionContext,
  ): TypedPushExpression {
    const target = this.checkExpression(expr.target, ctx);
    const value = this.checkExpression(expr.value, ctx);
    this.requireArrayReceiver(".push", target, expr.span);
    const elementType = locatedType(
      target.choreoType.base,
      target.choreoType.location,
    );
    this.validateAssignmentLike(elementType, value.choreoType, expr.span);
    return {
      expr,
      choreoType: locatedType("void", target.choreoType.location),
      target,
      value,
    };
  }

  /** `xs.length` (spec §expressions, §array-typing). */
  private checkLength(
    expr: LengthExpression,
    ctx: ExecutionContext,
  ): TypedLengthExpression {
    const target = this.checkExpression(expr.target, ctx);
    this.requireArrayReceiver(".length", target, expr.span);
    return {
      expr,
      choreoType: locatedType("integer", target.choreoType.location),
      target,
    };
  }

  /**
   * Both array operations take an array (spec §array-typing). Neither is defined on
   * a scalar — `string` included, since v0 has no string operations at all
   * (spec §typescript-javascript-features).
   */
  private requireArrayReceiver(
    member: string,
    target: TypedExpression,
    span: Span,
  ): void {
    if (target.choreoType.isArray !== true) {
      this.error(
        `'${member}' requires an array, got ${formatLocatedType(target.choreoType)}. ` +
          `The array operations are not defined on scalars, including strings`,
        span,
        ["array-typing"],
      );
    }
  }

  private checkIndex(
    expr: IndexExpression,
    ctx: ExecutionContext,
  ): TypedIndexExpression {
    const target = this.checkExpression(expr.target, ctx);
    const index = this.checkExpression(expr.index, ctx);
    if (!target.choreoType.isArray) {
      this.error("index target must have array type", expr.span);
    }
    if (index.choreoType.base !== "integer" || index.choreoType.isArray) {
      this.error("array index must have type integer", expr.index.span);
    }
    if (!locationsEqual(index.choreoType.location, target.choreoType.location)) {
      this.error("array index must be at the same location as the array", expr.span,
        ["invalid-array-index-location"]);
    }
    return {
      expr,
      choreoType: locatedType(target.choreoType.base, target.choreoType.location),
      target,
      index,
    };
  }

  private checkParen(
    expr: ParenthesizedExpression,
    ctx: ExecutionContext,
  ): TypedParenthesizedExpression {
    const expression = this.checkExpression(expr.expression, ctx);
    return {
      expr,
      choreoType: expression.choreoType,
      expression,
    };
  }

  private validateCallTarget(decl: FunctionDeclaration, span: Span): void {
    const ctx = this.currentContext();
    if (ctx === undefined) {
      return;
    }
    // A choreography context may call anything (spec §calling-local-from-choreography).
    if (ctx.kind === "choreography") {
      return;
    }
    // A local function may only call a local function at the same endpoint.
    if (decl.at === undefined) {
      this.error(
        `cannot call choreography function '${decl.name}' from local context`,
        span,
        ["function-call-typing", "calling-functions-from-a-local-context"],
      );
    }
    if (decl.at.kind !== "individual" || decl.at.name !== ctx.endpoint) {
      const at = decl.at.kind === "every" ? "every" : decl.at.name;
      this.error(
        `cannot call function '${decl.name}' at '${at}' from '${ctx.endpoint}'`,
        span,
        ["function-call-typing", "calling-functions-from-a-local-context"],
      );
    }
  }

  private validateCallArgument(
    param: LocatedType,
    arg: LocatedType,
    span: Span,
  ): void {
    if (arg.isArray && !param.isArray) {
      this.error("array argument is not assignable to non-array parameter", span);
    }
    if (!arg.isArray && param.isArray) {
      this.error("non-array argument is not assignable to array parameter", span);
    }
    if (!isArraySubtype(arg, param)) {
      this.error(
        `argument type ${formatLocatedType(arg)} is not assignable to parameter type ${formatLocatedType(param)}`,
        span,
      );
    }
    if (!locationsEqual(arg.location, param.location)) {
      this.error(
        `argument ${formatLocatedType(arg)} is not at parameter location ${formatLocatedType(param)}: use a transfer instead`,
        span,
        ["function-call-typing", "invalid-function-argument-location"],
      );
    }
  }

  private validateAssignmentLike(
    target: LocatedType,
    source: LocatedType,
    span: Span,
  ): void {
    if (!isArraySubtype(source, target)) {
      this.error(
        `cannot assign ${formatLocatedType(source)} to ${formatLocatedType(target)}`,
        span,
      );
    }
    if (!locationsEqual(source.location, target.location)) {
      this.error(
        `invalid assignment across locations: use a transfer instead`,
        span,
        ["assignment-typing", "invalid-assignment-across-locations"],
      );
    }
  }

  /** Return value vs declared/inferred return type (spec §return-typing; same rules as assignment). */
  private validateReturnLike(
    returnType: LocatedType,
    value: LocatedType,
    span: Span,
  ): void {
    if (!isArraySubtype(value, returnType)) {
      this.error(
        `return type ${formatLocatedType(value)} is not compatible with ${formatLocatedType(returnType)}`,
        span,
      );
    }
    if (!locationsEqual(value.location, returnType.location)) {
      this.error(
        `return value ${formatLocatedType(value)} is not at return type location ${formatLocatedType(returnType)}`,
        span,
        ["return-typing"],
      );
    }
  }

  private validateTransfer(
    target: LocatedType,
    source: LocatedType,
    span: Span,
  ): TransferMode {
    if (!isArraySubtype(source, target)) {
      this.error(
        `transfer type mismatch: ${formatLocatedType(source)} to ${formatLocatedType(target)}`,
        span,
        ["transfer-typing", "invalid-transfer-base-type"],
      );
    }
    const srcLoc = source.location;
    const dstLoc = target.location;

    // There is no restriction on the source/destination locations (spec §transfer-typing).
    // A transfer is a local copy exactly when every endpoint the destination
    // resides at already holds the source payload — that is, when the source is
    // `@every`, or when the two locations are the same.
    if (srcLoc.kind === "every" || locationsEqual(srcLoc, dstLoc)) {
      return "localCopy";
    }
    // The source is an individual location from here on.
    if (dstLoc.kind === "every") {
      return "broadcast";
    }
    return "direct";
  }

  private locationAwareBinary(
    left: LocatedType,
    right: LocatedType,
    base: LocatedType["base"],
    ctx: ExecutionContext,
    span: Span,
  ): LocatedType {
    const evalLoc = this.resolveBinaryEvaluationLocation(
      left.location,
      right.location,
      ctx,
      span,
    );
    if (ctx.kind === "local") {
      this.requireExpressionAvailable(left.location, ctx, span);
      this.requireExpressionAvailable(right.location, ctx, span);
    }
    return locatedType(base, evalLoc);
  }

  private resolveBinaryEvaluationLocation(
    left: Location,
    right: Location,
    ctx: ExecutionContext,
    span: Span,
  ): Location {
    if (ctx.kind === "local") {
      const here = contextAsLocation(ctx);
      if (!locationsEqual(left, here) || !locationsEqual(right, here)) {
        this.error(
          `binary operands must be located at ${ctx.endpoint} in local function`,
          span,
        );
      }
      return left;
    }
    if (locationsEqual(left, right)) {
      return left;
    }
    this.error("binary operands must be at the same location", span, ["operators"]);
  }

  private requireExpressionAvailable(
    valueLoc: Location,
    ctx: ExecutionContext,
    span: Span,
  ): void {
    if (ctx.kind !== "local") {
      return;
    }
    if (!locationsEqual(valueLoc, contextAsLocation(ctx))) {
      this.error(
        `value at ${valueLoc.kind === "every" ? "every" : valueLoc.name} is not usable in local function at ${ctx.endpoint}`,
        span,
      );
    }
  }

  private validateLocalFunctionLocatedType(
    decl: FunctionDeclaration | undefined,
    type: LocatedType,
    span: Span,
    role: "parameter" | "return type" | "variable type",
  ): void {
    if (decl === undefined || decl.context.kind !== "local") {
      return;
    }
    const endpoint = decl.context.endpoint;
    if (!locationsEqual(type.location, contextAsLocation(decl.context))) {
      this.error(
        `function '${decl.name}' ${role} must be located at ${endpoint}, got ${formatLocatedType(type)}`,
        span,
      );
    }
  }

  private isNumeric(type: LocatedType): boolean {
    return type.base === "integer" || type.base === "float";
  }

  /** Resolve a type in a value position; `void` is not a value type (spec §void). */
  private resolveType(
    ann: import("../ast/syntax-types.js").TypeAnnotation,
    inferredLocation?: Location,
  ): LocatedType {
    if (ann.base === "void" && ann.isArray !== true) {
      this.error(
        "`void` may only be used as a function return type",
        ann.span,
        ["void", "invalid-use-of-void"],
      );
    }
    return this.resolveTypeAllowingVoid(ann, inferredLocation);
  }

  /** Resolve a function return type, where `void` is allowed (spec §void). */
  private resolveReturnType(
    ann: import("../ast/syntax-types.js").TypeAnnotation,
    decl: FunctionDeclaration,
  ): LocatedType {
    // `void` carries no location; give it the function's own so that it travels
    // through the ordinary machinery. It is never shown or written.
    return this.resolveTypeAllowingVoid(
      ann,
      ann.base === "void" ? functionLocationOf(decl) : undefined,
    );
  }

  private resolveTypeAllowingVoid(
    ann: import("../ast/syntax-types.js").TypeAnnotation,
    inferredLocation?: Location,
  ): LocatedType {
    try {
      validateArrayTypeAnnotation(ann);
      const resolved = resolveTypeAnnotation(ann, inferredLocation);
      this.validateLocation(resolved.location, ann.span);
      return { ...resolved, isArray: ann.isArray === true ? true : undefined };
    } catch (e) {
      if (e instanceof TypeResolveError) {
        this.error(e.message, e.span, e.spec);
      }
      throw e;
    }
  }

  private resolveLiteral(
    lit: import("../ast/literals.js").LocatedLiteral,
  ): LocatedType {
    try {
      const resolved = resolveLiteralType(lit);
      this.validateLocation(resolved.location, lit.span);
      return resolved;
    } catch (e) {
      if (e instanceof TypeResolveError) {
        this.error(e.message, e.span, e.spec);
      }
      throw e;
    }
  }

  private validateLocation(loc: Location, span: Span): void {
    if (loc.kind === "every") {
      return;
    }
    if (!this.endpoints.has(loc.name)) {
      this.error(
        `unknown endpoint '${loc.name}'`,
        span,
        ["unknown-endpoint"],
      );
    }
  }

  /**
   * The single gate every declared name passes through (spec §namespaces).
   *
   * Endpoints, functions and variables share one value name space, because
   * generated BlueScript keeps the source name (spec §codegen-function-names) and has only one:
   * a variable emitted beside a function of the same name shadows it, and the
   * call the program meant to make would reach the variable instead.
   *
   * Endpoint names and function names are taken program-wide — endpoints
   * because they are declared in `choreobs.json` (spec §choreobs-json), functions
   * because they are global and hoisted (spec §function-names, §function-declaration-hoisting). Variables and
   * parameters are block-scoped and may still shadow each other (spec §variable-scope);
   * they may not take a name either of the other two already holds.
   */
  private rejectNameConflict(
    name: string,
    role: "function" | "variable" | "parameter",
    span: Span,
  ): void {
    const holder = this.nameHolder(name);
    if (holder === undefined) {
      return;
    }
    // A function redeclaration is reported by `collectFunctions` with its own,
    // more specific message (spec §function-names).
    if (holder === "function" && role === "function") {
      return;
    }
    const spec: SpecRefs =
      holder === "runtime"
        ? ["function-names", "codegen-function-names"]
        : ["namespaces", "err-name-already-held"];
    this.error(
      `'${name}' is ${describeHolder(holder)} and cannot be used as a ${role} name`,
      span,
      spec,
    );
  }

  /**
   * What already holds `name` in the value name space (spec §namespaces), if
   * anything.
   *
   * One name is held by at most one of these, which is what lets a use of a
   * name say what it actually is rather than only what it is not. Consulted
   * both where a name is declared ({@link rejectNameConflict}) and where one
   * is used and turns out not to be what the position needs.
   *
   * Both tables are complete before any of those questions is asked:
   * `endpoints` is fixed at construction, `functions` by `collectFunctions`,
   * which runs before any body is checked.
   */
  private nameHolder(
    name: string,
  ): "runtime" | "endpoint" | "function" | undefined {
    if (isReservedRuntimeName(name)) {
      return "runtime";
    }
    if (this.endpoints.has(name)) {
      return "endpoint";
    }
    if (this.functions.has(name)) {
      return "function";
    }
    return undefined;
  }

  private defineLocal(name: string, type: LocatedType, span: Span): void {
    this.rejectNameConflict(name, "variable", span);
    const env = this.currentEnv();
    if (env === undefined) {
      this.error(`cannot define '${name}' outside a scope`, span);
    }
    if (env.has(name)) {
      this.error(`variable '${name}' is already defined in this scope`, span,
        ["variable-scope"]);
    }
    env.set(name, type);
  }

  private lookupVariable(name: string, span: Span): LocatedType {
    const hit = this.findVariable(name);
    if (hit !== undefined) {
      return hit;
    }
    const holder = this.nameHolder(name);
    if (holder !== undefined) {
      this.error(
        `'${name}' is ${describeHolder(holder)}, not a value`,
        span,
        ["namespaces"],
      );
    }
    // Visible nowhere here, but declared at top level: a function body cannot
    // see the top-level scope (spec §top-level-let), which is worth saying outright.
    if (this.topLevelEnv.has(name)) {
      this.error(
        `'${name}' is a top-level variable and is not visible inside a function`,
        span,
        ["top-level-let"],
      );
    }
    this.error(`undefined variable '${name}'`, span);
  }

  /** Resolves a variable without reporting when there is none. */
  private findVariable(name: string): LocatedType | undefined {
    for (let i = this.envStack.length - 1; i >= 0; i--) {
      const hit = this.envStack[i]!.get(name);
      if (hit !== undefined) {
        return hit;
      }
    }
    if (this.currentFunction === undefined) {
      return this.topLevelEnv.get(name);
    }
    return undefined;
  }

  private pushEnv(env: Map<string, LocatedType>): void {
    this.envStack.push(env);
  }

  private popEnv(): void {
    this.envStack.pop();
  }

  private currentEnv(): Map<string, LocatedType> | undefined {
    if (this.envStack.length > 0) {
      return this.envStack[this.envStack.length - 1];
    }
    if (this.currentFunction === undefined) {
      return this.topLevelEnv;
    }
    return undefined;
  }

  private currentContext(): ExecutionContext | undefined {
    if (this.currentFunction !== undefined) {
      return this.currentFunction.context;
    }
    if (this.inTopLevel) {
      return CHOREOGRAPHY_CONTEXT;
    }
    return undefined;
  }

  private functionSymbol(decl: FunctionDeclaration): FunctionSymbol {
    const params = decl.params.map((p) =>
      this.resolveType(p.type),
    );
    const returnType = this.getResolvedReturnType(decl);
    return {
      name: decl.name,
      context: decl.context,
      params,
      returnType,
      decl,
    };
  }

  /** Report an error and abandon type checking (see {@link FailFast}). */
  private error(message: string, span: Span, spec: SpecRefs = []): never {
    this.errors.push(typeCheckError(message, span, spec));
    throw new FailFast();
  }
}

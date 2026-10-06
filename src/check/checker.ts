import type { Span } from "../ast/span.js";
import type { Program, TopLevelStatement } from "../ast/program.js";
import type { FunctionDeclaration, Parameter } from "../ast/declarations.js";
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
  ConversionExpression,
  LiteralExpression,
  ArrayLiteralExpression,
  IdentifierExpression,
  CallExpression,
  IndexExpression,
  LengthExpression,
  PushExpression,
  PrintExpression,
  ParenthesizedExpression,
} from "../ast/expressions.js";
import type { ExecutionContext } from "../ast/context.js";
import type { Location, LocationAnnotation } from "../ast/location.js";
import type { TypeAnnotation } from "../ast/syntax-types.js";
import type { LocatedLiteral } from "../ast/literals.js";
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
  TypedPrintExpression,
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
  TypedConversionExpression,
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
import { isNumericType } from "../ast/syntax-types.js";
import {
  DYN,
  EVERY,
  concreteLocationsAgree,
  contextAsLocation,
  formatLocatedType,
  formatLocation,
  isArraySubtype,
  joinLocations,
  locatedType,
  locationsCompatible,
  locationsEqual,
  transferModeOf,
} from "../types/located.js";
import { rawLiteralBaseType } from "./resolve.js";
import { specRef, type SpecId, type SpecRefs } from "../spec/ref.js";
import { typeCheckError, type TypeCheckError } from "./errors.js";
import { assertNever } from "../util/exhaustive.js";
import { callsIn } from "../ast/traverse.js";
import { isReservedRuntimeName } from "../runtime/names.js";
import {
  NO_IMPORTS,
  shownSourcePath,
  type ImportedBinding,
  type ImportedConstant,
  type ImportedFunction,
  type ResolvedImports,
} from "../local-imports/index.js";
import {
  checkReturnCoverage,
  inferReturnLocation,
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

/**
 * `imports` are the names the program's import declarations bind, with the
 * types their files give them (spec §imported-names); without any, a program
 * with import declarations is checked as if they bound nothing.
 */
export function typeCheck(
  program: Program,
  config: ChoreoBSConfig,
  imports: ResolvedImports = NO_IMPORTS,
): TypeCheckResult {
  const checker = new TypeChecker(program, config, imports);
  return checker.check();
}

/**
 * The item index an imported constant counts as declared at: before every
 * top-level statement, since its module is initialized before the program runs
 * (spec §imported-names, §top-level-constant-initialization-order).
 */
const IMPORTED_CONSTANT_INDEX = -1;

/** Whether two imports bind a name to the same thing (spec §imported-names). */
function sameImport(a: ImportedBinding, b: ImportedBinding): boolean {
  return a.file === b.file && a.exportedName === b.exportedName && a.endpoint === b.endpoint;
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
 * `[]@L` — the one expression with no element type of its own, which is why the
 * array type it is checked against supplies it (spec §array-literal-typing,
 * §cannot-infer-empty-array-element-type). Parentheses do not hide it.
 */
function isEmptyArrayLiteral(expr: TypedExpression["expr"]): boolean {
  if (expr.kind === "ParenthesizedExpression") {
    return isEmptyArrayLiteral(expr.expression);
  }
  return expr.kind === "ArrayLiteralExpression" && expr.elements.length === 0;
}

/**
 * `value` checked against `expected`: an empty array literal takes its element
 * type from an expected array type (spec §array-literal-typing), and anything
 * else is left as it is. The literal keeps its own location, which is checked
 * like any other.
 */
function withExpectedElementType(
  value: TypedExpression,
  expected: LocatedType,
): TypedExpression {
  if (expected.isArray !== true || !isEmptyArrayLiteral(value.expr)) {
    return value;
  }
  const choreoType = locatedType(expected.base, value.choreoType.location, true);
  if (value.expr.kind === "ParenthesizedExpression") {
    const paren = value as TypedParenthesizedExpression;
    return {
      ...paren,
      choreoType,
      expression: withExpectedElementType(paren.expression, expected),
    };
  }
  return { ...value, choreoType };
}

/**
 * A name in scope: a variable or a parameter.
 *
 * `constant` marks a variable declared with `const`, which no assignment or
 * transfer statement may store into (spec §const-statement). Parameters and
 * `let` variables are not constant.
 */
interface Variable {
  readonly type: LocatedType;
  readonly constant: boolean;
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
  /** Local functions whose bodies are BlueScript (spec §imported-names): signatures only. */
  private readonly importedFunctions = new Map<string, ImportedFunction>();
  /** Top-level constants an import declares (spec §imported-names), also in `topLevelEnv`. */
  private readonly importedConstants = new Map<string, ImportedConstant>();
  private readonly resolvedReturnTypes = new Map<string, LocatedType>();
  private readonly resolvedParameterTypes = new Map<Parameter, LocatedType>();
  /** Used to check `@L` against the declared set; the set itself is validated
   * by `validateEndpoints` before the checker runs (spec §choreobs-json). */
  private readonly endpoints: Set<string>;
  /** Whether an omission that nothing infers is `dyn` outside a local function (spec §omitted-locations, §strict-mode). */
  private readonly implicitDyn: boolean;
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
  private readonly topLevelEnv = new Map<string, Variable>();
  private envStack: Map<string, Variable>[] = [];
  /**
   * The constants top-level statements declare themselves, each with the index
   * of its item in the program (spec §top-level-let). Collected before anything
   * is checked: a function body may use one whose declaration has not been
   * checked yet, and that is an error of its own
   * (spec §top-level-constant-initialization-order) rather than an undefined name.
   */
  private readonly topLevelConstants = new Map<string, number>();
  /** The top-level constants each function's body uses by name (spec §top-level-constant-initialization-order). */
  private readonly constantUses = new Map<string, Set<string>>();
  /** The functions each function's body calls, from `checkRecursion`. */
  private readonly callGraph = new Map<string, readonly string[]>();
  /** The functions whose return types are being inferred, the first one asked for first. */
  private readonly inferring: FunctionDeclaration[] = [];
  /** The index of the top-level item being checked. */
  private topLevelIndex = -1;
  /**
   * The top-level call whose callee is being resolved. Inferring that callee's
   * return type is the only way a function body is checked before the top
   * level is done, so a top-level constant it finds undeclared is reported here.
   */
  private topLevelCall: CallExpression | undefined;

  constructor(
    private readonly program: Program,
    config: ChoreoBSConfig,
    private readonly imports: ResolvedImports,
  ) {
    this.endpoints = new Set(config.endpoints);
    this.implicitDyn = config.implicitDyn ?? true;
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

  /**
   * The top level is checked before any function body, in source order: a
   * top-level constant has its type once its declaration has been checked, and
   * function bodies may use it (spec §top-level-let). A return type that is
   * left to inference is inferred when something first needs it
   * (see `getResolvedReturnType`), which under
   * §top-level-constant-initialization-order is never before the constants
   * that function uses.
   */
  private checkProgram(): TypeCheckResult {
    this.collectImports();
    this.collectFunctions();
    this.checkRecursion();
    this.resolveExplicitFunctionSignatures();
    this.collectTopLevelConstants();
    const items: TypedTopLevelItem[] = [];
    this.program.items.forEach((item, index) => {
      if (item.kind === "TopLevelStatement") {
        items[index] = this.checkTopLevelStatement(item, index);
      }
    });
    this.program.items.forEach((item, index) => {
      if (item.kind === "FunctionDeclaration") {
        items[index] = this.checkFunction(item);
      }
    });
    this.checkInitializationOrder();
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

  /**
   * Binds the imported names (spec §imported-names), before any declaration of
   * the program is collected, so that each is checked against them. A name
   * bound again to the same thing is bound once.
   */
  private collectImports(): void {
    const bound = new Map<string, ImportedBinding>();
    for (const binding of this.imports.bindings) {
      const earlier = bound.get(binding.name);
      if (earlier !== undefined) {
        if (sameImport(earlier, binding)) {
          continue;
        }
        this.error(
          earlier.file === binding.file && earlier.exportedName === binding.exportedName
            ? `'${binding.name}' is already imported at ${earlier.endpoint}; import it at ${binding.endpoint} under another name, with 'as'`
            : `'${binding.name}' is already imported, as '${earlier.exportedName}' from ${shownSourcePath(earlier.file)} at ${earlier.endpoint}`,
          binding.span,
          ["imported-names", "conflicting-imports"],
        );
      }
      const holder = this.nameHolder(binding.name);
      if (holder !== undefined) {
        this.error(
          `'${binding.name}' is ${describeHolder(holder)} and cannot be the name of an import`,
          binding.span,
          holder === "runtime"
            ? ["imported-names", "function-names", "codegen-function-names"]
            : ["imported-names", "namespaces", "err-name-already-held"],
        );
      }
      bound.set(binding.name, binding);
      if (binding.kind === "ImportedFunction") {
        this.importedFunctions.set(binding.name, binding);
      } else {
        this.importedConstants.set(binding.name, binding);
        this.topLevelEnv.set(binding.name, { type: binding.type, constant: true });
        this.topLevelConstants.set(binding.name, IMPORTED_CONSTANT_INDEX);
      }
    }
  }

  private collectFunctions(): void {
    for (const item of this.program.items) {
      if (item.kind !== "FunctionDeclaration") {
        continue;
      }
      // `rejectNameConflict` lets a function meet a function, which the
      // duplicate check below reports, and that does not see imports.
      if (this.importedFunctions.has(item.name)) {
        this.error(
          `function '${item.name}' has the name of an imported function`,
          item.span,
          ["imported-names", "function-names"],
        );
      }
      if (this.importedConstants.has(item.name)) {
        this.error(
          `function '${item.name}' has the name of an imported constant`,
          item.span,
          ["imported-names", "namespaces", "err-name-already-held"],
        );
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
        // A declared location makes a function local, so it names one endpoint:
        // neither `every` nor `dyn` does (spec §function-kinds).
        if (item.at.kind !== "individual") {
          this.error(
            `function '${item.name}': '${formatLocation(item.at)}' is not a function location. A declared location makes a function local and must be individual.`,
            item.span,
            [
              "function-kinds",
              item.at.kind === "every"
                ? "every-on-a-function-declaration"
                : "dyn-on-a-function-declaration",
            ],
          );
        }
        this.validateLocation(item.at, item.span, CHOREOGRAPHY_CONTEXT);
      }
    }
  }

  /** Recursion rules (spec §inference-and-recursion, §recursion), over the whole call graph. */
  private checkRecursion(): void {
    const names = [...this.functions.keys()];
    for (const name of names) {
      const decl = this.functions.get(name)!;
      const callees = [...this.collectCalleeNames(decl.body)].filter((callee) =>
        this.functions.has(callee),
      );
      this.callGraph.set(name, callees);
    }
    const successors = (name: string): readonly string[] =>
      this.callGraph.get(name) ?? [];
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
      if (decl.returnType === undefined || this.hasPartialReturnType(decl)) {
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

  /**
   * Infers `decl`'s return type the first time it is needed: at a call, or
   * where its own body is checked (spec §function-return-type-inference).
   *
   * That may be in the middle of another body or of a top-level statement, so
   * where the checker stands is put aside and restored. The body is checked in
   * a scope of its own: the blocks the checker is in are not visible from it.
   *
   * `checkRecursion` has already rejected every function with an omitted
   * return type that reaches itself (spec §inference-and-recursion), so the
   * inferences in progress never include `decl`.
   */
  private inferReturnType(decl: FunctionDeclaration): LocatedType {
    if (this.inferring.includes(decl)) {
      throw new Error(
        `internal error: the return type of '${decl.name}' depends on itself ${specRef("inference-and-recursion")}`,
      );
    }
    const saved = {
      envStack: this.envStack,
      currentFunction: this.currentFunction,
      currentFunctionReturnType: this.currentFunctionReturnType,
      returnCandidates: this.returnCandidates,
      inTopLevel: this.inTopLevel,
    };
    this.envStack = [];
    this.inTopLevel = false;
    this.currentFunctionReturnType = undefined;
    this.inferring.push(decl);
    const returnType = this.inferReturnTypeFor(decl);
    this.inferring.pop();
    this.envStack = saved.envStack;
    this.currentFunction = saved.currentFunction;
    this.currentFunctionReturnType = saved.currentFunctionReturnType;
    this.returnCandidates = saved.returnCandidates;
    this.inTopLevel = saved.inTopLevel;
    return returnType;
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
  private inferReturnTypeFor(decl: FunctionDeclaration): LocatedType {
    const { env } = this.buildParameterEnv(decl);
    const candidates: ReturnCandidate[] = [];
    this.currentFunction = decl;
    this.returnCandidates = candidates;
    this.pushEnv(env);
    this.checkBlock(decl.body, decl.context, true);
    this.popEnv();
    // Returns at two different concrete locations give `dyn` exactly where an
    // omission would (spec §strict-mode, §function-return-type-inference), and are an error elsewhere.
    // A local function never gets here with two: the body was just checked to
    // hold nothing but values at its location (spec §local-function-strict-location-rule).
    const onIncompatible = this.omittedLocation(decl.context);
    let returnType: LocatedType;
    if (decl.returnType !== undefined) {
      // A partial annotation (spec §partial-return-annotations): the base is written,
      // the location comes from what the body returns. Only a choreography
      // function has one (see `hasPartialReturnType`), so with nothing returned
      // the fallback is `every`.
      const location = inferReturnLocation(candidates, EVERY, onIncompatible);
      if (!location.ok) {
        this.error(location.message, decl.span, location.spec);
      }
      returnType = this.resolveReturnType(decl.returnType, decl, location.value);
    } else {
      const inferred = inferReturnTypeFromCandidates(
        decl.body,
        contextAsLocation(decl.context),
        candidates,
        onIncompatible,
      );
      if (!inferred.ok) {
        this.error(inferred.message, decl.span, inferred.spec);
      }
      returnType = inferred.value;
    }
    this.validateLocalFunctionLocatedType(
      decl,
      returnType,
      decl.span,
      "return type",
    );
    this.resolvedReturnTypes.set(decl.name, returnType);
    return returnType;
  }

  /**
   * `function f(): integer { … }` — a return type written without its location
   * (spec §partial-return-annotations). Its location is inferred like an omitted return
   * type's, in either mode. In a local function it is the function's own
   * location instead (spec §local-function-location-inference), which the ordinary
   * resolution supplies, so there the type is resolved like a written one.
   */
  private hasPartialReturnType(decl: FunctionDeclaration): boolean {
    const ann = decl.returnType;
    return (
      ann !== undefined &&
      ann.location === undefined &&
      ann.base !== "void" &&
      decl.context.kind === "choreography"
    );
  }

  /**
   * What an omitted location that nothing infers stands for in `ctx`. In a
   * local function it is the function's own location, in either mode
   * (spec §local-function-location-inference): nothing else may stand there. Elsewhere it is `dyn`
   * unless strict mode is on (spec §omitted-locations, §strict-mode).
   */
  private omittedLocation(ctx: ExecutionContext): Location | undefined {
    if (ctx.kind === "local") {
      return contextAsLocation(ctx);
    }
    return this.implicitDyn ? DYN : undefined;
  }

  /**
   * Return type after resolution or inference; does not read raw AST annotations.
   *
   * A written return type is resolved, unless it leaves its location to the
   * body (see `hasPartialReturnType`); resolving that one here would quietly
   * make it `dyn`. Every other return type is inferred, once, here.
   */
  private getResolvedReturnType(decl: FunctionDeclaration): LocatedType {
    const resolved = this.resolvedReturnTypes.get(decl.name);
    if (resolved !== undefined) {
      return resolved;
    }
    if (decl.returnType !== undefined && !this.hasPartialReturnType(decl)) {
      const returnType = this.resolveReturnType(decl.returnType, decl);
      this.resolvedReturnTypes.set(decl.name, returnType);
      return returnType;
    }
    return this.inferReturnType(decl);
  }

  /**
   * The functions `block` calls, anywhere in it (spec §inference-and-recursion).
   *
   * Every expression a statement evaluates counts, including those in a `for`
   * header (see `callsIn`): a call missed here is a recursion that goes
   * unreported, or a constant used before it is initialized
   * (spec §top-level-constant-initialization-order).
   */
  private collectCalleeNames(block: Block): Set<string> {
    return new Set(callsIn(block.statements).map((call) => call.callee));
  }

  /** See {@link topLevelConstants}. A second declaration of a name is rejected where it is checked. */
  private collectTopLevelConstants(): void {
    this.program.items.forEach((item, index) => {
      if (item.kind !== "TopLevelStatement") {
        return;
      }
      const stmt = item.statement;
      if (
        (stmt.kind === "LetStatement" || stmt.kind === "LetTransferStatement") &&
        stmt.keyword === "const" &&
        !this.topLevelConstants.has(stmt.name)
      ) {
        this.topLevelConstants.set(stmt.name, index);
      }
    });
  }

  /**
   * §top-level-constant-initialization-order: no top-level statement calls a
   * function that reaches a top-level constant declared by that statement or a
   * later one.
   *
   * Run once every body has been checked, since only then is it known which
   * constants each one uses. A callee whose return type had to be inferred for
   * the statement was caught earlier, by `useTopLevelConstant`; this catches
   * the rest, whose bodies the top level never needed.
   */
  private checkInitializationOrder(): void {
    if (this.constantUses.size === 0) {
      return;
    }
    this.program.items.forEach((item, index) => {
      if (item.kind !== "TopLevelStatement") {
        return;
      }
      for (const call of callsIn([item.statement])) {
        const reached = this.reachedConstant(
          call.callee,
          (constant) => this.topLevelConstants.get(constant)! >= index,
        );
        if (reached !== undefined) {
          this.reportConstantUsedBeforeInitialization(call, index, reached.path, reached.constant);
        }
      }
    });
  }

  /**
   * A top-level constant matching `wanted` that `start` reaches: one its body
   * uses, or one a function it calls reaches (spec §top-level-constant-initialization-order).
   * `path` runs from `start` to the function that uses it, by fewest calls.
   */
  private reachedConstant(
    start: string,
    wanted: (constant: string) => boolean,
  ): { readonly path: readonly string[]; readonly constant: string } | undefined {
    const paths = new Map<string, readonly string[]>([[start, [start]]]);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
      const name = queue[i]!;
      const path = paths.get(name)!;
      for (const constant of this.constantUses.get(name) ?? []) {
        if (wanted(constant)) {
          return { path, constant };
        }
      }
      for (const callee of this.callGraph.get(name) ?? []) {
        if (!paths.has(callee)) {
          paths.set(callee, [...path, callee]);
          queue.push(callee);
        }
      }
    }
    return undefined;
  }

  /**
   * A call that would run a function before a top-level constant it reaches is
   * initialized (spec §top-level-constant-initialization-order). `path` runs
   * from the callee to the function that uses the constant.
   */
  private reportConstantUsedBeforeInitialization(
    call: CallExpression,
    statementIndex: number,
    path: readonly string[],
    constant: string,
  ): never {
    const through = path.length > 1 ? ` through '${path.slice(1).join("', '")}'` : "";
    const declared =
      this.topLevelConstants.get(constant) === statementIndex
        ? "which this statement declares"
        : "which is declared later";
    this.error(
      `'${path[0]}' cannot be called here: it uses the top-level constant '${constant}'${through}, ${declared}`,
      call.span,
      ["top-level-constant-initialization-order", "constant-used-before-initialization"],
    );
  }

  private checkTopLevelStatement(item: TopLevelStatement, index: number): TypedTopLevelStatement {
    this.currentFunction = undefined;
    this.currentFunctionReturnType = undefined;
    this.inTopLevel = true;
    this.topLevelIndex = index;
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
    readonly env: Map<string, Variable>;
    readonly params: TypedParameter[];
  } {
    const params: TypedParameter[] = [];
    const env = new Map<string, Variable>();
    for (const param of decl.params) {
      const type = this.resolveParameterType(decl, param);
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
        env.set(param.name, { type, constant: false });
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
    return { stmt, ...this.checkLetBinding(stmt, ctx) };
  }

  /**
   * The local an initialized `let` introduces (spec §let-statement).
   *
   * A `for` initializer declares one the same way (spec §for-statement,
   * §for-initializer-let-type-inference), so both go through here.
   */
  private checkLetBinding(
    binding: LetStatement | ForLetInit,
    ctx: ExecutionContext,
  ): { readonly choreoType: LocatedType; readonly initializer: TypedExpression } {
    const initializer = this.checkExpression(binding.initializer, ctx);
    if (binding.type === undefined) {
      this.rejectEmptyArrayLiteral(binding.initializer, binding.span);
    }
    const resolved =
      binding.type !== undefined
        ? this.resolveLetType(binding.type, initializer, binding.span, ctx)
        : { choreoType: this.inferredValueType(initializer, binding.span), initializer };
    const choreoType = resolved.choreoType;
    this.requireExpressionAvailable(choreoType.location, ctx, binding.span);
    // A `for` header declares with `let` only (spec §for-statement).
    const constant = binding.kind === "LetStatement" && binding.keyword === "const";
    this.defineLocal(binding.name, choreoType, binding.span, constant);
    return resolved;
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

  /**
   * Rejects `[]` where no array type is expected of it, so that nothing would
   * supply its element type (spec §array-literal-typing, §cannot-infer-empty-array-element-type).
   */
  private rejectEmptyArrayLiteral(expr: Expression, span: Span): void {
    if (isEmptyArrayLiteral(expr)) {
      this.error("cannot infer empty array element type", span,
        ["cannot-infer-empty-array-element-type"]);
    }
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
    ann: TypeAnnotation,
    initializer: TypedExpression,
    span: Span,
    ctx: ExecutionContext,
  ): { readonly choreoType: LocatedType; readonly initializer: TypedExpression } {
    // An initialized `let` may omit the location; it comes from the
    // initializer (spec §let-type-inference). Transfer `let` goes through `resolveType`
    // directly, so its destination never takes the source's location
    // (spec §transfer-let-does-not-infer-destination-type).
    const choreoType = this.resolveType(
      ann,
      ctx,
      initializer.choreoType.location,
    );
    this.validateLocalFunctionLocatedType(
      this.currentFunction,
      choreoType,
      span,
      "variable type",
    );
    // An empty array literal is the one initializer with no element type of
    // its own, so the annotation supplies it (spec §array-literal-typing).
    // Every other initializer, array literal or not, infers its own type and is
    // checked against the annotation below (spec §array-invariance):
    // `let xs: float[]@alice = [1, 2]@alice;` is a type error, because the
    // literal is `integer[]`.
    const typed = withExpectedElementType(initializer, choreoType);
    this.validateAssignmentLike(choreoType, typed.choreoType, span);
    return { choreoType, initializer: typed };
  }

  private checkLetReceive(
    stmt: LetTransferStatement,
    ctx: ExecutionContext,
  ): TypedLetTransferStatement {
    // An omitted destination is `dyn` (spec §omitted-locations), or the
    // function's own location in a local function (spec §local-function-location-inference);
    // it is never taken from the source (spec §transfer-let-does-not-infer-destination-type).
    const choreoType = this.resolveType(stmt.type, ctx, undefined, [
      "transfer-let-does-not-infer-destination-type",
    ]);
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
    // The destination's type is written, so it supplies the element type of
    // a `[]` source (spec §array-literal-typing).
    const source = withExpectedElementType(this.checkExpression(stmt.source, ctx), choreoType);
    const transferMode = this.validateTransfer(choreoType, source.choreoType, stmt.span);
    this.defineLocal(stmt.name, choreoType, stmt.span, stmt.keyword === "const");
    // The tag is assigned after checking, by `assignCommTags` (spec §communication-tags).
    return { stmt, choreoType, source, transferMode };
  }

  private checkAssignment(
    stmt: AssignmentStatement,
    ctx: ExecutionContext,
  ): TypedAssignmentStatement {
    const value = this.checkExpression(stmt.value, ctx);
    return { stmt, ...this.checkAssignmentTarget(stmt.target, value, ctx, stmt.span) };
  }

  /**
   * Checks an assignment target against the value being stored (spec §assignment-statement,
   * §assignment-typing, §array-typing). Shared by assignment statements and `for` header clauses,
   * which take the same target shapes (spec §for-statement).
   *
   * Returns the value as checked against the target: a `[]` stored in an
   * array variable takes its element type from it (spec §array-literal-typing).
   */
  private checkAssignmentTarget(
    target: AssignmentTarget,
    value: TypedExpression,
    ctx: ExecutionContext,
    span: Span,
  ): { readonly target: TypedAssignmentTarget; readonly value: TypedExpression } {
    if (target.kind === "IdentifierAssignmentTarget") {
      const targetType = this.lookupStoreTarget(target.name, span);
      const stored = withExpectedElementType(value, targetType);
      this.validateAssignmentLike(targetType, stored.choreoType, span);
      return { target: { target, targetType }, value: stored };
    }
    // An element target may be a `const` array: the array changes, not the
    // variable (spec §const-statement).
    const arrayType = this.lookupVariable(target.name, span).type;
    if (!arrayType.isArray) {
      this.error("index assignment target must be an array value", span);
    }
    const index = this.checkExpression(target.index, ctx);
    this.requireIntegerIndex(index, target.index.span);
    const elementType = locatedType(arrayType.base, arrayType.location);
    this.validateAssignmentLike(elementType, value.choreoType, span);
    this.requireIndexLocation(index, arrayType.location, span);
    // Pairwise `~` is not enough to say they are all compatible:
    // `arrDyn[iAlice] = valBob` passes both checks above (spec §location-consistency-and-join).
    if (
      !concreteLocationsAgree([
        arrayType.location,
        index.choreoType.location,
        value.choreoType.location,
      ])
    ) {
      this.error(
        "the array, index and value of an element assignment must not be at different locations",
        span,
        ["array-typing", "element-assignment-across-locations"],
      );
    }
    const location = joinLocations(
      joinLocations(arrayType.location, index.choreoType.location),
      value.choreoType.location,
    );
    return { target: { target, arrayType, index, location }, value };
  }

  private checkComm(
    stmt: TransferStatement,
    ctx: ExecutionContext,
  ): TypedTransferStatement {
    const targetType = this.lookupStoreTarget(stmt.name, stmt.span);
    const source = withExpectedElementType(this.checkExpression(stmt.source, ctx), targetType);
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
    return { init, ...this.checkLetBinding(init, ctx) };
  }

  private checkForAssignmentInit(
    init: ForAssignmentInit,
    ctx: ExecutionContext,
  ): TypedForAssignmentInit {
    const value = this.checkExpression(init.value, ctx);
    return { init, ...this.checkAssignmentTarget(init.target, value, ctx, init.span) };
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
    // With the return type omitted altogether, nothing supplies a `[]`'s
    // element type. A partial annotation writes the base, and the real pass
    // checks against it (spec §partial-return-annotations).
    if (this.currentFunction?.returnType === undefined) {
      this.rejectEmptyArrayLiteral(stmt.value, stmt.span);
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
    const value = withExpectedElementType(
      this.typeReturnValueExpression(stmt.value, ctx),
      returnType,
    );
    this.validateReturnLike(returnType, value.choreoType, stmt.span);
    return { stmt, value };
  }



  private checkExpressionStatement(
    stmt: ExpressionStatement,
    ctx: ExecutionContext,
  ): TypedExpressionStatement {
    const expression = this.checkExpression(stmt.expression, ctx);
    this.rejectEmptyArrayLiteral(stmt.expression, stmt.span);
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
      // A `dyn` condition is cast to `every` (spec §if-condition-typing).
      if (!locationsCompatible(typed.choreoType.location, contextAsLocation(ctx))) {
        this.error(
          "condition must be boolean@every in a choreography context",
          expr.span,
          ["if-condition-typing"],
        );
      }
    } else if (!locationsEqual(typed.choreoType.location, contextAsLocation(ctx))) {
      this.error(
        `condition must be boolean@${ctx.endpoint} in local function, got boolean@${formatLocation(typed.choreoType.location)}`,
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
      case "ConversionExpression":
        return this.checkConversion(expr, ctx);
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
      case "PrintExpression":
        return this.checkPrint(expr, ctx);
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
    return { expr, choreoType, left, right };
  }

  /**
   * Every operator requires scalar operands (spec §operators). An array type carries its
   * element type in `base`, so a test on `base` alone would let `integer[]`
   * through `+` and `boolean[]` through `&&` — hence the `Scalar` helpers.
   */
  private binaryResultType(
    operator: BinaryExpression["operator"],
    left: LocatedType,
    right: LocatedType,
    ctx: ExecutionContext,
    span: Span,
  ): LocatedType {
    const operands = `${formatLocatedType(left)} and ${formatLocatedType(right)}`;
    switch (operator) {
      case "+":
      case "-":
      case "*":
      case "/":
      case "%": {
        if (
          operator === "+" &&
          this.isScalarOf(left, "string") &&
          this.isScalarOf(right, "string")
        ) {
          return this.locationAwareBinary(left, right, "string", ctx, span);
        }
        const base = this.requireSameNumericOperands(
          operator, left, right, span, "invalid-arithmetic-or-logical-operand");
        return this.locationAwareBinary(left, right, base, ctx, span);
      }
      case "<":
      case "<=":
      case ">":
      case ">=":
        this.requireSameNumericOperands(
          operator, left, right, span, "invalid-comparison-or-equality-operands");
        return this.locationAwareBinary(left, right, "boolean", ctx, span);
      case "===":
      case "!==":
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
            `operator '${operator}' requires operands of the same base type, got ${operands}`,
            span,
            ["operators", "invalid-comparison-or-equality-operands"],
          );
        }
        return this.locationAwareBinary(left, right, "boolean", ctx, span);
      case "&&":
      case "||":
        if (!this.isScalarOf(left, "boolean") || !this.isScalarOf(right, "boolean")) {
          this.error(
            `operator '${operator}' requires boolean operands, got ${operands}`,
            span,
            ["operators", "invalid-arithmetic-or-logical-operand"],
          );
        }
        return this.locationAwareBinary(left, right, "boolean", ctx, span);
      default:
        return assertNever(operator, "binary operator");
    }
  }

  private checkUnary(
    expr: UnaryExpression,
    ctx: ExecutionContext,
  ): TypedUnaryExpression {
    const operand = this.checkExpression(expr.operand, ctx);
    // Scalar-only, like the binary operators (spec §operators, §invalid-unary-operand).
    if (expr.operator === "!") {
      if (!this.isScalarOf(operand.choreoType, "boolean")) {
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
    if (!this.isNumericScalar(operand.choreoType)) {
      this.error(
        `unary '-' requires a numeric operand, got ${formatLocatedType(operand.choreoType)}`,
        expr.span,
        ["operators", "invalid-unary-operand"],
      );
    }
    this.requireExpressionAvailable(operand.choreoType.location, ctx, expr.span);
    return { expr, choreoType: operand.choreoType, operand };
  }

  /**
   * `e as T` (spec §numeric-conversion): a numeric scalar of either type becomes
   * a `T`, `T` included. Only the base type changes; like a unary operator, the
   * result stays where the operand is.
   */
  private checkConversion(
    expr: ConversionExpression,
    ctx: ExecutionContext,
  ): TypedConversionExpression {
    const operand = this.checkExpression(expr.operand, ctx);
    if (!this.isNumericScalar(operand.choreoType)) {
      this.error(
        `'as ${expr.target}' requires an integer or float operand, got ${formatLocatedType(operand.choreoType)}`,
        expr.span,
        ["numeric-conversion", "invalid-numeric-conversion"],
      );
    }
    this.requireExpressionAvailable(operand.choreoType.location, ctx, expr.span);
    return {
      expr,
      choreoType: locatedType(expr.target, operand.choreoType.location),
      operand,
    };
  }

  private checkLiteral(
    expr: LiteralExpression,
    ctx: ExecutionContext,
    inferredLocation?: Location,
  ): TypedLiteralExpression {
    const choreoType = this.resolveLiteral(expr.literal, ctx, inferredLocation);
    this.requireExpressionAvailable(choreoType.location, ctx, expr.span);
    return { expr, choreoType, literal: expr.literal };
  }

  private checkArrayLiteral(
    expr: ArrayLiteralExpression,
    ctx: ExecutionContext,
  ): TypedArrayLiteralExpression {
    // An unannotated array literal is `dyn`, or the function's own location in
    // a local function; its elements are never looked at for a location
    // (spec §array-literals, §local-function-location-inference).
    const location = this.resolveLocation(
      expr.location,
      undefined,
      ctx,
      expr.span,
      expr.location?.span ?? expr.span,
      {
        message: "array literal location annotation required",
        spec: ["array-literals", "array-literal-without-required-location"],
      },
    );
    this.requireExpressionAvailable(location, ctx, expr.span);
    const elements = expr.elements.map((element) =>
      this.typeArrayElementExpression(element, location, ctx),
    );
    if (elements.length === 0) {
      return { expr, choreoType: locatedType("integer", location, true), elements };
    }
    // Each element is `~` the array; they must also be `~` one another
    // (spec §location-consistency-and-join, §array-literals): `[1@alice, 2@bob]@dyn` is rejected.
    if (
      !concreteLocationsAgree([
        location,
        ...elements.map((element) => element.choreoType.location),
      ])
    ) {
      this.error(
        "array literal elements must not be at different locations",
        expr.span,
        ["array-literals", "array-literal-elements-across-locations"],
      );
    }
    for (const element of elements) {
      this.requireValueExpression(element, element.expr.span);
    }
    // Every element must have the same base type: `integer` and `float` are
    // unrelated, so they have no LUB (spec §array-literal-typing).
    const elementBase = elements[0]!.choreoType.base;
    if (elements.some((element) => element.choreoType.base !== elementBase)) {
      this.error("array literal has incompatible mixed element types", expr.span,
        ["array-typing"]);
    }
    return { expr, choreoType: locatedType(elementBase, location, true), elements };
  }

  private typeArrayElementExpression(
    element: Expression,
    arrayLocation: Location,
    ctx: ExecutionContext,
  ): TypedExpression {
    // An unlocated literal element takes the array's own location
    // (spec §array-literals).
    if (element.kind === "LiteralExpression" && element.literal.location === undefined) {
      return this.checkLiteral(element, ctx, arrayLocation);
    }
    const typed = this.checkExpression(element, ctx);
    if (!locationsCompatible(typed.choreoType.location, arrayLocation)) {
      this.error("array element must be at the same location as the array literal", element.span);
    }
    return typed;
  }

  private checkIdentifier(
    expr: IdentifierExpression,
    ctx: ExecutionContext,
  ): TypedIdentifierExpression {
    const choreoType = this.lookupVariable(expr.name, expr.span).type;
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
    const symbol = this.calleeSymbol(expr);
    const params = symbol.params;
    if (expr.args.length !== params.length) {
      this.error(
        `function '${expr.callee}' expects ${params.length} argument(s), got ${expr.args.length}`,
        expr.span,
      );
    }
    const args: TypedExpression[] = [];
    for (let i = 0; i < expr.args.length; i++) {
      const param = params[i];
      let arg = this.checkExpression(expr.args[i]!, ctx);
      if (param !== undefined) {
        arg = withExpectedElementType(arg, param);
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
   * The function `expr` calls, checked as a callee from where the call is.
   * An imported function has its signature already (spec §imported-names);
   * resolving a declared one may infer its return type, and so check its body,
   * before the top level is done (see `topLevelCall`).
   */
  private calleeSymbol(expr: CallExpression): FunctionSymbol {
    const imported = this.importedFunctions.get(expr.callee);
    if (imported !== undefined) {
      this.validateCallTarget(imported, expr.span);
      return {
        name: imported.name,
        context: imported.context,
        params: imported.params,
        returnType: imported.returnType,
      };
    }
    const decl = this.functions.get(expr.callee);
    if (decl === undefined) {
      this.reportNotAFunction(expr.callee, expr.span);
    }
    this.validateCallTarget(decl, expr.span);
    const atTopLevel = this.currentFunction === undefined;
    if (atTopLevel) {
      this.topLevelCall = expr;
    }
    const symbol = this.functionSymbol(decl);
    if (atTopLevel) {
      this.topLevelCall = undefined;
    }
    return symbol;
  }

  /**
   * `xs.push(v)` (spec §expressions, §array-typing).
   *
   * The result is `void`: appending produces nothing to bind, so every value
   * position rejects it exactly as it rejects a call to a `void` function
   * (spec §located-types, §invalid-use-of-void). The location carried on that `void` is the join
   * of the array's and the value's, which is never written or shown (spec §void)
   * but tells endpoint projection where the append happens (spec §array-projection).
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
    // When either side is `dyn`, the append is a dynamic operation performed at
    // every endpoint (spec §dyn-array-projection); the location says so.
    return {
      expr,
      choreoType: locatedType(
        "void",
        joinLocations(target.choreoType.location, value.choreoType.location),
      ),
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
   * `print(e)` (spec §expressions, §print-typing).
   *
   * Any value may be printed, at any location; the print happens where the
   * value is. The result is `void`, like a push's, and carries the value's
   * location, which is never written or shown (spec §void) but tells endpoint
   * projection which endpoints print (spec §print-projection).
   *
   * It is not a call, so a local context may use it (spec §call-in-a-local-context): in
   * a local function the argument's own checks already keep it at the
   * function's location.
   */
  private checkPrint(
    expr: PrintExpression,
    ctx: ExecutionContext,
  ): TypedPrintExpression {
    const value = this.checkExpression(expr.value, ctx);
    this.rejectEmptyArrayLiteral(expr.value, expr.span);
    this.requireValueExpression(value, expr.span);
    return {
      expr,
      choreoType: locatedType("void", value.choreoType.location),
      value,
    };
  }

  /**
   * Both array operations take an array (spec §array-typing). Neither is defined on
   * a scalar — `string` included, since v1 has no string operations at all
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
    this.rejectEmptyArrayLiteral(expr.target, expr.span);
    const index = this.checkExpression(expr.index, ctx);
    if (!target.choreoType.isArray) {
      this.error("index target must have array type", expr.span);
    }
    this.requireIntegerIndex(index, expr.index.span);
    this.requireIndexLocation(index, target.choreoType.location, expr.span);
    return {
      expr,
      choreoType: locatedType(
        target.choreoType.base,
        joinLocations(target.choreoType.location, index.choreoType.location),
      ),
      target,
      index,
    };
  }

  /** An index is an `integer` scalar (spec §index-access, §array-element-assignment). */
  private requireIntegerIndex(index: TypedExpression, span: Span): void {
    if (index.choreoType.base !== "integer" || index.choreoType.isArray) {
      this.error("array index must have type integer", span);
    }
  }

  /** An index is `~` its array (spec §invalid-array-index-location). */
  private requireIndexLocation(index: TypedExpression, array: Location, span: Span): void {
    if (!locationsCompatible(index.choreoType.location, array)) {
      this.error("array index must be at the same location as the array", span,
        ["invalid-array-index-location"]);
    }
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

  private validateCallTarget(
    decl: { readonly name: string; readonly context: ExecutionContext },
    span: Span,
  ): void {
    const ctx = this.currentContext();
    if (ctx === undefined) {
      return;
    }
    // A choreography context may call anything (spec §calling-local-from-choreography).
    if (ctx.kind === "choreography") {
      return;
    }
    // A local function may only call a local function at the same endpoint.
    // A declaration's location has been checked to be individual, so its
    // context names it (spec §function-kinds), as an import's does.
    if (decl.context.kind === "choreography") {
      this.error(
        `cannot call choreography function '${decl.name}' from local context`,
        span,
        ["function-call-typing", "calling-functions-from-a-local-context"],
      );
    }
    if (decl.context.endpoint !== ctx.endpoint) {
      this.error(
        `cannot call function '${decl.name}' at '${decl.context.endpoint}' from '${ctx.endpoint}'`,
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
    if (!locationsCompatible(arg.location, param.location)) {
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
        source.isArray === true && target.isArray === true
          ? ["array-typing", "array-type-invariance"]
          : ["type-mismatch"],
      );
    }
    if (!locationsCompatible(source.location, target.location)) {
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
    if (!locationsCompatible(value.location, returnType.location)) {
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
    // There is no restriction on the source/destination locations (spec §transfer-typing).
    return transferModeOf(source.location, target.location);
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
    // `L1 ~ L2`, located at `L1 ⊔ L2` (spec §location-consistency-and-join).
    if (locationsCompatible(left, right)) {
      return joinLocations(left, right);
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
        `value at ${formatLocation(valueLoc)} is not usable in local function at ${ctx.endpoint}`,
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

  /**
   * Operand rule shared by the arithmetic and relational operators (spec §operators):
   * numeric scalars of the same type. `integer` and `float` are unrelated
   * (spec §subtyping), so nothing is promoted. Returns that shared type.
   */
  private requireSameNumericOperands(
    operator: BinaryExpression["operator"],
    left: LocatedType,
    right: LocatedType,
    span: Span,
    rule: SpecId,
  ): LocatedType["base"] {
    const operands = `${formatLocatedType(left)} and ${formatLocatedType(right)}`;
    if (!this.isNumericScalar(left) || !this.isNumericScalar(right)) {
      this.error(
        `operator '${operator}' requires numeric operands, got ${operands}`,
        span,
        ["operators", rule],
      );
    }
    if (left.base !== right.base) {
      this.error(
        `operator '${operator}' requires operands of the same numeric type, got ${operands}`,
        span,
        ["operators", rule],
      );
    }
    return left.base;
  }

  private isNumericScalar(type: LocatedType): boolean {
    return type.isArray !== true && isNumericType(type.base);
  }

  private isScalarOf(type: LocatedType, base: LocatedType["base"]): boolean {
    return type.isArray !== true && type.base === base;
  }

  /**
   * Resolve a type in a value position; `void` is not a value type (spec §void).
   *
   * `ctx` is where the type is written, and decides what an omitted location
   * means there (see {@link omittedLocation}). `omissionSpec` names the rule an
   * omission breaks when that is more specific than the general one.
   */
  private resolveType(
    ann: TypeAnnotation,
    ctx: ExecutionContext,
    inferredLocation?: Location,
    omissionSpec: SpecRefs = [],
  ): LocatedType {
    if (ann.base === "void" && ann.isArray !== true) {
      this.error(
        "`void` may only be used as a function return type",
        ann.span,
        ["void", "invalid-use-of-void"],
      );
    }
    return this.resolveValueType(ann, ctx, inferredLocation, omissionSpec);
  }

  /**
   * A parameter's type. `buildParameterEnv` and `functionSymbol` both ask for
   * it; it is resolved once, so the two cannot disagree — an omitted location
   * is `dyn` in a choreography function (spec §omitted-locations), and the
   * function's own in a local one (spec §local-function-location-inference).
   */
  private resolveParameterType(
    decl: FunctionDeclaration,
    param: Parameter,
  ): LocatedType {
    let resolved = this.resolvedParameterTypes.get(param);
    if (resolved === undefined) {
      resolved = this.resolveType(param.type, decl.context);
      this.resolvedParameterTypes.set(param, resolved);
    }
    return resolved;
  }

  /**
   * Resolve a function return type, where `void` is allowed (spec §void).
   * `inferredLocation` completes a partial annotation (spec §partial-return-annotations).
   */
  private resolveReturnType(
    ann: TypeAnnotation,
    decl: FunctionDeclaration,
    inferredLocation?: Location,
  ): LocatedType {
    if (ann.base === "void" && ann.isArray !== true) {
      if (ann.location !== undefined) {
        this.error("`void` has no location", ann.span, ["void", "invalid-use-of-void"]);
      }
      // `void` carries no location; give it the function's own so that it
      // travels through the ordinary machinery. It is never shown or written.
      return locatedType("void", contextAsLocation(decl.context), undefined);
    }
    return this.resolveValueType(ann, decl.context, inferredLocation);
  }

  /** A written type of a value: its base, and its location (see {@link resolveLocation}). */
  private resolveValueType(
    ann: TypeAnnotation,
    ctx: ExecutionContext,
    inferredLocation: Location | undefined,
    omissionSpec: SpecRefs = [],
  ): LocatedType {
    if (
      ann.isArray === true &&
      ann.base !== "integer" &&
      ann.base !== "float" &&
      ann.base !== "boolean"
    ) {
      this.error(
        `unsupported array element type '${ann.base}'`,
        ann.span,
        ["unsupported-array-element-type"],
      );
    }
    const location = this.resolveLocation(ann.location, inferredLocation, ctx, ann.span, ann.span, {
      message: "location annotation required on type",
      spec: [...omissionSpec, "explicit-location-annotations", "location-annotation-omission"],
    });
    return locatedType(ann.base, location, ann.isArray === true ? true : undefined);
  }

  /**
   * A literal's type; `inferredLocation` is the location of the array literal
   * it is a direct element of (spec §array-literals).
   */
  private resolveLiteral(
    lit: LocatedLiteral,
    ctx: ExecutionContext,
    inferredLocation?: Location,
  ): LocatedType {
    const location = this.resolveLocation(lit.location, inferredLocation, ctx, lit.span, lit.span, {
      message: "location annotation required on literal",
      spec: ["explicit-location-annotations", "location-annotation-omission"],
    });
    return locatedType(rawLiteralBaseType(lit.literal), location);
  }

  /**
   * The location of a type, a literal or an array literal
   * (spec §explicit-location-annotations): the written one, else `inferred` from the
   * declaration itself, else what an omission means here (see
   * {@link omittedLocation}): the function's own location in a local function,
   * elsewhere `dyn`, or an error in strict mode. The error is `omission`, at `omissionSpan`;
   * whatever the location is, it is then checked at `validateSpan`.
   */
  private resolveLocation(
    written: LocationAnnotation | undefined,
    inferred: Location | undefined,
    ctx: ExecutionContext,
    omissionSpan: Span,
    validateSpan: Span,
    omission: { readonly message: string; readonly spec: SpecRefs },
  ): Location {
    const location = written?.location ?? inferred ?? this.omittedLocation(ctx);
    if (location === undefined) {
      this.error(omission.message, omissionSpan, omission.spec);
    }
    this.validateLocation(location, validateSpan, ctx);
    return location;
  }

  /**
   * A written location must name a declared endpoint, and `dyn` has no place
   * in a local function (spec §local-function-strict-location-rule): its body runs at one
   * endpoint only, so nothing there could be decided at run time in step with
   * the others.
   */
  private validateLocation(loc: Location, span: Span, ctx: ExecutionContext): void {
    switch (loc.kind) {
      case "every":
        return;
      case "dyn":
        if (ctx.kind === "local") {
          this.error(
            `'dyn' cannot be used in a local function: every location in a function at ${ctx.endpoint} must be ${ctx.endpoint}`,
            span,
            ["local-function-strict-location-rule", "dyn-in-a-local-function"],
          );
        }
        return;
      case "individual":
        if (!this.endpoints.has(loc.name)) {
          this.error(
            `unknown endpoint '${loc.name}'`,
            span,
            ["unknown-endpoint"],
          );
        }
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
   * The tables are complete before any of those questions is asked:
   * `endpoints` is fixed at construction, `importedFunctions` and `functions`
   * by `collectImports` and `collectFunctions`, which run before any body is
   * checked. An imported constant is a top-level constant, not held here: it
   * may be shadowed (spec §imported-names).
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
    if (this.functions.has(name) || this.importedFunctions.has(name)) {
      return "function";
    }
    return undefined;
  }

  private defineLocal(name: string, type: LocatedType, span: Span, constant: boolean): void {
    this.rejectNameConflict(name, "variable", span);
    const env = this.currentEnv();
    if (env === undefined) {
      this.error(`cannot define '${name}' outside a scope`, span);
    }
    if (env === this.topLevelEnv && this.importedConstants.has(name)) {
      this.error(
        `'${name}' is an imported constant; the top level may not declare a variable of its name`,
        span,
        ["imported-names", "variable-scope"],
      );
    }
    if (env.has(name)) {
      this.error(`variable '${name}' is already defined in this scope`, span,
        ["variable-scope"]);
    }
    env.set(name, { type, constant });
  }

  /**
   * The type of the variable an assignment or a transfer statement stores into
   * (spec §assignment-statement, §transfer-statement), which must not be a `const`
   * (spec §const-statement). Only the variable is constant: an element target
   * looks its array up with {@link lookupVariable} instead.
   */
  private lookupStoreTarget(name: string, span: Span): LocatedType {
    const variable = this.lookupVariable(name, span);
    if (variable.constant) {
      this.error(
        `cannot assign to '${name}' because it is a constant`,
        span,
        ["const-statement", "assignment-to-a-constant"],
      );
    }
    return variable.type;
  }

  private lookupVariable(name: string, span: Span): Variable {
    const hit = this.findInScope(name);
    if (hit !== undefined) {
      return hit;
    }
    if (this.currentFunction !== undefined && this.topLevelConstants.has(name)) {
      const constant = this.useTopLevelConstant(this.currentFunction, name, span);
      if (constant !== undefined) {
        return constant;
      }
    }
    const holder = this.nameHolder(name);
    if (holder !== undefined) {
      this.error(
        `'${name}' is ${describeHolder(holder)}, not a value`,
        span,
        ["namespaces"],
      );
    }
    // Visible nowhere here, but declared at top level: a function body sees the
    // top-level constants and no other top-level variable (spec §top-level-let),
    // which is worth saying outright.
    if (this.topLevelEnv.has(name)) {
      this.error(
        `'${name}' is a top-level variable and is not visible inside a function`,
        span,
        ["top-level-let"],
      );
    }
    this.error(`undefined variable '${name}'`, span);
  }

  /**
   * The top-level constant `name`, which the body of `fn` uses where nothing
   * nearer has that name (spec §top-level-let). The use is recorded for
   * §top-level-constant-initialization-order.
   *
   * Undefined when the top level holds a `let` of that name, declared before
   * the constant: not visible here, and the constant is rejected where it is
   * declared, as a second variable of its scope.
   */
  private useTopLevelConstant(
    fn: FunctionDeclaration,
    name: string,
    span: Span,
  ): Variable | undefined {
    const variable = this.topLevelEnv.get(name);
    if (variable === undefined) {
      // Not declared yet, so the top level is still being checked. A body is
      // checked then only to infer the return type of a function a top-level
      // statement calls, which would run before the constant is initialized.
      if (this.topLevelCall === undefined) {
        throw new Error(
          `internal error: '${fn.name}' uses the top-level constant '${name}' before the top level declared it ${specRef("top-level-constant-initialization-order")}`,
        );
      }
      this.reportConstantUsedBeforeInitialization(
        this.topLevelCall,
        this.topLevelIndex,
        this.inferring.map((decl) => decl.name),
        name,
      );
    }
    if (!variable.constant) {
      return undefined;
    }
    // A local function's body holds values at its own location only
    // (spec §local-function-strict-location-rule). Checked here, at the name,
    // because not every use of the constant would catch it later: an element
    // assignment into a `dyn` array agrees with any index and value.
    if (fn.context.kind === "local") {
      const location = variable.type.location;
      if (!locationsEqual(location, contextAsLocation(fn.context))) {
        this.error(
          `${this.importedConstants.has(name) ? "imported" : "top-level"} constant '${name}' at ${formatLocation(location)} is not usable in local function at ${fn.context.endpoint}`,
          span,
          [
            "local-function-strict-location-rule",
            location.kind === "dyn" ? "dyn-in-a-local-function" : "invalid-value-used-inside-local-function",
          ],
        );
      }
    }
    let uses = this.constantUses.get(fn.name);
    if (uses === undefined) {
      uses = new Set();
      this.constantUses.set(fn.name, uses);
    }
    uses.add(name);
    return variable;
  }

  /** Resolves a variable without reporting when there is none. */
  private findVariable(name: string): Variable | undefined {
    const hit = this.findInScope(name);
    if (hit !== undefined || this.currentFunction === undefined || !this.topLevelConstants.has(name)) {
      return hit;
    }
    const variable = this.topLevelEnv.get(name);
    return variable?.constant === true ? variable : undefined;
  }

  /** The variable or parameter `name` in the scopes the checker is in, innermost first. */
  private findInScope(name: string): Variable | undefined {
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

  private pushEnv(env: Map<string, Variable>): void {
    this.envStack.push(env);
  }

  private popEnv(): void {
    this.envStack.pop();
  }

  private currentEnv(): Map<string, Variable> | undefined {
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
    const params = decl.params.map((p) => this.resolveParameterType(decl, p));
    const returnType = this.getResolvedReturnType(decl);
    return {
      name: decl.name,
      context: decl.context,
      params,
      returnType,
    };
  }

  /** Report an error and abandon type checking (see {@link FailFast}). */
  private error(message: string, span: Span, spec: SpecRefs = []): never {
    this.errors.push(typeCheckError(message, span, spec));
    throw new FailFast();
  }
}

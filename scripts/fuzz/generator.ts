/**
 * Random well-typed ChoreoBS program generator (spec §syntax–§location-annotation-rules).
 *
 * The generator is written to only ever emit programs the specification says
 * are well typed, so that a type error from the compiler is itself a finding:
 * either the generator misreads a rule, or the checker does.
 *
 * The one thing it imports is the spec registry. That is the specification,
 * not the compiler, so naming a section here still says nothing about how the
 * compiler is implemented — and a section that spec.md does not have stops
 * compiling.
 */
import { specRef, type SpecId } from "../../src/spec/ref.js";

export type Base = "integer" | "float" | "boolean" | "string";

export interface Ty {
  readonly base: Base;
  readonly isArray: boolean;
}

/** An endpoint name, `every`, or `dyn` (spec §dyn). */
export type Loc = string;

interface Binding {
  readonly name: string;
  readonly ty: Ty;
  readonly loc: Loc;
  /** Block nesting level the binding was declared at, for shadowing (spec §variable-scope). */
  readonly depth: number;
  /** Declared with `const`, so never stored into (spec §const-statement). */
  readonly constant?: true;
}

interface FnSig {
  readonly name: string;
  /** `undefined` for a choreography function (spec §function-kinds). */
  readonly at?: string;
  readonly params: readonly Binding[];
  /** `undefined` means the function returns `void` (spec §void). */
  readonly ret?: { readonly ty: Ty; readonly loc: Loc };
  /**
   * The top-level constants it may reach (spec §top-level-constant-initialization-order),
   * read off its text: every one named in its body, and every one its callees
   * may reach. More than it does when a body declaration shadows a constant,
   * which only keeps a call back longer than it need be.
   */
  readonly uses: ReadonlySet<string>;
}

/** Choreography context, or a local function body at one endpoint. */
type Ctx = { readonly kind: "choreography" } | { readonly kind: "local"; readonly endpoint: string };

export interface GenOptions {
  readonly seed: number;
  /** Inject exactly one violation with this id (see `VIOLATIONS`). */
  readonly violation?: string;
  readonly endpoints: readonly string[];
  readonly maxFunctions?: number;
  readonly maxTopStatements?: number;
  readonly maxExprDepth?: number;
  readonly maxBlockDepth?: number;
  /**
   * Generate `@dyn` too (spec §dyn): dynamic variables, literals, arrays,
   * parameters, return types and transfers, and dynamic values meeting
   * concrete ones. Off by default; when off, the generator draws exactly the
   * random numbers it always did, so a seed still names the same program.
   */
  readonly dyn?: boolean;
  /**
   * With `dyn`, whether the program may also leave locations out and have them
   * be `dyn` (spec §omitted-locations). Must be `false` for a program that is
   * compiled with `"implicitDyn": false`. Defaults to `true`.
   */
  readonly implicitDyn?: boolean;
  /**
   * Generate top-level constants that function bodies use (spec §top-level-let),
   * declared among the top-level statements, with each top-level call made
   * only once the constants its callee reaches are declared
   * (spec §top-level-constant-initialization-order). Off by default; when off,
   * the generator draws exactly the random numbers it always did.
   */
  readonly constants?: boolean;
}

export interface GeneratedProgram {
  readonly seed: number;
  readonly endpoints: readonly string[];
  readonly source: string;
  /** Language features this program actually exercises, for coverage reporting. */
  readonly features: readonly string[];
  /** Where the requested violation landed, if one was requested and injected. */
  readonly injected?: { readonly id: string; readonly context: string };
  /**
   * The `"implicitDyn"` to compile the program with (spec §strict-mode): `false`
   * for a program written for strict mode — asked for with
   * {@link GenOptions.implicitDyn}, or a violation that is one only there.
   */
  readonly implicitDyn: boolean;
}

/** Array element types are restricted to these (spec §array-typing, §unsupported-array-element-type). */
const ARRAY_BASES: readonly Base[] = ["integer", "float", "boolean"];
const ALL_BASES: readonly Base[] = ["integer", "float", "boolean", "string"];
/** The operands of the arithmetic and relational operators and of `as` (spec §operators, §numeric-conversion). */
const NUMERIC_BASES: readonly Base[] = ["integer", "float"];

/** Violations whose shape needs at least two functions in the program. */
const NEEDS_TWO_FUNCTIONS = new Set([
  "crossEndpointLocalCall",
  "choreographyCallFromLocal",
  // A function is registered only once its own body is done, so taking a
  // function's name needs a second function for the injection to land in.
  "functionNameAsVariable",
]);

const INTEGER: Ty = { base: "integer", isArray: false };
const BOOLEAN: Ty = { base: "boolean", isArray: false };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sameTy(a: Ty, b: Ty): boolean {
  return a.base === b.base && a.isArray === b.isArray;
}

export function generate(options: GenOptions): GeneratedProgram {
  return new Generator(options).run();
}

/**
 * Every prefix the generator mints names with: variables (`declareName`,
 * `genFor`), parameters, and the violation temporaries. Function names use
 * `f<n>` and top-level constants `g<n>`, each from a counter of its own.
 */
const GENERATED_NAME = /^(?:v|t|i|p|bad|f|g)\d+$/;

/** Identifiers the violation cases emit verbatim. */
const GENERATED_LITERAL_NAMES = ["sendInteger", "nosuchendpoint"];

/**
 * Rejects an endpoint set the generator cannot safely generate against.
 *
 * Endpoints, functions and variables share one name space (spec §namespaces), so an
 * endpoint named like something the generator mints — `f1`, `v2`, the
 * `sendInteger` it uses for the reserved-name violation — would make its
 * *valid* programs violate §namespaces or §function-names. `run.ts` would then report those
 * rejections as compiler bugs, and `violate.ts` would count them as caught
 * violations for the wrong reason. The prefixes are load-bearing, so the
 * assumption is checked rather than left implicit.
 */
export function assertUsableEndpoints(endpoints: readonly string[]): void {
  const fail = (message: string): never => {
    console.error(`error: ${message}`);
    process.exit(1);
  };
  // Two are needed to transfer at all, and `--vary` divides by one less.
  if (endpoints.length < 2) {
    fail(`need at least 2 endpoints, got ${endpoints.length}`);
  }
  for (const name of endpoints) {
    if (GENERATED_NAME.test(name) || GENERATED_LITERAL_NAMES.includes(name)) {
      fail(
        `endpoint '${name}' collides with the names the generator mints; ` +
          `pick one that is not <v|t|i|p|bad|f|g><digits> or ` +
          `${GENERATED_LITERAL_NAMES.join("/")} ${specRef("namespaces")}`,
      );
    }
  }
}

class Generator {
  private readonly rng: () => number;
  private readonly endpoints: readonly string[];
  private readonly maxExprDepth: number;
  private readonly maxBlockDepth: number;
  private readonly fns: FnSig[] = [];
  private readonly lines: string[] = [];
  private readonly features = new Set<string>();
  /** Constructs currently being generated into, outermost first. */
  private readonly enclosing: string[] = [];
  private counter = 0;
  private fnCounter = 0;
  /** Statement index at or after which the violation is injected. */
  private injectionTarget = 0;
  private statementsSeen = 0;
  private injected: { id: string; context: string } | undefined;
  /** Whether `@dyn` is generated at all (see {@link GenOptions.dyn}). */
  private readonly dyn: boolean;
  /** Whether omitted locations are generated for `dyn` (see {@link GenOptions.implicitDyn}). */
  private readonly implicit: boolean;
  /** Whether top-level constants are generated (see {@link GenOptions.constants}). */
  private readonly constants: boolean;
  /** The top-level constants, planned before the functions that use them. */
  private readonly plannedConstants: Binding[] = [];
  /** The planned constants the top level has declared so far. */
  private readonly declaredConstants = new Set<string>();
  /**
   * Nonzero while generating an expression whose location is *observed*
   * rather than checked with `~`: an inferred `let`, or the return of a
   * function whose return location is inferred. There the expression must end
   * up exactly where the generator records it, so no value is swapped for one
   * at another location.
   */
  private exactDepth = 0;

  constructor(private readonly options: GenOptions) {
    this.rng = mulberry32(options.seed);
    this.endpoints = options.endpoints;
    this.maxExprDepth = options.maxExprDepth ?? 3;
    this.maxBlockDepth = options.maxBlockDepth ?? 2;
    this.dyn = options.dyn === true;
    this.implicit = this.dyn && options.implicitDyn !== false;
    this.constants = options.constants === true;
  }

  run(): GeneratedProgram {
    this.injectionTarget = this.int(1, 6);
    const maxFunctions = this.options.maxFunctions ?? 3;
    const minFunctions =
      this.options.violation === undefined
        ? 0
        : NEEDS_TWO_FUNCTIONS.has(this.options.violation)
          ? 2
          : 1;
    const functionCount = this.int(
      Math.min(minFunctions, maxFunctions),
      maxFunctions,
    );
    if (this.constants) {
      this.planConstants();
    }
    for (let i = 0; i < functionCount; i += 1) {
      this.genFunction();
    }
    const statementCount = this.int(1, this.options.maxTopStatements ?? 8);
    const scope: Binding[] = [];
    for (let i = 0; i < statementCount; i += 1) {
      if (this.constants && this.chance(0.6)) {
        this.declareNextConstant(scope);
      }
      this.genStatement(scope, { kind: "choreography" }, 0, "");
    }
    while (this.declaredConstants.size < this.plannedConstants.length) {
      this.declareNextConstant(scope);
    }
    return {
      seed: this.options.seed,
      endpoints: this.endpoints,
      source: this.lines.join("\n") + "\n",
      features: [...this.features],
      injected: this.injected,
      implicitDyn:
        this.options.implicitDyn !== false &&
        violationInfo(this.options.violation)?.strict !== true,
    };
  }

  // --- randomness helpers ----------------------------------------------

  private int(min: number, max: number): number {
    return min + Math.floor(this.rng() * (max - min + 1));
  }

  /** An `integer` or `float` scalar type (spec §operators, §numeric-conversion). */
  private numericTy(): Ty {
    return { base: this.pick(NUMERIC_BASES), isArray: false };
  }

  private pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.rng() * xs.length)]!;
  }

  private chance(p: number): boolean {
    return this.rng() < p;
  }

  private fresh(prefix: string): string {
    this.counter += 1;
    return `${prefix}${this.counter}`;
  }

  /**
   * A new binding name, sometimes reusing one from an enclosing block so the
   * declaration shadows it (spec §variable-scope). The shadowed binding is dropped from
   * this view of the scope so later expressions see the new type.
   */
  private declareName(prefix: string, scope: Binding[], depth: number): string {
    const outer = scope.filter((b) => b.depth < depth);
    if (outer.length > 0 && this.chance(0.25)) {
      const shadowed = this.pick(outer);
      this.features.add("scope:shadowing");
      const i = scope.findIndex((b) => b.name === shadowed.name);
      if (i >= 0) {
        scope.splice(i, 1);
      }
      return shadowed.name;
    }
    return this.fresh(prefix);
  }

  // --- types and locations ---------------------------------------------

  private ctxLocation(ctx: Ctx): Loc {
    return ctx.kind === "choreography" ? "every" : ctx.endpoint;
  }

  /**
   * Locations usable in this context. A local function body may only mention
   * its own endpoint, never `every` or another endpoint (spec §local-function-strict-location-rule).
   */
  private someLocation(ctx: Ctx): Loc {
    if (ctx.kind === "local") {
      return ctx.endpoint;
    }
    // A local function never holds `dyn` (spec §local-function-strict-location-rule).
    return this.pick(
      this.dyn ? [...this.endpoints, "every", "dyn"] : [...this.endpoints, "every"],
    );
  }

  /** A concrete location usable in a choreography context. */
  private someConcreteLocation(): Loc {
    return this.pick([...this.endpoints, "every"]);
  }

  /** Generates with {@link exactDepth} raised, so nothing is swapped for `dyn`. */
  private exactly<T>(body: () => T): T {
    this.exactDepth += 1;
    try {
      return body();
    } finally {
      this.exactDepth -= 1;
    }
  }

  /** Whether `@dyn` may be generated here: never in a local function (spec §local-function-strict-location-rule). */
  private dynAllowedIn(ctx: Ctx): boolean {
    return this.dyn && ctx.kind === "choreography";
  }

  /** Whether a value may be swapped for one at another, `~`-compatible location here. */
  private mayMixLocations(ctx: Ctx): boolean {
    return this.dynAllowedIn(ctx) && this.exactDepth === 0;
  }

  private someType(allowArray = true): Ty {
    if (allowArray && this.chance(0.25)) {
      return { base: this.pick(ARRAY_BASES), isArray: true };
    }
    return { base: this.pick(ALL_BASES), isArray: false };
  }

  /** `T` or `T[]`, without a location. */
  private formatBase(ty: Ty): string {
    return `${ty.base}${ty.isArray ? "[]" : ""}`;
  }

  private formatType(ty: Ty, loc: Loc): string {
    return `${this.formatBase(ty)}@${loc}`;
  }

  /**
   * `text@loc`, or — where `dyn` may be left out and `loc` is `dyn` — sometimes
   * the bare `text`, since an omitted location there means `dyn`
   * (spec §omitted-locations). `feature` is recorded when it is left out.
   *
   * The chance is drawn only where an omission could apply, as the inline
   * checks this replaces did, so a seed still names the same program.
   */
  private omissible(text: string, loc: Loc, chance: number, feature?: string): string {
    if (this.implicit && loc === "dyn" && this.chance(chance)) {
      if (feature !== undefined) {
        this.features.add(feature);
      }
      return text;
    }
    return `${text}@${loc}`;
  }

  /** A parameter or transfer destination type, whose location may be left out. */
  private formatOmissibleType(ty: Ty, loc: Loc): string {
    return this.omissible(this.formatBase(ty), loc, 0.4, "dyn:omitted type location");
  }

  // --- coverage ---------------------------------------------------------

  /** spec §transfer-typing: the location pair decides how a transfer is carried out. */
  private transferMode(
    src: Loc,
    dst: Loc,
  ): "localCopy" | "broadcast" | "direct" | "dynamic" {
    // With `dyn` on either side the runtime decides (spec §dynamic-transfer).
    if (src === "dyn" || dst === "dyn") {
      return "dynamic";
    }
    if (src === "every" || src === dst) {
      return "localCopy";
    }
    return dst === "every" ? "broadcast" : "direct";
  }

  private recordTransfer(src: Loc, dst: Loc, ty: Ty): void {
    const mode = this.transferMode(src, dst);
    this.features.add(`transfer:${mode}`);
    if (mode === "localCopy") {
      return;
    }
    if (ty.isArray) {
      this.features.add("comm:array payload");
    }
    if (this.enclosing.includes("while") || this.enclosing.includes("for")) {
      this.features.add("comm:inside loop");
    }
    if (this.enclosing.includes("if-then") || this.enclosing.includes("if-else")) {
      this.features.add("comm:inside if");
    }
    const fn = this.enclosing.find(
      (e) => e === "choreography-fn" || e === "local-fn",
    );
    this.features.add(fn === undefined ? "comm:at top level" : `comm:inside ${fn}`);
  }

  private within<T>(label: string, body: () => T): T {
    this.enclosing.push(label);
    try {
      return body();
    } finally {
      this.enclosing.pop();
    }
  }

  // --- expressions ------------------------------------------------------

  private literal(base: Base, loc: Loc): string {
    // A literal without a location is `c@dyn` (spec §omitted-locations).
    return this.omissible(this.bareLiteral(base), loc, 0.4, "dyn:omitted literal location");
  }

  /** Array literal elements carry no location of their own (spec §array-literals). */
  private bareLiteral(base: Base): string {
    switch (base) {
      case "integer":
        return String(this.int(0, 99));
      case "float":
        return `${this.int(0, 99)}.${this.int(0, 9)}`;
      case "boolean":
        return this.chance(0.5) ? "true" : "false";
      case "string":
        return `"s${this.int(0, 99)}"`;
    }
  }

  private varsOf(scope: readonly Binding[], ty: Ty, loc: Loc): readonly Binding[] {
    return scope.filter((b) => b.loc === loc && sameTy(b.ty, ty));
  }

  private genExpr(
    ty: Ty,
    loc: Loc,
    scope: readonly Binding[],
    ctx: Ctx,
    depth: number,
  ): string {
    // A `dyn` value is `~` any location (spec §location-consistency-and-join), so it may
    // stand anywhere a concrete one is asked for; the compiler casts it. Where
    // the result is observed instead, `exactDepth` keeps it exact.
    if (this.mayMixLocations(ctx) && loc !== "dyn" && this.chance(0.12)) {
      this.features.add("dyn:cast");
      return this.genExpr(ty, "dyn", scope, ctx, depth);
    }
    const choices: (() => string)[] = [];
    const vars = this.varsOf(scope, ty, loc);
    if (vars.length > 0) {
      choices.push(() => this.pick(vars).name);
    }

    if (ty.isArray) {
      choices.push(() => this.arrayLiteral(ty, loc));
    } else {
      choices.push(() => this.literal(ty.base, loc));
    }

    if (depth < this.maxExprDepth) {
      this.addCompoundChoices(choices, ty, loc, scope, ctx, depth);
    }
    return this.pick(choices)();
  }

  private addCompoundChoices(
    choices: (() => string)[],
    ty: Ty,
    loc: Loc,
    scope: readonly Binding[],
    ctx: Ctx,
    depth: number,
  ): void {
    const next = depth + 1;
    const sub = (t: Ty) => this.genExpr(t, loc, scope, ctx, next);

    if (!ty.isArray) {
      // Index access: xs[i] where xs : T[]@loc (spec §array-typing).
      const arrays = this.varsOf(scope, { base: ty.base, isArray: true }, loc);
      if (arrays.length > 0) {
        choices.push(() => `${this.pick(arrays).name}[${sub(INTEGER)}]`);
      }
    }

    if (ty.base === "integer" && !ty.isArray) {
      const anyArray = scope.filter((b) => b.loc === loc && b.ty.isArray);
      if (anyArray.length > 0) {
        choices.push(() => `${this.pick(anyArray).name}.length`);
      }
    }

    if (!ty.isArray && NUMERIC_BASES.includes(ty.base)) {
      // Both operands at the same location; result is there too (spec §operators).
      choices.push(() => `(${sub(ty)} ${this.pick(["+", "-", "*"])} ${sub(ty)})`);
      // Either numeric type converts to either, `ty` included; the result stays
      // at the operand's location (spec §numeric-conversion).
      choices.push(() => `(${sub(this.numericTy())} as ${ty.base})`);
      // Unparenthesized, the conversion is the left operand of the `+` after it,
      // as in TypeScript (spec §expressions).
      choices.push(() => `(${sub(this.numericTy())} as ${ty.base} + ${sub(ty)})`);
    }

    if (!ty.isArray && ty.base === "string") {
      choices.push(() => `(${sub(ty)} + ${sub(ty)})`);
    }

    if (!ty.isArray && ty.base === "boolean") {
      choices.push(() => {
        const numeric = this.numericTy();
        return `(${sub(numeric)} ${this.pick(["<", "<=", ">", ">="])} ${sub(numeric)})`;
      });
      choices.push(() => `(${sub(BOOLEAN)} ${this.pick(["&&", "||"])} ${sub(BOOLEAN)})`);
      choices.push(() => `!(${sub(BOOLEAN)})`);
      choices.push(() => {
        // `===` / `!==` are undefined for array types (spec §array-typing).
        const operand: Ty = { base: this.pick(ALL_BASES), isArray: false };
        return `(${sub(operand)} ${this.pick(["===", "!=="])} ${sub(operand)})`;
      });
    }

    const callable = this.fns.filter(
      (f) =>
        this.callableFrom(f, ctx) &&
        this.initializedFor(f) &&
        f.ret !== undefined &&
        sameTy(f.ret.ty, ty) &&
        f.ret.loc === loc,
    );
    if (callable.length > 0) {
      choices.push(() => this.genCall(this.pick(callable), scope, ctx, next));
    }
  }

  private arrayLiteral(ty: Ty, loc: Loc): string {
    const size = this.int(1, 3);
    const elements: string[] = [];
    for (let i = 0; i < size; i += 1) {
      elements.push(this.bareLiteral(ty.base));
    }
    // An unannotated array literal is `@dyn` (spec §array-literals).
    return this.omissible(`[${elements.join(", ")}]`, loc, 0.4, "dyn:unannotated array literal");
  }

  /**
   * An expression for a position that places a single value at `loc` — a
   * `let` initializer, an assigned value, an argument, a returned value. Such
   * a position injects a concrete value into `dyn` (spec §coercion),
   * so where `dyn` is asked for, a concrete value may come instead.
   */
  private genPlaced(
    ty: Ty,
    loc: Loc,
    scope: readonly Binding[],
    ctx: Ctx,
    depth: number,
  ): string {
    if (this.mayMixLocations(ctx) && loc === "dyn" && this.chance(0.25)) {
      this.features.add("dyn:inject");
      return this.genExpr(ty, this.someConcreteLocation(), scope, ctx, depth);
    }
    return this.genExpr(ty, loc, scope, ctx, depth);
  }

  /**
   * spec §calling-local-from-choreography, §calling-functions-from-a-local-context: a choreography context may call anything; a local
   * function may only call local functions at its own endpoint.
   */
  private callableFrom(fn: FnSig, ctx: Ctx): boolean {
    if (ctx.kind === "choreography") {
      return true;
    }
    return fn.at === ctx.endpoint;
  }

  /**
   * Whether `fn` may be called here: anywhere in a function body, and at top
   * level once every constant it may reach is declared
   * (spec §top-level-constant-initialization-order).
   */
  private initializedFor(fn: FnSig): boolean {
    return this.inFunctionBody() || [...fn.uses].every((name) => this.declaredConstants.has(name));
  }

  private inFunctionBody(): boolean {
    return this.enclosing.includes("choreography-fn") || this.enclosing.includes("local-fn");
  }

  private genCall(
    fn: FnSig,
    scope: readonly Binding[],
    ctx: Ctx,
    depth: number,
  ): string {
    const args = fn.params.map((p) => this.genPlaced(p.ty, p.loc, scope, ctx, depth));
    if (fn.uses.size > 0 && !this.inFunctionBody()) {
      this.features.add("constant:reached from top level");
    }
    return `${fn.name}(${args.join(", ")})`;
  }

  // --- statements -------------------------------------------------------

  private emit(indent: string, line: string): void {
    this.lines.push(indent + line);
  }

  private genStatement(
    scope: Binding[],
    ctx: Ctx,
    blockDepth: number,
    indent: string,
  ): void {
    if (this.options.violation !== undefined && this.injected === undefined) {
      this.statementsSeen += 1;
      if (
        this.statementsSeen >= this.injectionTarget &&
        this.emitViolation(this.options.violation, scope, ctx, indent, blockDepth)
      ) {
        return;
      }
    }

    const kinds = [
      "letAnnotated",
      "letAnnotated",
      "letInferred",
      "letTransfer",
      "letTransfer",
      "assignment",
      "transferStatement",
      "indexAssignment",
      "push",
      "print",
      "call",
    ];
    if (blockDepth < this.maxBlockDepth) {
      kinds.push("if", "while", "for");
    }

    switch (this.pick(kinds)) {
      case "letAnnotated":
        return this.genLetAnnotated(scope, ctx, indent, blockDepth);
      case "letInferred":
        return this.genLetInferred(scope, ctx, indent, blockDepth);
      case "letTransfer":
        return this.genLetTransfer(scope, ctx, indent, blockDepth);
      case "assignment":
        return this.genAssignment(scope, ctx, indent, blockDepth);
      case "transferStatement":
        return this.genTransferStatement(scope, ctx, indent, blockDepth);
      case "indexAssignment":
        return this.genIndexAssignment(scope, ctx, indent, blockDepth);
      case "push":
        return this.genPush(scope, ctx, indent, blockDepth);
      case "print":
        return this.genPrint(scope, ctx, indent);
      case "call":
        return this.genCallStatement(scope, ctx, indent, blockDepth);
      case "if":
        return this.genIf(scope, ctx, blockDepth, indent);
      case "while":
        return this.genWhile(scope, ctx, blockDepth, indent);
      case "for":
        return this.genFor(scope, ctx, blockDepth, indent);
      default:
        return this.genLetAnnotated(scope, ctx, indent, blockDepth);
    }
  }

  private genLetAnnotated(
    scope: Binding[],
    ctx: Ctx,
    indent: string,
    depth: number,
  ): void {
    const ty = this.someType();
    const loc = this.someLocation(ctx);
    const name = this.declareName("v", scope, depth);
    // An empty array literal is only allowed against an explicit array type
    // with its own location annotation (spec §array-typing).
    const empty = ty.isArray && this.chance(0.15);
    const init = empty
      ? this.omissible("[]", loc, 0.5)
      : this.genPlaced(
          ty,
          loc,
          scope,
          ctx,
          1,
        );
    if (empty) {
      this.features.add("array:empty literal");
    }
    this.emit(indent, `let ${name}: ${this.formatType(ty, loc)} = ${init};`);
    scope.push({ name, ty, loc, depth });
  }

  private genLetInferred(
    scope: Binding[],
    ctx: Ctx,
    indent: string,
    depth: number,
  ): void {
    const ty = this.someType();
    const loc = this.someLocation(ctx);
    const name = this.declareName("v", scope, depth);
    // The binding is recorded at `loc`, so the initializer must end up there.
    const init = this.exactly(() => this.genExpr(ty, loc, scope, ctx, 1));
    this.emit(indent, `let ${name} = ${init};`);
    scope.push({ name, ty, loc, depth });
  }

  /** `let y: T2@L2 <- e;` — needs `T1 <: T2`, locations unrestricted (spec §transfer-typing). */
  private genLetTransfer(
    scope: Binding[],
    ctx: Ctx,
    indent: string,
    depth: number,
  ): void {
    const ty = this.someType();
    const dst = this.someLocation(ctx);
    const src = this.someLocation(ctx);
    const name = this.declareName("t", scope, depth);
    const source = this.genExpr(ty, src, scope, ctx, 1);
    this.recordTransfer(src, dst, ty);
    this.emit(indent, `let ${name}: ${this.formatOmissibleType(ty, dst)} <- ${source};`);
    scope.push({ name, ty, loc: dst, depth });
  }

  private genAssignment(
    scope: Binding[],
    ctx: Ctx,
    indent: string,
    depth: number,
  ): void {
    const target = this.pickBinding(scope, (b) => b.constant !== true);
    if (target === undefined) {
      return this.genLetAnnotated(scope, ctx, indent, depth);
    }
    const value = this.genPlaced(
      target.ty,
      target.loc,
      scope,
      ctx,
      1,
    );
    this.emit(indent, `${target.name} = ${value};`);
  }

  private genTransferStatement(
    scope: Binding[],
    ctx: Ctx,
    indent: string,
    depth: number,
  ): void {
    const target = this.pickBinding(scope, (b) => b.constant !== true);
    if (target === undefined) {
      return this.genLetAnnotated(scope, ctx, indent, depth);
    }
    const src = this.someLocation(ctx);
    const source = this.genExpr(
      target.ty,
      src,
      scope,
      ctx,
      1,
    );
    this.recordTransfer(src, target.loc, target.ty);
    this.emit(indent, `${target.name} <- ${source};`);
  }

  private genIndexAssignment(
    scope: Binding[],
    ctx: Ctx,
    indent: string,
    depth: number,
  ): void {
    const target = this.pickBinding(scope, (b) => b.ty.isArray);
    if (target === undefined) {
      return this.genLetAnnotated(scope, ctx, indent, depth);
    }
    const element: Ty = { base: target.ty.base, isArray: false };
    const index = this.genExpr(INTEGER, target.loc, scope, ctx, 2);
    const value = this.genExpr(
      element,
      target.loc,
      scope,
      ctx,
      2,
    );
    this.features.add("array:index assignment");
    this.emit(indent, `${target.name}[${index}] = ${value};`);
  }

  private genPush(
    scope: Binding[],
    ctx: Ctx,
    indent: string,
    depth: number,
  ): void {
    const target = this.pickBinding(scope, (b) => b.ty.isArray);
    if (target === undefined) {
      return this.genLetAnnotated(scope, ctx, indent, depth);
    }
    const element: Ty = { base: target.ty.base, isArray: false };
    const value = this.genExpr(
      element,
      target.loc,
      scope,
      ctx,
      2,
    );
    this.features.add("array:push");
    this.emit(indent, `${target.name}.push(${value});`);
  }

  /** `print(e)` of a value of any type at any location (spec §print-typing). */
  private genPrint(scope: Binding[], ctx: Ctx, indent: string): void {
    const ty = this.someType();
    const loc = this.someLocation(ctx);
    const value = this.genExpr(ty, loc, scope, ctx, 1);
    this.features.add(`print:${loc === "every" || loc === "dyn" ? loc : "individual"}`);
    this.emit(indent, `print(${value});`);
  }

  private genCallStatement(
    scope: Binding[],
    ctx: Ctx,
    indent: string,
    depth: number,
  ): void {
    const callable = this.fns.filter((f) => this.callableFrom(f, ctx) && this.initializedFor(f));
    if (callable.length === 0) {
      return this.genLetAnnotated(scope, ctx, indent, depth);
    }
    const fn = this.pick(callable);
    this.emit(indent, `${this.genCall(fn, scope, ctx, 1)};`);
  }

  private pickBinding(
    scope: readonly Binding[],
    predicate: (b: Binding) => boolean,
  ): Binding | undefined {
    const candidates = scope.filter(predicate);
    return candidates.length === 0 ? undefined : this.pick(candidates);
  }

  /** Conditions must be `boolean` at the context's location (spec §if-condition-typing, §while-and-for-condition-typing). */
  private genCondition(scope: readonly Binding[], ctx: Ctx): string {
    return this.genExpr(BOOLEAN, this.ctxLocation(ctx), scope, ctx, 1);
  }

  private genIf(scope: Binding[], ctx: Ctx, blockDepth: number, indent: string): void {
    const condition = this.genCondition(scope, ctx);
    this.emit(indent, `if (${condition}) {`);
    this.within("if-then", () =>
      this.genBlock(scope, ctx, blockDepth + 1, indent + "    "),
    );
    if (this.chance(0.6)) {
      this.emit(indent, `} else {`);
      this.within("if-else", () =>
        this.genBlock(scope, ctx, blockDepth + 1, indent + "    "),
      );
    }
    this.emit(indent, `}`);
  }

  private genWhile(scope: Binding[], ctx: Ctx, blockDepth: number, indent: string): void {
    const condition = this.genCondition(scope, ctx);
    this.emit(indent, `while (${condition}) {`);
    this.within("while", () =>
      this.genBlock(scope, ctx, blockDepth + 1, indent + "    "),
    );
    this.emit(indent, `}`);
  }

  private genFor(scope: Binding[], ctx: Ctx, blockDepth: number, indent: string): void {
    let loc = this.ctxLocation(ctx);
    const i = this.fresh("i");
    const bound = this.int(1, 5);
    // A `dyn` counter: its condition is cast to `every` each time round
    // (spec §if-condition-typing), in the written or the omitted form.
    let omitted = false;
    if (this.dynAllowedIn(ctx) && this.chance(0.3)) {
      loc = "dyn";
      this.features.add("dyn:for counter");
      omitted = this.implicit && this.chance(0.5);
    }
    const at = omitted ? "" : `@${loc}`;
    const type = omitted ? "" : `: integer${at}`;
    this.emit(indent, `for (let ${i}${type} = 0${at}; ${i} < ${bound}${at}; ${i} = ${i} + 1${at}) {`);
    const inner: Binding[] = [
      ...scope,
      { name: i, ty: INTEGER, loc, depth: blockDepth + 1 },
    ];
    this.within("for", () =>
      this.genBlock(inner, ctx, blockDepth + 1, indent + "    "),
    );
    this.emit(indent, `}`);
  }

  /** Bindings declared inside a block do not escape it (spec §variable-scope). */
  private genBlock(
    scope: readonly Binding[],
    ctx: Ctx,
    blockDepth: number,
    indent: string,
  ): void {
    const inner: Binding[] = [...scope];
    const count = this.int(1, 3);
    for (let i = 0; i < count; i += 1) {
      this.genStatement(inner, ctx, blockDepth, indent);
    }
  }

  // --- functions --------------------------------------------------------

  /** Whether violation `id` can be built in `ctx` (see {@link ViolationInfo.where}). */
  private violationFits(id: string, ctx: Ctx): boolean {
    // A strict violation is an omission, and in a local function an omission
    // is the function's own location in either mode (spec §local-function-location-inference),
    // so there it would be no violation at all.
    if (ctx.kind === "local" && violationInfo(id)?.strict === true) {
      return false;
    }
    switch (violationInfo(id)?.where) {
      case undefined:
        return true;
      case "choreography":
        return ctx.kind === "choreography";
      case "local":
        return ctx.kind === "local";
      case "topLevel":
        return ctx.kind === "choreography" && this.enclosing.length === 0;
    }
  }

  /**
   * Some violations can only be built against a particular shape of program:
   * calling a choreography function illegally needs one to exist, and calling
   * another endpoint's local function needs two local functions.
   */
  private chooseFunctionKind(): boolean {
    const violation = this.options.violation;
    if (violation === undefined || this.injected !== undefined) {
      return this.chance(0.5);
    }
    if (violation === "choreographyCallFromLocal") {
      // The first function is the choreography one; later ones are local, so
      // the injection site can call it from a local body.
      return this.fns.length > 0;
    }
    // A violation only a local function body can hold needs one to exist
    // (spec §local-function-strict-location-rule).
    if (violationInfo(violation)?.where === "local") {
      return true;
    }
    return this.chance(0.5);
  }

  private genFunction(): void {
    const isLocal = this.chooseFunctionKind();
    let at = isLocal ? this.pick(this.endpoints) : undefined;
    // `crossEndpointLocalCall` needs two local functions at different
    // endpoints, so the call it injects is genuinely cross-endpoint.
    if (
      at !== undefined &&
      this.options.violation === "crossEndpointLocalCall" &&
      this.injected === undefined
    ) {
      const previous = this.fns.find((f) => f.at !== undefined)?.at;
      if (previous !== undefined) {
        at = this.endpoints.find((e) => e !== previous) ?? at;
      }
    }
    const ctx: Ctx = at === undefined ? { kind: "choreography" } : { kind: "local", endpoint: at };
    this.fnCounter += 1;
    const name = `f${this.fnCounter}`;

    // Body names restart per function so they repeat across functions; a
    // function body is a scope of its own, which sees no top-level variable
    // but the constants (spec §variable-scope, §top-level-let).
    const savedCounter = this.counter;
    this.counter = 0;

    const params: Binding[] = [];
    const paramCount = this.int(0, 3);
    for (let i = 0; i < paramCount; i += 1) {
      params.push({
        name: this.fresh("p"),
        ty: this.someType(),
        loc: this.someLocation(ctx),
        depth: 0,
      });
    }
    // Drawn here, before the return type, and not where the header is built:
    // moving it would change what every later draw of a seed produces.
    const paramTypes = params.map((p) => this.formatOmissibleType(p.ty, p.loc));

    const returnsValue = this.chance(0.6);
    const ret = returnsValue
      ? { ty: this.someType(), loc: this.someLocation(ctx) }
      : undefined;

    // The return type may be omitted; the single trailing return makes it
    // inferable, and nothing generated here is recursive (spec §function-return-type-inference, §inference-and-recursion).
    const omitReturnType = this.chance(0.3);
    if (omitReturnType) {
      this.features.add("function:inferred return type");
    }
    this.features.add(at === undefined ? "function:choreography" : "function:local");

    // `function f(): T { … }` writes the base only; the location is inferred
    // from the return, like an omitted return type's (spec §partial-return-annotations).
    const partialReturnType =
      this.dynAllowedIn(ctx) && ret !== undefined && !omitReturnType && this.chance(0.25);
    if (partialReturnType) {
      this.features.add("dyn:partial return type");
    }
    // Whether the return location comes from the `return` below.
    const inferredReturnLocation = omitReturnType || partialReturnType;
    const annotation = omitReturnType
      ? ""
      : ret === undefined
        ? ": void"
        : partialReturnType
          ? `: ${this.formatBase(ret.ty)}`
          : `: ${this.formatType(ret.ty, ret.loc)}`;
    const header =
      `function ${name}${at === undefined ? "" : `@${at}`}` +
      `(${params.map((p, i) => `${p.name}: ${paramTypes[i]}`).join(", ")})` +
      `${annotation} {`;

    const firstLine = this.lines.length;
    this.emit("", header);
    this.within(at === undefined ? "choreography-fn" : "local-fn", () => {
      const scope: Binding[] = [...this.constantsVisibleIn(ctx), ...params];
      const count = this.int(0, 3);
      for (let i = 0; i < count; i += 1) {
        this.genStatement(scope, ctx, 1, "    ");
      }
      // §missing-return-in-a-non-void-function: a written non-`void` return type with no return at all. Only
      // possible when the type is written, since an omitted one would infer
      // `void` instead of failing coverage (spec §function-return-type-inference).
      const dropReturn =
        this.options.violation === "missingReturnValue" &&
        this.injected === undefined &&
        ret !== undefined &&
        !omitReturnType;
      if (dropReturn) {
        this.injected = {
          id: "missingReturnValue",
          context: at === undefined ? "choreography-fn" : "local-fn",
        };
      } else if (ret === undefined) {
        this.emit("    ", `return;`);
      } else if (inferredReturnLocation) {
        // The return location is inferred from this, so it must be `ret.loc` exactly.
        const value = this.exactly(() => this.genExpr(ret.ty, ret.loc, scope, ctx, 1));
        this.emit("    ", `return ${value};`);
      } else {
        this.emit("    ", `return ${this.genPlaced(ret.ty, ret.loc, scope, ctx, 1)};`);
      }
    });
    this.emit("", `}`);
    this.emit("", ``);
    this.counter = savedCounter;

    // Registered only after its body is generated, so no function can call
    // itself or a later one: recursion is banned for choreography functions
    // and needs an explicit return type otherwise (spec §recursion, §inference-and-recursion).
    this.fns.push({ name, at, params, ret, uses: this.usesIn(this.lines.slice(firstLine)) });
  }

  // --- top-level constants ----------------------------------------------

  /**
   * Plans the top-level constants before any function, so that function
   * bodies can use them (spec §top-level-let). Each is declared later, among
   * the top-level statements (see `declareNextConstant`).
   */
  private planConstants(): void {
    const count = this.int(1, 3);
    for (let i = 1; i <= count; i += 1) {
      this.plannedConstants.push({
        name: `g${i}`,
        ty: this.someType(),
        loc: this.someLocation({ kind: "choreography" }),
        depth: 0,
        constant: true,
      });
    }
  }

  /**
   * The planned constants a body in `ctx` may use: all of them in a
   * choreography function, and those at its own endpoint in a local one
   * (spec §local-function-strict-location-rule). A body declaration may shadow them.
   */
  private constantsVisibleIn(ctx: Ctx): Binding[] {
    return this.plannedConstants.filter(
      (c) => ctx.kind === "choreography" || c.loc === ctx.endpoint,
    );
  }

  /**
   * Declares the next planned constant, its type written out. Its initializer
   * is generated at top level, so it calls only functions whose constants are
   * already declared, which excludes this one (see `initializedFor`).
   */
  private declareNextConstant(scope: Binding[]): void {
    const constant = this.plannedConstants[this.declaredConstants.size];
    if (constant === undefined) {
      return;
    }
    const init = this.genPlaced(constant.ty, constant.loc, scope, { kind: "choreography" }, 1);
    this.emit("", `const ${constant.name}: ${this.formatType(constant.ty, constant.loc)} = ${init};`);
    this.declaredConstants.add(constant.name);
    scope.push(constant);
  }

  /** The constants a function whose text is `lines` may reach (see {@link FnSig.uses}). */
  private usesIn(lines: readonly string[]): ReadonlySet<string> {
    const uses = new Set<string>();
    if (this.plannedConstants.length === 0) {
      return uses;
    }
    const text = lines.join("\n");
    for (const constant of this.plannedConstants) {
      if (new RegExp(`\\b${constant.name}\\b`).test(text)) {
        uses.add(constant.name);
        this.features.add("constant:used in a function");
      }
    }
    for (const [, callee] of text.matchAll(/\b(f\d+)\(/g)) {
      for (const name of this.fns.find((f) => f.name === callee)?.uses ?? []) {
        uses.add(name);
      }
    }
    return uses;
  }

  // --- deliberate violations -------------------------------------------

  /** Where the violation landed, so a hole can be attributed to a context. */
  private injectionContext(ctx: Ctx): string {
    const fn = this.enclosing.find(
      (e) => e === "choreography-fn" || e === "local-fn",
    );
    const blocks = this.enclosing.filter((e) =>
      ["if-then", "if-else", "while", "for"].includes(e),
    );
    const where = fn ?? (ctx.kind === "local" ? "local-fn" : "top-level");
    const innermost = blocks[blocks.length - 1];
    return innermost === undefined ? where : `${where} > ${innermost}`;
  }

  /**
   * Emits one statement that breaks the named rule, or returns false when the
   * rule cannot be broken in this context (an `@every` value, for instance, is
   * only a violation inside a local function).
   */
  private emitViolation(
    id: string,
    scope: Binding[],
    ctx: Ctx,
    indent: string,
    _depth: number,
  ): boolean {
    if (this.endpoints.length < 2) {
      return false;
    }
    const choreography = ctx.kind === "choreography";
    // A location values may legitimately sit at, here.
    const p = choreography ? this.pick(this.endpoints) : ctx.endpoint;
    const q = this.endpoints.find((e) => e !== p)!;
    // A location a condition may not sit at, here (spec §if-condition-typing, §while-and-for-condition-typing).
    const condBad = choreography ? p : "every";
    const here = this.ctxLocation(ctx);
    const n = this.fresh("bad");
    const lines: string[] = [];
    // Only after the draws above, which every attempt makes, so that a seed
    // names the same program whether or not the violation fits here.
    if (!this.violationFits(id, ctx)) {
      return false;
    }

    switch (id) {
      case "binaryMixedLocation":
        lines.push(`let ${n}: integer@${p} = 1@${p} + 2@${q};`);
        break;
      case "binaryEveryWithIndividual":
        lines.push(`let ${n}: integer@every = 1@every + 2@${p};`);
        break;
      case "assignAcrossLocations":
        lines.push(`let ${n}: integer@${p} = 1@${p};`);
        lines.push(`let ${n}b: integer@${q} = ${n};`);
        break;
      case "transferBaseMismatch":
        lines.push(`let ${n}: integer@${p} <- 1.5@${choreography ? q : p};`);
        break;
      case "transferArrayElementMismatch":
        lines.push(`let ${n}: float[]@${p} <- [1, 2]@${choreography ? q : p};`);
        break;
      // `integer` and `float` are unrelated (spec §subtyping): no widening at a
      // `let` or a transfer, and no promotion inside an operator.
      case "numericAssignMismatch":
        lines.push(`let ${n}: float@${p} = 1@${p};`);
        break;
      case "transferNumericWidening":
        lines.push(`let ${n}: float@${p} <- 1@${choreography ? q : p};`);
        break;
      case "mixedNumericArithmetic":
        lines.push(`let ${n} = 1@${p} + 1.5@${p};`);
        break;
      case "mixedNumericComparison":
        lines.push(`let ${n}: boolean@${p} = 1@${p} < 1.5@${p};`);
        break;
      case "conversionNonNumericOperand":
        lines.push(`let ${n} = true@${p} as float;`);
        break;
      case "conversionArrayOperand":
        lines.push(`let ${n}: integer[]@${p} = [1]@${p};`);
        lines.push(`let ${n}b = ${n} as float;`);
        break;
      case "conversionLocatedTarget":
        // A parse error: the target is a bare base type (spec §expressions).
        lines.push(`let ${n} = 1@${p} as float@${p};`);
        break;
      case "ifConditionWrongLocation":
        lines.push(`if (true@${condBad}) {`, `}`);
        break;
      case "whileConditionWrongLocation":
        lines.push(`while (true@${condBad}) {`, `}`);
        break;
      case "forConditionWrongLocation":
        lines.push(
          `for (let ${n}: integer@${here} = 0@${here}; true@${condBad}; ${n} = ${n} + 1@${here}) {`,
          `}`,
        );
        break;
      case "everyValueInLocalFunction":
        lines.push(`let ${n}: integer@every = 1@every;`);
        break;
      case "otherLocationInLocalFunction":
        lines.push(`let ${n}: integer@${q} = 1@${q};`);
        break;
      case "arrayInvariance":
        lines.push(`let ${n}: integer[]@${p} = [1, 2]@${p};`);
        lines.push(`let ${n}b: float[]@${p} = ${n};`);
        break;
      case "arrayLiteralInvariance":
        lines.push(`let ${n}: float[]@${p} = [1, 2]@${p};`);
        break;
      case "everyArrayToIndividual":
        lines.push(`let ${n}: integer[]@every = [1, 2]@every;`);
        lines.push(`let ${n}b: integer[]@${p} = ${n};`);
        break;
      case "arrayEquality":
        lines.push(`let ${n}: integer[]@${p} = [1]@${p};`);
        lines.push(`let ${n}b: boolean@${p} = ${n} === ${n};`);
        break;
      case "arrayIndexWrongLocation":
        lines.push(`let ${n}: integer[]@${p} = [1, 2]@${p};`);
        lines.push(`${n}[0@${q}] = 1@${p};`);
        break;
      case "pushWrongElementType":
        lines.push(`let ${n}: integer[]@${p} = [1]@${p};`);
        lines.push(`${n}.push(1.5@${p});`);
        break;
      case "voidEquality":
        // Two void computations share a base type, so the same-base-type rule
        // does not stop them (spec §invalid-comparison-or-equality-operands).
        lines.push(`let ${n}: integer[]@${p} = [1]@${p};`);
        lines.push(
          `let ${n}b: boolean@${p} = ${n}.push(1@${p}) === ${n}.push(2@${p});`,
        );
        break;
      case "pushAsExpression":
        lines.push(`let ${n}: integer[]@${p} = [1]@${p};`);
        lines.push(`let ${n}b: integer@${p} = ${n}.push(1@${p});`);
        break;
      case "printAsValue":
        lines.push(`let ${n} = print(1@${p});`);
        break;
      case "printVoidArgument":
        // The argument of a print is a value position too (spec §print-typing).
        lines.push(`let ${n}: integer[]@${p} = [1]@${p};`);
        lines.push(`print(${n}.push(1@${p}));`);
        break;
      case "printArity":
        // A parse error: `print` takes exactly one argument (spec §invalid-print-call).
        lines.push(`print(1@${p}, 2@${p});`);
        break;
      case "voidValue": {
        // The annotated form is caught by §invalid-use-of-void; this is the inferred path,
        // where the `let` takes its type straight from the initializer.
        const target = this.fns.find(
          (f) =>
            f.ret === undefined &&
            (choreography ? f.at === undefined : f.at === ctx.endpoint),
        );
        if (target === undefined) return false;
        lines.push(`let ${n} = ${this.genCall(target, scope, ctx, 2)};`);
        break;
      }
      case "reservedCompilerPrefix":
        lines.push(`let __transfer_0: integer@${p} = 1@${p};`);
        break;
      case "arrayLiteralWithLocatedElements":
        // Every element is located, but in strict mode the literal itself still
        // needs its own annotation (spec §array-literals). `violationFits` keeps
        // it out of local functions (spec §local-function-location-inference).
        lines.push(`let ${n}: integer@${p} = 1@${p};`);
        lines.push(`let ${n}b = [${n}, ${n}];`);
        break;
      case "voidVariable":
        lines.push(`let ${n}: void@${p} = 1@${p};`);
        break;
      case "reservedRuntimeName":
        // The emitted BlueScript keeps the source name (spec §codegen-function-names), so this
        // variable would shadow the runtime send API.
        lines.push(`let sendInteger: integer@${p} = 1@${p};`);
        break;
      case "unaryArrayOperand":
        lines.push(`let ${n}: boolean[]@${p} = [true, false]@${p};`);
        lines.push(`let ${n}b: boolean@${p} = !${n};`);
        break;
      // An array carries its element type in `base`, so these three slip past
      // any operand check that looks at `base` alone (spec §operators).
      case "arithmeticArrayOperand":
        lines.push(`let ${n}: integer[]@${p} = [1, 2]@${p};`);
        lines.push(`let ${n}b = ${n} + ${n};`);
        break;
      case "comparisonArrayOperand":
        lines.push(`let ${n}: integer[]@${p} = [1, 2]@${p};`);
        lines.push(`let ${n}b: boolean@${p} = ${n} < ${n};`);
        break;
      case "logicalArrayOperand":
        lines.push(`let ${n}: boolean[]@${p} = [true, false]@${p};`);
        lines.push(`let ${n}b: boolean@${p} = ${n} && ${n};`);
        break;
      case "transferDestinationInLocalFunction":
        // Legal in a choreography context; inside `function@p` the destination
        // is a variable of that body and must be at `p` (spec §local-function-strict-location-rule).
        lines.push(`let ${n}: integer@${q} <- 1@${p};`);
        break;
      case "unknownEndpoint":
        lines.push(`let ${n}: integer@nosuchendpoint = 1@nosuchendpoint;`);
        break;
      case "unsupportedEquality":
        lines.push(`let ${n}: boolean@${p} = 1@${p} == 2@${p};`);
        break;
      case "duplicateInScope":
        lines.push(`let ${n}: integer@${p} = 1@${p};`);
        lines.push(`let ${n}: integer@${p} = 2@${p};`);
        break;
      case "endpointNameAsVariable":
        // Endpoints, functions and variables share one name space (spec §namespaces),
        // so a declared endpoint's name is not available to a variable. `q` is
        // deliberately not the location written after `@`, matching the
        // example in spec §err-name-already-held.
        lines.push(`let ${q}: integer@${p} = 1@${p};`);
        break;
      case "functionNameAsVariable": {
        // `fns` holds the functions emitted above this point. Not filtered by
        // `callableFrom`: a conflict with a local function at another endpoint
        // is an error all the same, because the rule is stated over the whole
        // program and not per output file (spec §namespaces).
        const taken = this.fns[0];
        if (taken === undefined) return false;
        lines.push(`let ${taken.name}: integer@${p} = 1@${p};`);
        break;
      }
      // An omission is an error in strict mode (spec §strict-mode, §omitted-locations).
      // `violationFits` keeps this out of local functions, where it would be
      // the function's location (spec §local-function-location-inference).
      case "arrayLiteralWithoutLocation":
        lines.push(`let ${n}: integer[]@${p} = [1, 2, 3];`);
        break;
      case "nestedArray":
        lines.push(`let ${n}: integer[][]@${p} = [[1]]@${p};`);
        break;
      case "typeMismatch":
        lines.push(`let ${n}: integer@${p} = true@${p};`);
        break;
      case "uninitializedLet":
        lines.push(`let ${n}: integer@${p};`);
        break;
      // Locations are never inferred from the expected type (spec §explicit-location-annotations); an
      // omission is an error in strict mode (spec §strict-mode). As above, never
      // in a local function.
      case "literalWithoutLocation":
        lines.push(`let ${n}: integer@${p} = 1;`);
        break;
      case "emptyArrayWithoutType":
        lines.push(`let ${n} = []@${p};`);
        break;
      case "stringArray":
        lines.push(`let ${n}: string[]@${p} = ["a"]@${p};`);
        break;
      case "breakStatement":
        lines.push(`break;`);
        break;
      case "transferLetWithoutAnnotation":
        lines.push(`let ${n} <- 1@${p};`);
        break;
      case "argumentLocationMismatch": {
        const target = this.fns.find(
          (f) =>
            this.callableFrom(f, ctx) &&
            f.params.some((param) => param.loc !== "every"),
        );
        if (target === undefined) return false;
        const index = target.params.findIndex((param) => param.loc !== "every");
        const args = target.params.map((param, i) => {
          const at =
            i === index
              ? (this.endpoints.find((e) => e !== param.loc) ?? "every")
              : param.loc;
          return this.genExpr(param.ty, at, scope, ctx, 2);
        });
        lines.push(`${target.name}(${args.join(", ")});`);
        break;
      }
      case "everyArrayArgumentToIndividual": {
        const target = this.fns.find(
          (f) =>
            this.callableFrom(f, ctx) &&
            f.params.some((param) => param.ty.isArray && param.loc !== "every"),
        );
        if (target === undefined) return false;
        const index = target.params.findIndex(
          (param) => param.ty.isArray && param.loc !== "every",
        );
        const arrayParam = target.params[index]!;
        lines.push(
          `let ${n}: ${arrayParam.ty.base}[]@every = ${this.arrayLiteral(arrayParam.ty, "every")};`,
        );
        const args = target.params.map((param, i) =>
          i === index ? n : this.genExpr(param.ty, param.loc, scope, ctx, 2),
        );
        lines.push(`${target.name}(${args.join(", ")});`);
        break;
      }
      case "crossEndpointLocalCall": {
        const target = this.fns.find(
          (f) => f.at !== undefined && f.at !== here,
        );
        if (target === undefined) return false;
        lines.push(`${this.genCall(target, scope, ctx, 2)};`);
        break;
      }
      case "choreographyCallFromLocal": {
        const target = this.fns.find((f) => f.at === undefined);
        if (target === undefined) return false;
        lines.push(`${this.genCall(target, scope, ctx, 2)};`);
        break;
      }
      // `dyn` has no place in a local function (spec §local-function-strict-location-rule).
      case "dynValueInLocalFunction":
        lines.push(`let ${n}: integer@${p} = 1@dyn;`);
        break;
      case "dynVariableInLocalFunction":
        lines.push(`let ${n}: integer@dyn = 1@${p};`);
        break;
      case "dynArrayLiteralInLocalFunction":
        lines.push(`[1, 2]@dyn;`);
        break;
      case "dynFunctionLocation":
        // A function declaration is a top-level item.
        lines.push(`function ${n}@dyn(): void {`, `    return;`, `}`);
        break;
      // `dyn` defers the location check only; base types are as static as ever
      // (spec §subtyping).
      case "dynNumericAssignMismatch":
        lines.push(`let ${n}: float@dyn = 1@${p};`);
        break;
      case "dynTransferNumericWidening":
        lines.push(`let ${n}: float@${q} <- 1@dyn;`);
        break;
      case "dynMixedNumericArithmetic":
        lines.push(`let ${n} = 1@dyn + 1.5@dyn;`);
        break;
      case "dynArrayInvariance":
        lines.push(`let ${n}: float[]@dyn = [1, 2]@dyn;`);
        break;
      // `~` is not transitive: two different concrete locations in one
      // construct are an error even with `dyn` among them (spec §location-consistency-and-join).
      case "dynIndexAssignMixedConcrete":
        lines.push(`let ${n}: integer[]@dyn = [1]@dyn;`);
        lines.push(`${n}[0@${p}] = 1@${q};`);
        break;
      case "dynArrayLiteralMixedConcrete":
        lines.push(`let ${n} = [1@${p}, 2@${q}]@dyn;`);
        break;
      // A `const` is never stored into again (spec §const-statement); either
      // store would be fine into a `let`.
      case "assignToConst":
        lines.push(`const ${n}: integer@${p} = 1@${p};`);
        lines.push(`${n} = 2@${p};`);
        break;
      case "transferToConst":
        lines.push(`const ${n}: integer@${p} = 1@${p};`);
        lines.push(`${n} <- 2@${choreography ? q : p};`);
        break;
      // No top-level statement calls a function that reaches a constant
      // declared by it or later (spec §top-level-constant-initialization-order).
      // The return type is written, so only the check after the bodies sees it.
      case "constantUsedBeforeInitialization":
        lines.push(
          `function ${n}f@${p}(): integer@${p} {`,
          `    return ${n};`,
          `}`,
          `let ${n}v: integer@${p} = ${n}f();`,
          `const ${n}: integer@${p} = 1@${p};`,
        );
        break;
      // Through a second function, in the constant's own initializer. The return
      // types are inferred, which is where this one is found.
      case "constantInitializerUsesItself":
        lines.push(
          `function ${n}g@${p}() {`,
          `    return ${n} + 1@${p};`,
          `}`,
          `function ${n}f@${p}() {`,
          `    return ${n}g();`,
          `}`,
          `const ${n}: integer@${p} = ${n}f();`,
        );
        break;
      // A local function uses only constants at its own location
      // (spec §local-function-strict-location-rule).
      case "localFunctionUsesConstantElsewhere":
        lines.push(
          `const ${n}: integer@${q} = 1@${q};`,
          `function ${n}f@${p}(): integer@${p} {`,
          `    return ${n};`,
          `}`,
        );
        break;
      // Strict mode: an omission that would be `dyn` is an error (spec §strict-mode).
      case "transferLetOmittedDestinationStrict":
        lines.push(`let ${n}: integer <- 1@${p};`);
        break;
      case "omittedParameterLocationStrict":
        lines.push(`function ${n}(a: integer): void {`, `    return;`, `}`);
        break;
      case "incompatibleInferredReturnLocationsStrict":
      case "partialReturnIncompatibleStrict": {
        const annotation = id === "partialReturnIncompatibleStrict" ? ": integer" : "";
        lines.push(
          `function ${n}(c: boolean@every)${annotation} {`,
          `    if (c) {`,
          `        return 1@${p};`,
          `    } else {`,
          `        return 1@${q};`,
          `    }`,
          `}`,
        );
        break;
      }
      default:
        return false;
    }

    for (const line of lines) {
      this.emit(indent, line);
    }
    this.injected = { id, context: this.injectionContext(ctx) };
    return true;
  }
}

// ---------------------------------------------------------------------------
// Deliberate rule violations, for mutation fuzzing.
//
// Each one is emitted from the generator's own type and location environment,
// so the violation is guaranteed real rather than an accident of text editing.
// A program carrying one must be rejected; if it compiles, that is a soundness
// hole, and the context it was injected into says where the rule stops holding.
// ---------------------------------------------------------------------------

export interface ViolationInfo {
  readonly id: string;
  /** The rule the injected program breaks. Checked against spec.md by the compiler. */
  readonly spec: SpecId;
  /**
   * Compile with `"implicitDyn": false` (spec §strict-mode). The
   * violation is an omission that the default mode reads as `dyn`. It is
   * never built in a local function, whatever {@link where} says: an omission
   * there is the function's location in either mode (spec §local-function-location-inference).
   */
  readonly strict?: true;
  /**
   * Prose the rejection must mention, for violations whose diagnostic does not
   * cite `spec` yet, or where one section covers several of them. Empty means
   * the citation is the whole test.
   */
  readonly expect: readonly string[];
  /**
   * Where the violation can be built: in a choreography context, in a local
   * function body, or at top level only. Anywhere when absent, except where
   * {@link strict} rules out a local function body.
   */
  readonly where?: "choreography" | "local" | "topLevel";
}

export const VIOLATIONS: readonly ViolationInfo[] = [
  { id: "binaryMixedLocation", where: "choreography", spec: "operators", expect: ["same location"] },
  { id: "binaryEveryWithIndividual", where: "choreography", spec: "operators", expect: ["same location"] },
  { id: "assignAcrossLocations", where: "choreography", spec: "invalid-assignment-across-locations", expect: ["transfer instead"] },
  { id: "transferBaseMismatch", spec: "invalid-transfer-base-type", expect: ["transfer type mismatch"] },
  { id: "transferArrayElementMismatch", spec: "invalid-transfer-base-type", expect: ["transfer type mismatch"] },
  { id: "numericAssignMismatch", spec: "type-mismatch", expect: ["cannot assign integer"] },
  { id: "transferNumericWidening", spec: "invalid-transfer-base-type", expect: ["transfer type mismatch"] },
  { id: "mixedNumericArithmetic", spec: "invalid-arithmetic-or-logical-operand", expect: ["same numeric type"] },
  { id: "mixedNumericComparison", spec: "invalid-comparison-or-equality-operands", expect: ["same numeric type"] },
  { id: "conversionNonNumericOperand", spec: "invalid-numeric-conversion", expect: ["requires an integer or float operand"] },
  { id: "conversionArrayOperand", spec: "invalid-numeric-conversion", expect: ["requires an integer or float operand"] },
  { id: "conversionLocatedTarget", spec: "invalid-numeric-conversion", expect: ["carries no location"] },
  { id: "ifConditionWrongLocation", spec: "invalid-if-condition", expect: ["condition", "not usable in local function"] },
  { id: "whileConditionWrongLocation", spec: "invalid-while-condition", expect: ["condition", "not usable in local function"] },
  { id: "forConditionWrongLocation", spec: "invalid-for-condition", expect: ["condition", "not usable in local function"] },
  { id: "everyValueInLocalFunction", where: "local", spec: "invalid-value-used-inside-local-function", expect: ["local function", "every"] },
  { id: "otherLocationInLocalFunction", where: "local", spec: "invalid-value-used-inside-local-function", expect: ["local function", "location"] },
  { id: "arrayInvariance", spec: "array-type-invariance", expect: ["cannot assign integer[]", "invarian"] },
  { id: "arrayLiteralInvariance", spec: "array-type-invariance", expect: ["cannot assign integer[]"] },
  { id: "everyArrayToIndividual", where: "choreography", spec: "err-every-array-assignment", expect: ["use a transfer instead", "cannot assign"] },
  { id: "arrayEquality", spec: "invalid-array-equality", expect: ["array", "equal"] },
  { id: "arrayIndexWrongLocation", where: "choreography", spec: "invalid-array-index-location", expect: ["index"] },
  { id: "pushWrongElementType", spec: "invalid-push-element-type", expect: ["cannot assign float", "push", "element"] },
  { id: "voidVariable", spec: "invalid-use-of-void", expect: ["void"] },
  { id: "reservedRuntimeName", spec: "function-names", expect: ["reserved runtime name"] },
  { id: "unaryArrayOperand", spec: "invalid-unary-operand", expect: [] },
  { id: "arithmeticArrayOperand", spec: "invalid-arithmetic-or-logical-operand", expect: [] },
  { id: "comparisonArrayOperand", spec: "invalid-comparison-or-equality-operands", expect: [] },
  { id: "logicalArrayOperand", spec: "invalid-arithmetic-or-logical-operand", expect: [] },
  {
    id: "voidEquality",
    spec: "invalid-comparison-or-equality-operands",
    expect: ["requires operands that produce a value"],
  },
  {
    id: "pushAsExpression",
    spec: "invalid-use-of-void",
    expect: ["cannot assign void", "produces no value"],
  },
  { id: "printAsValue", spec: "invalid-use-of-void", expect: ["produces no value"] },
  { id: "printVoidArgument", spec: "invalid-use-of-void", expect: ["produces no value"] },
  { id: "printArity", spec: "invalid-print-call", expect: ["takes exactly one argument"] },
  { id: "reservedCompilerPrefix", spec: "function-names", expect: ["reserved runtime name"] },
  { id: "voidValue", spec: "invalid-use-of-void", expect: ["produces no value"] },
  { id: "arrayLiteralWithLocatedElements", spec: "array-literal-without-required-location", expect: ["location annotation required"], strict: true },
  { id: "transferDestinationInLocalFunction", where: "local", spec: "local-function-strict-location-rule", expect: ["variable type must be located at"] },
  { id: "missingReturnValue", spec: "missing-return-in-a-non-void-function", expect: [] },
  { id: "unknownEndpoint", spec: "unknown-endpoint", expect: ["nosuchendpoint"] },
  { id: "unsupportedEquality", spec: "unsupported-equality-operators", expect: ["'=='"] },
  { id: "duplicateInScope", spec: "variable-scope", expect: ["already", "duplicate", "redeclar"] },
  {
    id: "endpointNameAsVariable",
    spec: "err-name-already-held",
    expect: ["is an endpoint name and cannot be used as a"],
  },
  {
    id: "functionNameAsVariable",
    spec: "err-name-already-held",
    expect: ["is a function name and cannot be used as a"],
  },
  { id: "arrayLiteralWithoutLocation", spec: "array-literal-without-required-location", expect: ["location"], strict: true },
  { id: "nestedArray", spec: "nested-array", expect: ["nested", "array"] },
  { id: "typeMismatch", spec: "type-mismatch", expect: ["cannot assign boolean"] },
  { id: "uninitializedLet", spec: "uninitialized-let", expect: ["=", "<-"] },
  { id: "literalWithoutLocation", spec: "location-annotation-omission", expect: ["location"], strict: true },
  { id: "emptyArrayWithoutType", spec: "cannot-infer-empty-array-element-type", expect: ["element type", "empty"] },
  { id: "stringArray", spec: "unsupported-array-element-type", expect: ["array element type"] },
  { id: "breakStatement", spec: "err-break-and-continue", expect: ["break"] },
  { id: "transferLetWithoutAnnotation", spec: "transfer-let-without-type-annotation", expect: ["type annotation required for transfer let"] },
  // Call sites: argument checking and the two call-legality rules.
  { id: "argumentLocationMismatch", spec: "invalid-function-argument-location", expect: ["argument", "not usable in local function"] },
  { id: "everyArrayArgumentToIndividual", where: "choreography", spec: "err-every-array-argument", expect: ["argument", "every", "cannot"] },
  { id: "crossEndpointLocalCall", where: "local", spec: "calling-another-endpoints-local-function", expect: ["cannot call"] },
  { id: "choreographyCallFromLocal", where: "local", spec: "calling-choreography-from-local", expect: ["cannot call choreography function"] },
  // Gradual locating (spec §dyn). None of these needs the generator's own
  // `dyn` mode: each writes its `dyn` out.
  { id: "dynValueInLocalFunction", where: "local", spec: "dyn-in-a-local-function", expect: [] },
  { id: "dynVariableInLocalFunction", where: "local", spec: "dyn-in-a-local-function", expect: [] },
  { id: "dynArrayLiteralInLocalFunction", where: "local", spec: "dyn-in-a-local-function", expect: [] },
  { id: "dynFunctionLocation", where: "topLevel", spec: "dyn-on-a-function-declaration", expect: [] },
  { id: "dynNumericAssignMismatch", where: "choreography", spec: "type-mismatch", expect: ["cannot assign integer"] },
  { id: "dynTransferNumericWidening", where: "choreography", spec: "invalid-transfer-base-type", expect: ["transfer type mismatch"] },
  { id: "dynMixedNumericArithmetic", where: "choreography", spec: "invalid-arithmetic-or-logical-operand", expect: ["same numeric type"] },
  { id: "dynArrayInvariance", where: "choreography", spec: "array-type-invariance", expect: ["cannot assign integer[]"] },
  { id: "dynIndexAssignMixedConcrete", where: "choreography", spec: "element-assignment-across-locations", expect: [] },
  { id: "dynArrayLiteralMixedConcrete", where: "choreography", spec: "array-literal-elements-across-locations", expect: [] },
  { id: "assignToConst", spec: "assignment-to-a-constant", expect: ["constant"] },
  { id: "transferToConst", spec: "assignment-to-a-constant", expect: ["constant"] },
  { id: "constantUsedBeforeInitialization", where: "topLevel", spec: "constant-used-before-initialization", expect: ["cannot be called here"] },
  { id: "constantInitializerUsesItself", where: "topLevel", spec: "constant-used-before-initialization", expect: ["cannot be called here"] },
  { id: "localFunctionUsesConstantElsewhere", where: "topLevel", spec: "invalid-value-used-inside-local-function", expect: ["not usable in local function"] },
  { id: "transferLetOmittedDestinationStrict", where: "choreography", spec: "transfer-let-does-not-infer-destination-type", expect: [], strict: true },
  { id: "omittedParameterLocationStrict", where: "topLevel", spec: "location-annotation-omission", expect: ["location annotation required"], strict: true },
  { id: "incompatibleInferredReturnLocationsStrict", where: "topLevel", spec: "incompatible-inferred-return-locations", expect: [], strict: true },
  { id: "partialReturnIncompatibleStrict", where: "topLevel", spec: "incompatible-inferred-return-locations", expect: [], strict: true },
];

export const VIOLATION_IDS: readonly string[] = VIOLATIONS.map((v) => v.id);

function violationInfo(id: string | undefined): ViolationInfo | undefined {
  return VIOLATIONS.find((v) => v.id === id);
}

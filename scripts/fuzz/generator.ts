/**
 * Random well-typed ChoreoBS program generator (spec §5–§8).
 *
 * The generator is written to only ever emit programs the specification says
 * are well typed, so that a type error from the compiler is itself a finding:
 * either the generator misreads a rule, or the checker does.
 */

export type Base = "integer" | "float" | "boolean" | "string";

export interface Ty {
  readonly base: Base;
  readonly isArray: boolean;
}

/** An endpoint name, or `every`. */
export type Loc = string;

interface Binding {
  readonly name: string;
  readonly ty: Ty;
  readonly loc: Loc;
  /** Block nesting level the binding was declared at, for shadowing (spec §6.4). */
  readonly depth: number;
}

interface FnSig {
  readonly name: string;
  /** `undefined` for a choreography function (spec §10.1). */
  readonly at?: string;
  readonly params: readonly Binding[];
  /** `undefined` means the function returns `void` (spec §7.3). */
  readonly ret?: { readonly ty: Ty; readonly loc: Loc };
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
}

export interface GeneratedProgram {
  readonly seed: number;
  readonly endpoints: readonly string[];
  readonly source: string;
  /** Language features this program actually exercises, for coverage reporting. */
  readonly features: readonly string[];
  /** Where the requested violation landed, if one was requested and injected. */
  readonly injected?: { readonly id: string; readonly context: string };
}

/** Array element types are restricted to these (spec §7.11.1, §16.29). */
const ARRAY_BASES: readonly Base[] = ["integer", "float", "boolean"];
const ALL_BASES: readonly Base[] = ["integer", "float", "boolean", "string"];

/** Violations whose shape needs at least two functions in the program. */
const NEEDS_TWO_FUNCTIONS = new Set([
  "crossEndpointLocalCall",
  "choreographyCallFromLocal",
  "shortCircuitChoreographyCall",
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

/** spec §7.5: `integer <: float`, plus reflexivity. Arrays are invariant (§7.11.1). */
function subtypesOf(ty: Ty): readonly Ty[] {
  if (ty.isArray) {
    return [ty];
  }
  if (ty.base === "float") {
    return [{ base: "float", isArray: false }, { base: "integer", isArray: false }];
  }
  return [ty];
}

export function generate(options: GenOptions): GeneratedProgram {
  return new Generator(options).run();
}

/**
 * Every prefix the generator mints names with: variables (`declareName`,
 * `genFor`), parameters, and the violation temporaries. Function names use
 * `f<n>` from their own counter.
 */
const GENERATED_NAME = /^(?:v|t|i|p|bad|f)\d+$/;

/** Identifiers the violation cases emit verbatim. */
const GENERATED_LITERAL_NAMES = ["sendInteger", "nosuchendpoint"];

/**
 * Rejects an endpoint set the generator cannot safely generate against.
 *
 * Endpoints, functions and variables share one name space (spec §6.1), so an
 * endpoint named like something the generator mints — `f1`, `v2`, the
 * `sendInteger` it uses for the reserved-name violation — would make its
 * *valid* programs violate §6.1 or §6.2. `run.ts` would then report those
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
          `pick one that is not <v|t|i|p|bad|f><digits> or ` +
          `${GENERATED_LITERAL_NAMES.join("/")} (spec §6.1)`,
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

  constructor(private readonly options: GenOptions) {
    this.rng = mulberry32(options.seed);
    this.endpoints = options.endpoints;
    this.maxExprDepth = options.maxExprDepth ?? 3;
    this.maxBlockDepth = options.maxBlockDepth ?? 2;
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
    for (let i = 0; i < functionCount; i += 1) {
      this.genFunction();
    }
    const statementCount = this.int(1, this.options.maxTopStatements ?? 8);
    const scope: Binding[] = [];
    for (let i = 0; i < statementCount; i += 1) {
      this.genStatement(scope, { kind: "choreography" }, 0, "");
    }
    return {
      seed: this.options.seed,
      endpoints: this.endpoints,
      source: this.lines.join("\n") + "\n",
      features: [...this.features],
      injected: this.injected,
    };
  }

  // --- randomness helpers ----------------------------------------------

  private int(min: number, max: number): number {
    return min + Math.floor(this.rng() * (max - min + 1));
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
   * declaration shadows it (spec §6.4). The shadowed binding is dropped from
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
   * its own endpoint, never `every` or another endpoint (spec §8.2).
   */
  private someLocation(ctx: Ctx): Loc {
    if (ctx.kind === "local") {
      return ctx.endpoint;
    }
    return this.pick([...this.endpoints, "every"]);
  }

  private someType(allowArray = true): Ty {
    if (allowArray && this.chance(0.25)) {
      return { base: this.pick(ARRAY_BASES), isArray: true };
    }
    return { base: this.pick(ALL_BASES), isArray: false };
  }

  private formatType(ty: Ty, loc: Loc): string {
    return `${ty.base}${ty.isArray ? "[]" : ""}@${loc}`;
  }

  // --- coverage ---------------------------------------------------------

  /** spec §7.8: the location pair decides how a transfer is carried out. */
  private transferMode(src: Loc, dst: Loc): "localCopy" | "broadcast" | "direct" {
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
    return `${this.bareLiteral(base)}@${loc}`;
  }

  /** Array literal elements carry no location of their own (spec §5.16). */
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

  /**
   * `callFree` forbids choreography calls anywhere below this point. It is set
   * inside `&&` / `||` operands, where spec §16.46 rejects them: the endpoints
   * that do not hold the result cannot know whether the operand was evaluated.
   */
  private genExpr(
    ty: Ty,
    loc: Loc,
    scope: readonly Binding[],
    ctx: Ctx,
    depth: number,
    callFree = false,
  ): string {
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
      this.addCompoundChoices(choices, ty, loc, scope, ctx, depth, callFree);
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
    callFree: boolean,
  ): void {
    const next = depth + 1;
    const sub = (t: Ty) => this.genExpr(t, loc, scope, ctx, next, callFree);
    const subCallFree = (t: Ty) => this.genExpr(t, loc, scope, ctx, next, true);

    if (!ty.isArray) {
      // Index access: xs[i] where xs : T[]@loc (spec §7.11.1).
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

    if (!ty.isArray && (ty.base === "integer" || ty.base === "float")) {
      // Both operands at the same location; result is there too (spec §7.11).
      choices.push(() => `(${sub(ty)} ${this.pick(["+", "-", "*"])} ${sub(ty)})`);
    }

    if (!ty.isArray && ty.base === "string") {
      choices.push(() => `(${sub(ty)} + ${sub(ty)})`);
    }

    if (!ty.isArray && ty.base === "boolean") {
      choices.push(() => {
        const numeric: Ty = { base: this.pick(["integer", "float"] as const), isArray: false };
        return `(${sub(numeric)} ${this.pick(["<", "<=", ">", ">="])} ${sub(numeric)})`;
      });
      choices.push(
        () =>
          `(${subCallFree(BOOLEAN)} ${this.pick(["&&", "||"])} ${subCallFree(BOOLEAN)})`,
      );
      choices.push(() => `!(${sub(BOOLEAN)})`);
      choices.push(() => {
        // `===` / `!==` are undefined for array types (spec §7.11.1).
        const operand: Ty = { base: this.pick(ALL_BASES), isArray: false };
        return `(${sub(operand)} ${this.pick(["===", "!=="])} ${sub(operand)})`;
      });
    }

    const callable = this.fns.filter(
      (f) =>
        this.callableFrom(f, ctx) &&
        !(callFree && f.at === undefined) &&
        f.ret !== undefined &&
        sameTy(f.ret.ty, ty) &&
        f.ret.loc === loc,
    );
    if (callable.length > 0) {
      choices.push(() =>
        this.genCall(this.pick(callable), scope, ctx, next, callFree),
      );
    }
  }

  private arrayLiteral(ty: Ty, loc: Loc): string {
    const size = this.int(1, 3);
    const elements: string[] = [];
    for (let i = 0; i < size; i += 1) {
      elements.push(this.bareLiteral(ty.base));
    }
    return `[${elements.join(", ")}]@${loc}`;
  }

  /**
   * spec §10.2, §10.3: a choreography context may call anything; a local
   * function may only call local functions at its own endpoint.
   */
  private callableFrom(fn: FnSig, ctx: Ctx): boolean {
    if (ctx.kind === "choreography") {
      return true;
    }
    return fn.at === ctx.endpoint;
  }

  private genCall(
    fn: FnSig,
    scope: readonly Binding[],
    ctx: Ctx,
    depth: number,
    callFree = false,
  ): string {
    const args = fn.params.map((p) =>
      this.genExpr(p.ty, p.loc, scope, ctx, depth, callFree),
    );
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
    // with its own location annotation (spec §7.11.1).
    const init =
      ty.isArray && this.chance(0.15)
        ? `[]@${loc}`
        : this.genExpr(
            this.pick(subtypesOf(ty)),
            loc,
            scope,
            ctx,
            1,
          );
    if (ty.isArray && init === `[]@${loc}`) {
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
    const init = this.genExpr(ty, loc, scope, ctx, 1);
    this.emit(indent, `let ${name} = ${init};`);
    scope.push({ name, ty, loc, depth });
  }

  /** `let y: T2@L2 <- e;` — needs `T1 <: T2`, locations unrestricted (spec §7.8). */
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
    const sourceTy = this.pick(subtypesOf(ty));
    const source = this.genExpr(sourceTy, src, scope, ctx, 1);
    this.recordTransfer(src, dst, ty);
    this.emit(indent, `let ${name}: ${this.formatType(ty, dst)} <- ${source};`);
    scope.push({ name, ty, loc: dst, depth });
  }

  private genAssignment(
    scope: Binding[],
    ctx: Ctx,
    indent: string,
    depth: number,
  ): void {
    const target = this.pickBinding(scope, () => true);
    if (target === undefined) {
      return this.genLetAnnotated(scope, ctx, indent, depth);
    }
    const value = this.genExpr(
      this.pick(subtypesOf(target.ty)),
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
    const target = this.pickBinding(scope, () => true);
    if (target === undefined) {
      return this.genLetAnnotated(scope, ctx, indent, depth);
    }
    const src = this.someLocation(ctx);
    const source = this.genExpr(
      this.pick(subtypesOf(target.ty)),
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
      this.pick(subtypesOf(element)),
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
      this.pick(subtypesOf(element)),
      target.loc,
      scope,
      ctx,
      2,
    );
    this.features.add("array:push");
    this.emit(indent, `${target.name}.push(${value});`);
  }

  private genCallStatement(
    scope: Binding[],
    ctx: Ctx,
    indent: string,
    depth: number,
  ): void {
    const callable = this.fns.filter((f) => this.callableFrom(f, ctx));
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

  /** Conditions must be `boolean` at the context's location (spec §7.9, §7.10). */
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
    const loc = this.ctxLocation(ctx);
    const i = this.fresh("i");
    const bound = this.int(1, 5);
    this.emit(
      indent,
      `for (let ${i}: integer@${loc} = 0@${loc}; ${i} < ${bound}@${loc}; ${i} = ${i} + 1@${loc}) {`,
    );
    const inner: Binding[] = [
      ...scope,
      { name: i, ty: INTEGER, loc, depth: blockDepth + 1 },
    ];
    this.within("for", () =>
      this.genBlock(inner, ctx, blockDepth + 1, indent + "    "),
    );
    this.emit(indent, `}`);
  }

  /** Bindings declared inside a block do not escape it (spec §6.4). */
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

  /** Violations that can only be broken inside a local function body (spec §8.2). */
  private static readonly LOCAL_ONLY_VIOLATIONS = new Set([
    "everyValueInLocalFunction",
    "otherLocationInLocalFunction",
    "transferDestinationInLocalFunction",
  ]);

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
    if (violation === "shortCircuitChoreographyCall") {
      // Needs a choreography function to call, and a choreography context to
      // call it from.
      return false;
    }
    if (violation === "choreographyCallFromLocal") {
      // The first function is the choreography one; later ones are local, so
      // the injection site can call it from a local body.
      return this.fns.length > 0;
    }
    if (
      violation === "crossEndpointLocalCall" ||
      Generator.LOCAL_ONLY_VIOLATIONS.has(violation)
    ) {
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
    // function body is its own scope (spec §6.4, §6.6).
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

    const returnsValue = this.chance(0.6);
    const ret = returnsValue
      ? { ty: this.someType(), loc: this.someLocation(ctx) }
      : undefined;

    // The return type may be omitted; the single trailing return makes it
    // inferable, and nothing generated here is recursive (spec §7.14.4, §7.14.8).
    const omitReturnType = this.chance(0.3);
    if (omitReturnType) {
      this.features.add("function:inferred return type");
    }
    this.features.add(at === undefined ? "function:choreography" : "function:local");

    const annotation = omitReturnType
      ? ""
      : `: ${ret === undefined ? "void" : this.formatType(ret.ty, ret.loc)}`;
    const header =
      `function ${name}${at === undefined ? "" : `@${at}`}` +
      `(${params.map((p) => `${p.name}: ${this.formatType(p.ty, p.loc)}`).join(", ")})` +
      `${annotation} {`;

    this.emit("", header);
    this.within(at === undefined ? "choreography-fn" : "local-fn", () => {
      const scope: Binding[] = [...params];
      const count = this.int(0, 3);
      for (let i = 0; i < count; i += 1) {
        this.genStatement(scope, ctx, 1, "    ");
      }
      // §16.41: a written non-`void` return type with no return at all. Only
      // possible when the type is written, since an omitted one would infer
      // `void` instead of failing coverage (spec §7.14.4).
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
      } else {
        this.emit("    ", `return ${this.genExpr(ret.ty, ret.loc, scope, ctx, 1)};`);
      }
    });
    this.emit("", `}`);
    this.emit("", ``);
    this.counter = savedCounter;

    // Registered only after its body is generated, so no function can call
    // itself or a later one: recursion is banned for choreography functions
    // and needs an explicit return type otherwise (spec §10.4, §7.14.8).
    this.fns.push({ name, at, params, ret });
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
    // A location a condition may not sit at, here (spec §7.9, §7.10).
    const condBad = choreography ? p : "every";
    const here = this.ctxLocation(ctx);
    const n = this.fresh("bad");
    const lines: string[] = [];

    switch (id) {
      case "binaryMixedLocation":
        if (!choreography) return false;
        lines.push(`let ${n}: integer@${p} = 1@${p} + 2@${q};`);
        break;
      case "binaryEveryWithIndividual":
        if (!choreography) return false;
        lines.push(`let ${n}: integer@every = 1@every + 2@${p};`);
        break;
      case "assignAcrossLocations":
        if (!choreography) return false;
        lines.push(`let ${n}: integer@${p} = 1@${p};`);
        lines.push(`let ${n}b: integer@${q} = ${n};`);
        break;
      case "transferBaseMismatch":
        lines.push(`let ${n}: integer@${p} <- 1.5@${choreography ? q : p};`);
        break;
      case "transferArrayElementMismatch":
        lines.push(`let ${n}: float[]@${p} <- [1, 2]@${choreography ? q : p};`);
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
        if (choreography) return false;
        lines.push(`let ${n}: integer@every = 1@every;`);
        break;
      case "otherLocationInLocalFunction":
        if (choreography) return false;
        lines.push(`let ${n}: integer@${q} = 1@${q};`);
        break;
      case "arrayInvariance":
        lines.push(`let ${n}: integer[]@${p} = [1, 2]@${p};`);
        lines.push(`let ${n}b: float[]@${p} = ${n};`);
        break;
      case "everyArrayToIndividual":
        if (!choreography) return false;
        lines.push(`let ${n}: integer[]@every = [1, 2]@every;`);
        lines.push(`let ${n}b: integer[]@${p} = ${n};`);
        break;
      case "arrayEquality":
        lines.push(`let ${n}: integer[]@${p} = [1]@${p};`);
        lines.push(`let ${n}b: boolean@${p} = ${n} === ${n};`);
        break;
      case "arrayIndexWrongLocation":
        if (!choreography) return false;
        lines.push(`let ${n}: integer[]@${p} = [1, 2]@${p};`);
        lines.push(`${n}[0@${q}] = 1@${p};`);
        break;
      case "pushWrongElementType":
        lines.push(`let ${n}: integer[]@${p} = [1]@${p};`);
        lines.push(`${n}.push(1.5@${p});`);
        break;
      case "voidEquality":
        // Two void computations share a base type, so the same-base-type rule
        // does not stop them (spec §16.43).
        lines.push(`let ${n}: integer[]@${p} = [1]@${p};`);
        lines.push(
          `let ${n}b: boolean@${p} = ${n}.push(1@${p}) === ${n}.push(2@${p});`,
        );
        break;
      case "pushAsExpression":
        lines.push(`let ${n}: integer[]@${p} = [1]@${p};`);
        lines.push(`let ${n}b: integer@${p} = ${n}.push(1@${p});`);
        break;
      case "voidValue": {
        // The annotated form is caught by §16.40; this is the inferred path,
        // where the `let` takes its type straight from the initializer.
        const target = this.fns.find(
          (f) =>
            f.ret === undefined &&
            (choreography ? f.at === undefined : f.at === ctx.endpoint),
        );
        if (target === undefined) return false;
        const args = target.params.map((param) =>
          this.genExpr(param.ty, param.loc, scope, ctx, 2),
        );
        lines.push(`let ${n} = ${target.name}(${args.join(", ")});`);
        break;
      }
      case "reservedCompilerPrefix":
        lines.push(`let __transfer_0: integer@${p} = 1@${p};`);
        break;
      case "arrayLiteralWithLocatedElements":
        // Every element is located, but the literal itself still needs its own
        // annotation (spec §5.16).
        lines.push(`let ${n}: integer@${p} = 1@${p};`);
        lines.push(`let ${n}b = [${n}, ${n}];`);
        break;
      case "voidVariable":
        lines.push(`let ${n}: void@${p} = 1@${p};`);
        break;
      case "reservedRuntimeName":
        // The emitted BlueScript keeps the source name (spec §13.3), so this
        // variable would shadow the runtime send API.
        lines.push(`let sendInteger: integer@${p} = 1@${p};`);
        break;
      case "unaryArrayOperand":
        lines.push(`let ${n}: boolean[]@${p} = [true, false]@${p};`);
        lines.push(`let ${n}b: boolean@${p} = !${n};`);
        break;
      case "transferDestinationInLocalFunction":
        // Legal in a choreography context; inside `function@p` the destination
        // is a variable of that body and must be at `p` (spec §8.2).
        if (choreography) return false;
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
        // Endpoints, functions and variables share one name space (spec §6.1),
        // so a declared endpoint's name is not available to a variable. `q` is
        // deliberately not the location written after `@`, matching the
        // example in spec §16.48.
        lines.push(`let ${q}: integer@${p} = 1@${p};`);
        break;
      case "functionNameAsVariable": {
        // `fns` holds the functions emitted above this point. Not filtered by
        // `callableFrom`: a conflict with a local function at another endpoint
        // is an error all the same, because the rule is stated over the whole
        // program and not per output file (spec §6.1).
        const taken = this.fns[0];
        if (taken === undefined) return false;
        lines.push(`let ${taken.name}: integer@${p} = 1@${p};`);
        break;
      }
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
      case "literalWithoutLocation":
        // Locations are never inferred from the expected type (spec §8.1).
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
        if (!choreography) return false;
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
        if (choreography) return false;
        const target = this.fns.find(
          (f) => f.at !== undefined && f.at !== ctx.endpoint,
        );
        if (target === undefined) return false;
        const args = target.params.map((param) =>
          this.genExpr(param.ty, param.loc, scope, ctx, 2),
        );
        lines.push(`${target.name}(${args.join(", ")});`);
        break;
      }
      case "shortCircuitChoreographyCall": {
        // The endpoints that do not hold the result cannot know whether the
        // short-circuited operand ran, so a choreography call is banned from
        // both operands (spec §16.46). It has to be a choreography context:
        // a local function may not call one at all, which §16.13 catches first.
        if (!choreography) return false;
        const target = this.fns.find(
          (f) => f.at === undefined && f.ret !== undefined && !f.ret.ty.isArray,
        );
        if (target === undefined || target.ret === undefined) return false;
        const loc = target.ret.loc;
        const callOf = () =>
          `${target.name}(${target.params
            .map((param) => this.genExpr(param.ty, param.loc, scope, ctx, 2))
            .join(", ")})`;
        // `&&` needs boolean operands at one location (spec §7.11); a call that
        // does not already return boolean is compared with itself to get one.
        const operand =
          target.ret.ty.base === "boolean"
            ? callOf()
            : `(${callOf()} === ${callOf()})`;
        lines.push(`let ${n}: boolean@${loc} = (true@${loc} && ${operand});`);
        break;
      }
      case "choreographyCallFromLocal": {
        if (choreography) return false;
        const target = this.fns.find((f) => f.at === undefined);
        if (target === undefined) return false;
        const args = target.params.map((param) =>
          this.genExpr(param.ty, param.loc, scope, ctx, 2),
        );
        lines.push(`${target.name}(${args.join(", ")});`);
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
  readonly spec: string;
  /** The rejection must mention one of these. */
  readonly expect: readonly string[];
}

export const VIOLATIONS: readonly ViolationInfo[] = [
  { id: "binaryMixedLocation", spec: "§7.11", expect: ["same location"] },
  { id: "binaryEveryWithIndividual", spec: "§7.11", expect: ["same location"] },
  { id: "assignAcrossLocations", spec: "§16.7", expect: ["transfer instead"] },
  { id: "transferBaseMismatch", spec: "§16.8", expect: ["transfer type mismatch"] },
  { id: "transferArrayElementMismatch", spec: "§16.8", expect: ["transfer type mismatch"] },
  { id: "ifConditionWrongLocation", spec: "§16.9", expect: ["condition", "not usable in local function"] },
  { id: "whileConditionWrongLocation", spec: "§16.10", expect: ["condition", "not usable in local function"] },
  { id: "forConditionWrongLocation", spec: "§16.11", expect: ["condition", "not usable in local function"] },
  { id: "everyValueInLocalFunction", spec: "§16.27", expect: ["local function", "every"] },
  { id: "otherLocationInLocalFunction", spec: "§16.27", expect: ["local function", "location"] },
  { id: "arrayInvariance", spec: "§16.33", expect: ["cannot assign integer[]", "invarian"] },
  { id: "everyArrayToIndividual", spec: "§16.34", expect: ["use a transfer instead", "cannot assign"] },
  { id: "arrayEquality", spec: "§16.36", expect: ["array", "equal"] },
  { id: "arrayIndexWrongLocation", spec: "§16.37", expect: ["index"] },
  { id: "pushWrongElementType", spec: "§16.38", expect: ["cannot assign float", "push", "element"] },
  { id: "voidVariable", spec: "§16.40", expect: ["void"] },
  { id: "reservedRuntimeName", spec: "§6.2", expect: ["reserved runtime name"] },
  { id: "unaryArrayOperand", spec: "§16.42", expect: ["§16.42"] },
  {
    id: "voidEquality",
    spec: "§16.43",
    expect: ["requires operands that produce a value"],
  },
  {
    id: "pushAsExpression",
    spec: "§16.40",
    expect: ["cannot assign void", "produces no value"],
  },
  { id: "reservedCompilerPrefix", spec: "§6.2", expect: ["reserved runtime name"] },
  { id: "voidValue", spec: "§16.40", expect: ["produces no value"] },
  { id: "arrayLiteralWithLocatedElements", spec: "§16.31", expect: ["location annotation required"] },
  { id: "transferDestinationInLocalFunction", spec: "§8.2", expect: ["variable type must be located at"] },
  { id: "missingReturnValue", spec: "§16.41", expect: ["§16.41"] },
  { id: "unknownEndpoint", spec: "§16.1", expect: ["nosuchendpoint"] },
  { id: "unsupportedEquality", spec: "§16.17", expect: ["'=='"] },
  { id: "duplicateInScope", spec: "§6.4", expect: ["already", "duplicate", "redeclar"] },
  {
    id: "endpointNameAsVariable",
    spec: "§16.48",
    expect: ["is an endpoint name and cannot be used as a"],
  },
  {
    id: "functionNameAsVariable",
    spec: "§16.48",
    expect: ["is a function name and cannot be used as a"],
  },
  { id: "arrayLiteralWithoutLocation", spec: "§16.31", expect: ["location"] },
  { id: "nestedArray", spec: "§16.30", expect: ["nested", "array"] },
  { id: "typeMismatch", spec: "§16.6", expect: ["cannot assign boolean"] },
  { id: "uninitializedLet", spec: "§16.5", expect: ["=", "<-"] },
  { id: "literalWithoutLocation", spec: "§16.3", expect: ["location"] },
  { id: "emptyArrayWithoutType", spec: "§16.32", expect: ["element type", "empty"] },
  { id: "stringArray", spec: "§16.29", expect: ["array element type"] },
  { id: "breakStatement", spec: "§16.16", expect: ["break"] },
  { id: "transferLetWithoutAnnotation", spec: "§16.18", expect: ["type annotation required for transfer let"] },
  // Call sites: argument checking and the two call-legality rules.
  { id: "argumentLocationMismatch", spec: "§16.28", expect: ["argument", "not usable in local function"] },
  { id: "everyArrayArgumentToIndividual", spec: "§16.35", expect: ["argument", "every", "cannot"] },
  { id: "crossEndpointLocalCall", spec: "§16.12", expect: ["cannot call"] },
  { id: "choreographyCallFromLocal", spec: "§16.13", expect: ["cannot call choreography function"] },
  {
    id: "shortCircuitChoreographyCall",
    spec: "§16.46",
    expect: ["must not contain a call to choreography function"],
  },
];

export const VIOLATION_IDS: readonly string[] = VIOLATIONS.map((v) => v.id);

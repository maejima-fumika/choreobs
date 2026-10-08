/**
 * The configurations a benchmark is measured in: which of its locations are
 * made `dyn`, and the sizes of its workload (benchmarks/README.md).
 *
 * A *dyn-able location* is a location written outside a local function,
 * after an `@` (spec §dyn): local functions can never hold `dyn`
 * (spec §local-function-strict-location-rule). The configurations of one seed
 * are nested: a seed fixes a random order of the dyn-able locations, and the
 * fraction `p` makes the first `round(p · n)` of them `dyn`. So `p` and the
 * seed name a configuration, and a larger `p` only adds to a smaller one.
 *
 * Everything here works on tokens, so comments and strings are never touched.
 */
import { tokenize, TokenKind, type Token } from "../../src/lexer/index.js";
import { localFunctionRanges } from "../shared/local-functions.js";

/** The largest integer a benchmark may hold: a BlueScript `any` keeps 30 bits (spec §array-types). */
export const MAX_WORKLOAD_VALUE = 2 ** 29 - 1;

export interface DynableLocation {
  /** Offsets of the location's name, after the `@`. */
  readonly start: number;
  readonly end: number;
  /** 1-based, for reading. */
  readonly line: number;
  readonly column: number;
  /** The location as written: an endpoint or `every`. */
  readonly text: string;
}

export interface WorkloadConstant {
  readonly name: string;
  readonly value: number;
  /** Offsets of the integer literal of its initializer. */
  readonly start: number;
  readonly end: number;
}

function tokensOf(source: string): readonly Token[] {
  const { tokens, errors } = tokenize(source);
  if (errors.length > 0) {
    throw new Error(`the program does not lex: ${errors[0]!.message}`);
  }
  return tokens;
}

/** The dyn-able locations of `source`, in source order. A location already `dyn` is not one. */
export function dynableLocations(source: string): DynableLocation[] {
  const tokens = tokensOf(source);
  const inLocal = new Set<number>();
  for (const [start, end] of localFunctionRanges(tokens)) {
    for (let i = start; i < end; i += 1) {
      inLocal.add(i);
    }
  }
  const locations: DynableLocation[] = [];
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    const at = tokens[i]!;
    const location = tokens[i + 1]!;
    if (
      at.kind !== TokenKind.At ||
      inLocal.has(i) ||
      // `import@P { … }` names where the imported functions run, not a value.
      tokens[i - 1]?.kind === TokenKind.Import ||
      (location.kind !== TokenKind.Identifier && location.kind !== TokenKind.Every)
    ) {
      continue;
    }
    locations.push({
      start: location.span.start.offset,
      end: location.span.end.offset,
      line: location.span.start.line,
      column: location.span.start.column,
      text: location.lexeme,
    });
  }
  return locations;
}

/**
 * The workload constants of `source`: each top-level
 * `let NAME: integer@every = <integer>@every;`, as every benchmark's Workload
 * section declares them (benchmarks/README.md): named in capitals, which
 * leaves out the program's own state at `every`. The initializer of a `for`
 * is not one.
 */
export function workloadConstants(source: string): WorkloadConstant[] {
  const tokens = tokensOf(source);
  const shape = [
    [TokenKind.Let, TokenKind.Const],
    [TokenKind.Identifier],
    [TokenKind.Colon],
    [TokenKind.Integer],
    [TokenKind.At],
    [TokenKind.Every],
    [TokenKind.Assign],
    [TokenKind.IntegerLiteral],
    [TokenKind.At],
    [TokenKind.Every],
    [TokenKind.Semicolon],
  ] as const;
  const constants: WorkloadConstant[] = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const kind = tokens[i]!.kind;
    if (kind === TokenKind.LBrace) depth += 1;
    if (kind === TokenKind.RBrace) depth -= 1;
    if (depth !== 0 || tokens[i - 1]?.kind === TokenKind.LParen) continue;
    const matches = shape.every((kinds, j) => (kinds as readonly string[]).includes(tokens[i + j]?.kind ?? ""));
    if (!matches) continue;
    const name = tokens[i + 1]!;
    const literal = tokens[i + 7]!;
    if (name.kind !== TokenKind.Identifier || literal.kind !== TokenKind.IntegerLiteral) continue;
    if (!/^[A-Z][A-Z0-9_]*$/.test(name.name)) continue;
    constants.push({
      name: name.name,
      value: literal.value,
      start: literal.span.start.offset,
      end: literal.span.end.offset,
    });
  }
  return constants;
}

/** A small, fast generator of numbers in [0, 1), so that a seed names the same order everywhere. */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `0 … n-1` shuffled by `seed` (Fisher–Yates). */
export function permutation(n: number, seed: number): number[] {
  const random = mulberry32(seed);
  const xs = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
  return xs;
}

/** How many of `n` locations the fraction `p` makes `dyn`. */
export function dynCount(p: number, n: number): number {
  return Math.round(p * n);
}

/** One configuration of a benchmark. `seed` is null where it does not matter: none or all of the locations. */
export interface Configuration {
  readonly seed: number | null;
  /** The fraction asked for. */
  readonly p: number;
  /** How many locations are `dyn`. */
  readonly k: number;
  readonly n: number;
}

/**
 * The configurations for `seeds` and `fractions` of a program with `n`
 * dyn-able locations, without repeats: 0 is always there, and no `dyn` at all
 * and all of them `dyn` are the same program for every seed, so they come
 * once, with no seed.
 */
export function configurations(
  n: number,
  seeds: readonly number[],
  fractions: readonly number[],
): Configuration[] {
  const all = [...new Set([0, ...fractions])].sort((a, b) => a - b);
  const out: Configuration[] = [];
  const seen = new Set<string>();
  for (const p of all) {
    const k = dynCount(p, n);
    const shared = k === 0 || k === n;
    for (const seed of shared ? [null] : seeds) {
      const key = `${seed}|${k}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ seed, p, k, n });
    }
  }
  return out;
}

/** The indices into {@link dynableLocations} that `config` makes `dyn`. */
export function dynSet(config: Configuration): ReadonlySet<number> {
  if (config.k === 0) return new Set();
  if (config.k === config.n || config.seed === null) {
    return new Set(Array.from({ length: config.n }, (_, i) => i));
  }
  return new Set(permutation(config.n, config.seed).slice(0, config.k));
}

/**
 * `source` with the locations `dyn` names made `dyn`, and the workload
 * constants `set` names given new values. Throws for a constant the program
 * does not have, and for a value outside what a benchmark may hold.
 */
export function configure(
  source: string,
  dyn: ReadonlySet<number>,
  set: ReadonlyMap<string, number> = new Map(),
): string {
  const edits: { start: number; end: number; text: string }[] = [];
  const locations = dynableLocations(source);
  for (const index of dyn) {
    const location = locations[index];
    if (location === undefined) {
      throw new Error(`there is no dyn-able location ${index}; the program has ${locations.length}`);
    }
    edits.push({ start: location.start, end: location.end, text: "dyn" });
  }
  const constants = workloadConstants(source);
  for (const [name, value] of set) {
    const constant = constants.find((c) => c.name === name);
    if (constant === undefined) {
      throw new Error(
        `the program has no workload constant ${name}; it has ${constants.map((c) => c.name).join(", ") || "none"}`,
      );
    }
    if (!Number.isInteger(value) || value < 0 || value > MAX_WORKLOAD_VALUE) {
      throw new Error(`${name}=${value}: a workload value must be an integer from 0 to ${MAX_WORKLOAD_VALUE}`);
    }
    edits.push({ start: constant.start, end: constant.end, text: String(value) });
  }
  edits.sort((a, b) => a.start - b.start);
  let out = "";
  let from = 0;
  for (const edit of edits) {
    out += source.slice(from, edit.start) + edit.text;
    from = edit.end;
  }
  return out + source.slice(from);
}

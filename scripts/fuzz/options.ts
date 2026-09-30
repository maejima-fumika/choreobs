/**
 * What `run.ts` generates for a seed, shared with `dump.ts` so that a finding
 * reproduces from its seed and flags alone.
 */
import type { GenOptions } from "./generator.js";

export interface FuzzArgs {
  readonly endpoints: readonly string[];
  readonly blockDepth: number;
  readonly maxFunctions: number;
  readonly maxTopStatements: number;
  /** Draw a random endpoint subset per seed instead of using the whole list. */
  readonly vary: boolean;
  /** Leave `@dyn` out of the generated programs (spec §dyn). */
  readonly noDyn: boolean;
}

/** The flags `run.ts` and `dump.ts` both take. */
export function parseFuzzArgs(argv: readonly string[]): FuzzArgs & {
  readonly get: (flag: string, fallback: string) => string;
} {
  const get = (flag: string, fallback: string): string => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : fallback;
  };
  return {
    get,
    endpoints: get("--endpoints", "alice,bob,carol").split(","),
    blockDepth: Number(get("--depth", "2")),
    maxFunctions: Number(get("--maxfn", "3")),
    maxTopStatements: Number(get("--maxstmt", "8")),
    vary: argv.includes("--vary"),
    noDyn: argv.includes("--no-dyn"),
  };
}

/**
 * The generator options for `seed`. Every other seed is written for strict
 * mode, with all its `dyn` spelled out (spec §strict-mode); the program records
 * which, and is compiled that way (see `GeneratedProgram.implicitDyn`).
 */
export function fuzzGenOptions(seed: number, args: FuzzArgs): GenOptions {
  const endpoints = args.vary
    ? args.endpoints.slice(0, 2 + (seed % (args.endpoints.length - 1)))
    : args.endpoints;
  const strict = !args.noDyn && seed % 2 === 0;
  return {
    seed,
    endpoints,
    maxBlockDepth: args.blockDepth,
    maxFunctions: args.maxFunctions,
    maxTopStatements: args.maxTopStatements,
    dyn: !args.noDyn,
    implicitDyn: !strict,
  };
}

/** How a program's mode is written in a finding's header. */
export function describeMode(program: { readonly implicitDyn: boolean }, args: FuzzArgs): string {
  return `${args.noDyn ? "no dyn" : "dyn"}, implicitDyn: ${program.implicitDyn}`;
}

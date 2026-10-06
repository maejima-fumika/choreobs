/**
 * Rewrites of a source that must not change what it compiles to, beyond what
 * each rewrite itself changes.
 *
 * A rewrite is applied to a program that compiles; the rewritten program must
 * compile too, and its outputs must agree with the original's as the rewrite
 * says. `run.ts` and `test/integration/fuzz.test.ts` apply every rewrite to
 * every generated program, and `test/integration/metamorphic.test.ts` to every
 * example and benchmark.
 */
import type { CompileResult } from "../../src/driver/index.js";
import { constifiedOutputProblem, constifyLets } from "./constify.js";
import { outputsKey } from "./inspect.js";
import { stripLocalFunctionLocations } from "./strip.js";

/** A source rewritten, and how its compilation must relate to the original's. */
interface Rewritten {
  readonly source: string;
  /**
   * How the outputs of `rewritten` differ from `original`'s where they must
   * not, as the rest of a sentence about the rewrite; `undefined` when they agree.
   */
  readonly compare: (original: CompileResult, rewritten: CompileResult) => string | undefined;
}

export interface Rewrite {
  /** What the rewrite does, as the subject of a finding. */
  readonly description: string;
  /** `source` rewritten; `undefined` when there is nothing in it to rewrite. */
  readonly rewrite: (source: string) => Rewritten | undefined;
}

export const REWRITES: readonly Rewrite[] = [
  {
    // A location left out inside a local function is the function's own
    // (spec §local-function-location-inference), so leaving out every location
    // written there changes nothing.
    description: "leaving out the locations inside local functions",
    rewrite: (source) => {
      const stripped = stripLocalFunctionLocations(source);
      return stripped === source
        ? undefined
        : {
            source: stripped,
            compare: (original, rewritten) =>
              outputsKey(rewritten) === outputsKey(original) ? undefined : "changed the output",
          };
    },
  },
  {
    // A `const` is a `let` that is never stored into again (spec §const-statement),
    // so declaring such variables with `const` changes nothing but the keyword
    // of their bindings.
    description: "declaring the never-stored-into variables with const",
    rewrite: (source) => {
      const { source: constified, names } = constifyLets(source);
      return names.size === 0
        ? undefined
        : {
            source: constified,
            compare: (original, rewritten) => constifiedOutputProblem(original, rewritten, names),
          };
    },
  },
];

/**
 * What `rewrite` breaks in `source`, whose compilation is `original`, as a
 * finding; `undefined` when it breaks nothing or does not apply. `compile`
 * compiles a source as `source` was compiled.
 */
export function rewriteProblem(
  rewrite: Rewrite,
  source: string,
  original: CompileResult,
  compile: (source: string) => CompileResult,
): string | undefined {
  const rewritten = rewrite.rewrite(source);
  if (rewritten === undefined) {
    return undefined;
  }
  const result = compile(rewritten.source);
  if (!result.success) {
    return `${rewrite.description} changed acceptance: ${result.errors[0]?.message ?? "(no message)"}`;
  }
  const problem = rewritten.compare(original, result);
  return problem === undefined ? undefined : `${rewrite.description} ${problem}`;
}

/** The first of {@link REWRITES} that breaks something, as {@link rewriteProblem} reports it. */
export function metamorphicProblem(
  source: string,
  original: CompileResult,
  compile: (source: string) => CompileResult,
): string | undefined {
  for (const rewrite of REWRITES) {
    const problem = rewriteProblem(rewrite, source, original, compile);
    if (problem !== undefined) {
      return problem;
    }
  }
  return undefined;
}

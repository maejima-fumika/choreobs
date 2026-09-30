import type { LogicalOperator } from "../ast/operators.js";
import { specRef } from "../spec/ref.js";

/**
 * The core helpers: the first part of the runtime file, which code generation
 * calls in every program, with or without `dyn` (spec §runtime-files,
 * §runtime-support-functions).
 *
 * Every name carries the compiler's `__` prefix, which the source language
 * reserves (spec §identifiers, §function-names), so none needs listing among
 * the reserved runtime names.
 */

/**
 * The most arguments one `nothing` helper takes. BlueScript has no rest
 * parameters, so `nothing(e1, …, en)` is emitted as calls to `__nothing1` to
 * `__nothing5` (spec §nothing-code-generation).
 */
export const MAX_NOTHING_ARITY = 5;

/** The `nothing` helper that takes `arity` arguments (spec §nothing). */
export function nothingHelper(arity: number): string {
  return `__nothing${arity}`;
}

/** `__nothing1` to `__nothing5`, in the order the runtime file declares them. */
export const NOTHING_HELPERS: readonly string[] = Array.from(
  { length: MAX_NOTHING_ARITY },
  (_, i) => nothingHelper(i + 1),
);

/**
 * `nothing(parts…)` as calls to the fixed-arity helpers
 * (spec §nothing-code-generation). Up to five parts make one call. Beyond that
 * the first five go to `__nothing5`, and the rest follow in order, up to four
 * at a time, each group making a call whose first argument is the one built so
 * far — so the parts keep their order, and with it their evaluation order.
 * `call` builds one call from a helper and its arguments.
 *
 * `parts` is never empty: cleanup folds `nothing()` into `null`
 * (spec §expression-simplification).
 */
export function nestNothing<T>(
  parts: readonly T[],
  call: (helper: string, args: readonly T[]) => T,
): T {
  if (parts.length === 0) {
    throw new Error(
      `internal error: nothing() reached code generation ${specRef("expression-simplification")}`,
    );
  }
  const first = parts.slice(0, MAX_NOTHING_ARITY);
  let built = call(nothingHelper(first.length), first);
  for (let i = MAX_NOTHING_ARITY; i < parts.length; i += MAX_NOTHING_ARITY - 1) {
    const group = parts.slice(i, i + MAX_NOTHING_ARITY - 1);
    built = call(nothingHelper(group.length + 1), [built, ...group]);
  }
  return built;
}

/**
 * The runtime helpers `&&` and `||` are emitted as (spec §logical-operator-code-generation, §and-or-helpers).
 * BlueScript's own operators short-circuit and ChoreoBS's do not, so a call —
 * which evaluates both arguments first — stands in for them.
 */
export const LOGICAL_HELPERS: Readonly<Record<LogicalOperator, string>> = {
  "&&": "__and",
  "||": "__or",
};

/** Everything a generated file may import from the core helpers, in import order (spec §runtime-import). */
export const CORE_RUNTIME_EXPORTS: readonly string[] = [
  ...NOTHING_HELPERS,
  LOGICAL_HELPERS["&&"],
  LOGICAL_HELPERS["||"],
];

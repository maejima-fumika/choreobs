import type { Location } from "./location.js";

/**
 * Where a statement or expression is executed (spec §6.5, §8, §10).
 *
 * - Top-level items use {@link CHOREOGRAPHY_CONTEXT}.
 * - A choreography function, which runs at every endpoint, uses `choreography`.
 * - `function f@alice` bodies use `local` at `alice`.
 *
 * Note this `choreography` kind is about the *execution context*; it is
 * unrelated to the `every` kind of {@link Location}, which is a value location.
 */
export type ExecutionContext =
  | { readonly kind: "choreography" }
  | { readonly kind: "local"; readonly endpoint: string };

/** Implicit context for top-level statements (spec §6.5). */
export const CHOREOGRAPHY_CONTEXT: ExecutionContext = { kind: "choreography" };

/**
 * Context for a function body, given the location written after its name.
 * `undefined` is the choreography-function form, which carries no location.
 */
export function executionContextFromLocation(
  location: Location | undefined,
): ExecutionContext {
  if (location === undefined || location.kind === "every") {
    return CHOREOGRAPHY_CONTEXT;
  }
  return { kind: "local", endpoint: location.name };
}

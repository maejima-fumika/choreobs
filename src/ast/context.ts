import type { Location } from "./location.js";

/**
 * Where a statement or expression is executed (spec §6.5, §8, §10).
 *
 * - Top-level items use {@link EVERY_CONTEXT}.
 * - `function f@every` bodies use `every`.
 * - `function f@alice` bodies use `local` at `alice`.
 */
export type ExecutionContext =
  | { readonly kind: "every" }
  | { readonly kind: "local"; readonly participant: string };

/** Implicit context for top-level statements (spec §6.5). */
export const EVERY_CONTEXT: ExecutionContext = { kind: "every" };

export function executionContextFromLocation(
  location: Location,
): ExecutionContext {
  if (location.kind === "concrete") {
    return { kind: "local", participant: location.name };
  }
  return EVERY_CONTEXT;
}

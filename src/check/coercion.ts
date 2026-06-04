import type { LocatedType } from "../ast/typed.js";
import type { GradualCoercion } from "../ast/gradual.js";
import { available, isDynamic } from "../types/located.js";

/**
 * Location-level coercion decision for a value of type `source` used where a
 * value of type `target` is expected, assuming base types are already known to
 * be compatible (spec §18.7, §18.10, §18.12).
 *
 * - `none`: statically valid (Core v0) — no runtime helper.
 * - `pack`: static value used where `@dynamic` is expected — `packDynamic`.
 * - `require`: `@dynamic` value used where a static location is expected —
 *   `requireTAt` / `requireTArrayAt`.
 * - `static-mismatch`: a pure static location mismatch (no `@dynamic`) — a
 *   Core v0 compile-time error.
 */
export type LocationCoercion =
  | { readonly kind: "none" }
  | { readonly kind: "pack" }
  | { readonly kind: "require" }
  | { readonly kind: "static-mismatch" };

export function locationCoercion(
  target: LocatedType,
  source: LocatedType,
): LocationCoercion {
  const targetDynamic = isDynamic(target);
  const sourceDynamic = isDynamic(source);
  if (targetDynamic && sourceDynamic) {
    return { kind: "none" };
  }
  if (targetDynamic) {
    return { kind: "pack" };
  }
  if (sourceDynamic) {
    return { kind: "require" };
  }
  if (available(source.location, target.location)) {
    return { kind: "none" };
  }
  return { kind: "static-mismatch" };
}

/** The require coercion appropriate for an expected statically located type. */
export function requireCoercionFor(target: LocatedType): GradualCoercion {
  return target.isArray
    ? { kind: "requireArray", at: target.location }
    : { kind: "requireScalar", at: target.location };
}

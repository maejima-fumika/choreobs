import type { BaseType } from "../ast/syntax-types.js";
import type { Location } from "../ast/location.js";
import type { ExecutionContext } from "../ast/context.js";
import type { LocatedType } from "../ast/typed.js";

/**
 * Base type subtyping (spec §subtyping). The relation is reflexivity alone:
 * `integer` and `float` are unrelated, so neither stands in for the other.
 */
export function isSubtype(source: BaseType, target: BaseType): boolean {
  return source === target;
}

export function isArraySubtype(source: LocatedType, target: LocatedType): boolean {
  if (source.isArray || target.isArray) {
    return source.isArray === true && target.isArray === true && source.base === target.base;
  }
  return isSubtype(source.base, target.base);
}

/**
 * Location matching (spec §location-matching-and-residency).
 *
 * A value located at `a` may be used where `b` is required only when the two
 * locations are the same. `every` and the individual locations are independent:
 * neither subsumes the other, so moving a value between them needs an explicit
 * `<-` transfer.
 */
export function locationsEqual(a: Location, b: Location): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === "every") {
    return true;
  }
  return b.kind === "individual" && a.name === b.name;
}

/**
 * `residesAt(L, P)` (spec §location-matching-and-residency) — does endpoint `P` hold a copy of a value
 * located at `L`?
 *
 * This is the EPP presence relation and is deliberately *not* the typing rule
 * above: a `T@every` value does reside at every endpoint, which is why it is
 * projected rather than made absent, but that does not make it usable as a
 * `T@alice` value. Only EPP may use this.
 */
export function residesAt(location: Location, endpoint: string): boolean {
  return location.kind === "every" || location.name === endpoint;
}

/** Execution context as the location that its statements must be located at. */
export function contextAsLocation(ctx: ExecutionContext): Location {
  if (ctx.kind === "choreography") {
    return { kind: "every" };
  }
  return { kind: "individual", name: ctx.endpoint };
}

export function formatLocatedType(type: LocatedType): string {
  const head = type.isArray ? `${type.base}[]` : type.base;
  if (type.base === "void" && type.isArray !== true) {
    return head; // `void` has no location (spec §void)
  }
  const loc =
    type.location.kind === "every" ? "every" : type.location.name;
  return `${head}@${loc}`;
}

export function locatedType(
  base: BaseType,
  location: Location,
  isArray?: boolean,
): LocatedType {
  return { base, location, isArray };
}

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
  if (a.kind === "individual") {
    return b.kind === "individual" && a.name === b.name;
  }
  return a.kind === b.kind;
}

/**
 * `L1 ~ L2` (spec-dyn.md, section 3.1): the two locations may meet in one
 * construct. `dyn` meets anything, and the check it stands for is deferred to
 * run time; two concrete locations meet only when they are equal.
 *
 * `~` is not transitive — `alice ~ dyn` and `dyn ~ bob` both hold — so a
 * construct with more than two locations uses {@link concreteLocationsAgree}.
 */
export function locationsCompatible(a: Location, b: Location): boolean {
  return a.kind === "dyn" || b.kind === "dyn" || locationsEqual(a, b);
}

/**
 * Whether the locations are pairwise `~` (spec-dyn.md, section 3.1): every
 * concrete one among them is the same location. At most one concrete location
 * may be involved; `dyn` is compatible with it.
 */
export function concreteLocationsAgree(locations: readonly Location[]): boolean {
  const concrete = locations.filter((l) => l.kind !== "dyn");
  return concrete.every((l) => locationsEqual(l, concrete[0]!));
}

/**
 * `L1 ⊔ L2` (spec-dyn.md, section 3.1), defined only for `L1 ~ L2`: the
 * location itself when the two are equal, `dyn` when either is `dyn`.
 */
export function joinLocations(a: Location, b: Location): Location {
  if (a.kind === "dyn" || b.kind === "dyn") {
    return DYN;
  }
  return a;
}

/** The one dynamic location (spec-dyn.md, section 2). */
export const DYN: Location = { kind: "dyn" };

export function isDyn(location: Location): boolean {
  return location.kind === "dyn";
}

/** `every`, `dyn` or the endpoint name — how a location is written after `@`. */
export function formatLocation(location: Location): string {
  return location.kind === "individual" ? location.name : location.kind;
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
  switch (location.kind) {
    case "every":
      return true;
    // Every endpoint holds a `__DynVal` for a `dyn` value; which of them owns
    // the payload is decided at run time (spec-dyn.md, section 2.1).
    case "dyn":
      return true;
    case "individual":
      return location.name === endpoint;
  }
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
  return `${head}@${formatLocation(type.location)}`;
}

export function locatedType(
  base: BaseType,
  location: Location,
  isArray?: boolean,
): LocatedType {
  return { base, location, isArray };
}

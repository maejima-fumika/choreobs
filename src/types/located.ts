import type { BaseType } from "../ast/syntax-types.js";
import type {
  ConcreteLocation,
  DynLocation,
  EveryLocation,
  Location,
} from "../ast/location.js";
import type { ExecutionContext } from "../ast/context.js";
import type { LocatedType, TransferMode } from "../ast/typed.js";

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
 * Whether `a` and `b` are the same location. On concrete locations this is
 * matching (spec §location-matching-and-residency): `every` and the individual
 * locations are independent, and neither subsumes the other. The typing rules
 * use consistency instead, {@link locationsCompatible}, which extends matching
 * to `dyn`; equality is what is left once `dyn` has been lowered away.
 */
export function locationsEqual(a: Location, b: Location): boolean {
  if (a.kind === "individual") {
    return b.kind === "individual" && a.name === b.name;
  }
  return a.kind === b.kind;
}

/**
 * `L1 ~ L2` (spec §location-consistency-and-join): the two locations may meet in one
 * construct. `dyn` meets anything, and the check it stands for is deferred to
 * run time; two concrete locations meet only when they are equal.
 *
 * `~` is not transitive — `alice ~ dyn` and `dyn ~ bob` both hold — so a
 * construct with more than two locations uses {@link concreteLocationsAgree}.
 */
export function locationsCompatible(a: Location, b: Location): boolean {
  return isDyn(a) || isDyn(b) || locationsEqual(a, b);
}

/**
 * Whether the locations are pairwise `~` (spec §location-consistency-and-join): every
 * concrete one among them is the same location. At most one concrete location
 * may be involved; `dyn` is compatible with it.
 */
export function concreteLocationsAgree(locations: readonly Location[]): boolean {
  const concrete = locations.filter(isConcrete);
  return concrete.every((l) => locationsEqual(l, concrete[0]!));
}

/**
 * `L1 ⊔ L2` (spec §location-consistency-and-join), defined only for `L1 ~ L2`: the
 * location itself when the two are equal, `dyn` when either is `dyn`.
 */
export function joinLocations(a: Location, b: Location): Location {
  if (isDyn(a) || isDyn(b)) {
    return DYN;
  }
  return a;
}

/** The one dynamic location (spec §dyn). */
export const DYN: DynLocation = { kind: "dyn" };

/** The location of every endpoint at once (spec §every). */
export const EVERY: EveryLocation = { kind: "every" };

export function isDyn(location: Location): location is DynLocation {
  return location.kind === "dyn";
}

/** An individual location or `every` (spec §locations). */
export function isConcrete(location: Location): location is ConcreteLocation {
  return location.kind !== "dyn";
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
    // the payload is decided at run time (spec §location-matching-and-residency).
    case "dyn":
      return true;
    case "individual":
      return location.name === endpoint;
  }
}

/** Execution context as the location that its statements must be located at. */
export function contextAsLocation(ctx: ExecutionContext): ConcreteLocation {
  if (ctx.kind === "choreography") {
    return EVERY;
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

/**
 * How a transfer from `source` to `destination` is carried out
 * (spec §transfer-semantics). Any two locations may be transferred between
 * (spec §transfer-typing); only the way differs.
 */
export function transferModeOf(source: Location, destination: Location): TransferMode {
  // Checked first: `dyn -> dyn` is also equal, and a local copy would get no
  // tag, where a dynamic transfer always has one (spec §communication-tags).
  if (isDyn(source) || isDyn(destination)) {
    return "dynamic";
  }
  // A local copy exactly when every endpoint the destination resides at
  // already holds the source payload: the source is `@every`, or the two
  // locations are the same (spec §local-copy).
  if (source.kind === "every" || locationsEqual(source, destination)) {
    return "localCopy";
  }
  // The source is an individual location from here on.
  if (destination.kind === "every") {
    return "broadcast";
  }
  return "direct";
}

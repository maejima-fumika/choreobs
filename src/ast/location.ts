import type { AstNode } from "./span.js";

/** `alice` | `bob` | … — an individual location naming exactly one endpoint (spec §individual-locations). */
export type IndividualLocation = {
  readonly kind: "individual";
  readonly name: string;
};

/** The reserved location `every`, standing for all endpoints (spec §every). */
export type EveryLocation = { readonly kind: "every" };

/** A concrete location: an individual location or `every` (spec §locations). */
export type ConcreteLocation = IndividualLocation | EveryLocation;

/**
 * Every location in Core v0 is concrete (spec §locations).
 *
 * Kept as a distinct alias so that a future dynamic location can widen this to
 * `ConcreteLocation | DynLocation` without touching the concrete-location side.
 */
export type Location = ConcreteLocation;

/** `@` annotation on types and literals (spec §types, §located-literals). */
export interface LocationAnnotation extends AstNode {
  readonly kind: "LocationAnnotation";
  readonly location: Location;
}

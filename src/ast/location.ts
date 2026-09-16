import type { AstNode, Span } from "./span.js";

/** `alice` | `bob` | … — an individual location naming exactly one endpoint (spec §3.3). */
export type IndividualLocation = {
  readonly kind: "individual";
  readonly name: string;
};

/** The reserved location `every`, standing for all endpoints (spec §3.4). */
export type EveryLocation = { readonly kind: "every" };

/** A concrete location: an individual location or `every` (spec §3.2). */
export type ConcreteLocation = IndividualLocation | EveryLocation;

/**
 * Every location in Core v0 is concrete (spec §3.2).
 *
 * Kept as a distinct alias so that a future dynamic location can widen this to
 * `ConcreteLocation | DynLocation` without touching the concrete-location side.
 */
export type Location = ConcreteLocation;

/** `@` annotation on types and literals (spec §5.2, §5.15). */
export interface LocationAnnotation extends AstNode {
  readonly kind: "LocationAnnotation";
  readonly location: Location;
}

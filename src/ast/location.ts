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
 * The dynamic location `dyn` (spec-dyn.md, section 2). Where a `dyn` value lives
 * is decided at run time, so the checker only asks that its uses be consistent
 * (`~`), and endpoint projection gives every endpoint a copy of it.
 */
export type DynLocation = { readonly kind: "dyn" };

/** A location: a concrete location or `dyn` (spec-dyn.md, section 2). */
export type Location = ConcreteLocation | DynLocation;

/** `@` annotation on types and literals (spec §types, §located-literals). */
export interface LocationAnnotation extends AstNode {
  readonly kind: "LocationAnnotation";
  readonly location: Location;
}

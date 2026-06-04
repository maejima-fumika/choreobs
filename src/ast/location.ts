import type { AstNode, Span } from "./span.js";

/**
 * `alice` | `bob` | … or the reserved location `every` (spec §3), plus the
 * Gradual ChoreoBS `dynamic` location (spec §18.2).
 */
export type Location =
  | { readonly kind: "concrete"; readonly name: string }
  | { readonly kind: "every" }
  | { readonly kind: "dynamic" };

/** Whether a location is the Gradual `@dynamic` location (spec §18.2). */
export function isDynamicLocation(location: Location): boolean {
  return location.kind === "dynamic";
}

/** `@` annotation on types and literals (spec §5.2, §5.15). */
export interface LocationAnnotation extends AstNode {
  readonly kind: "LocationAnnotation";
  readonly location: Location;
}

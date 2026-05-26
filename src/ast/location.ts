import type { AstNode, Span } from "./span.js";

/** `alice` | `bob` | … or the reserved location `every` (spec §3). */
export type Location =
  | { readonly kind: "concrete"; readonly name: string }
  | { readonly kind: "every" };

/** `@` annotation on types and literals (spec §5.2, §5.15). */
export interface LocationAnnotation extends AstNode {
  readonly kind: "LocationAnnotation";
  readonly location: Location;
}

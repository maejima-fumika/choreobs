import type { AstNode, Span } from "./span.js";
import type { LocationAnnotation } from "./location.js";

/** Base types in type annotations (spec §5.2, §7.1). */
export type BaseType =
  | "integer"
  | "float"
  | "boolean"
  | "string"
  | "null"
  | "unit";

/**
 * Type syntax: `BaseType` or `BaseType @ Location` (spec §5.2).
 *
 * `location` is omitted in local-function bodies before elaboration (spec §8.1).
 */
export interface TypeAnnotation extends AstNode {
  readonly kind: "TypeAnnotation";
  readonly base: BaseType;
  readonly location?: LocationAnnotation;
}

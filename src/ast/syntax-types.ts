import type { AstNode } from "./span.js";
import type { LocationAnnotation } from "./location.js";

/** Base types in type annotations (spec §types, §base-types). */
export type BaseType =
  | "integer"
  | "float"
  | "boolean"
  | "string"
  | "null"
  | "void";

/**
 * Type syntax: `BaseType` or `BaseType @ Location` (spec §types).
 *
 * Syntactically optional, but the checker requires it: locations are never
 * inferred from context (spec §explicit-location-annotations).
 */
export interface TypeAnnotation extends AstNode {
  readonly kind: "TypeAnnotation";
  readonly base: BaseType;
  readonly isArray?: boolean;
  readonly location?: LocationAnnotation;
}

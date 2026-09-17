import type { AstNode, Span } from "./span.js";
import type { LocationAnnotation } from "./location.js";

/** Base types in type annotations (spec §5.2, §7.1). */
export type BaseType =
  | "integer"
  | "float"
  | "boolean"
  | "string"
  | "null"
  | "void";

/**
 * Type syntax: `BaseType` or `BaseType @ Location` (spec §5.2).
 *
 * Syntactically optional, but the checker requires it: locations are never
 * inferred from context (spec §8.1).
 */
export interface TypeAnnotation extends AstNode {
  readonly kind: "TypeAnnotation";
  readonly base: BaseType;
  readonly isArray?: boolean;
  readonly location?: LocationAnnotation;
}

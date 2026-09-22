import type { AstNode } from "./span.js";
import type { LocationAnnotation } from "./location.js";

/** Raw literal before optional `@` location (spec §located-literals). */
export type RawLiteral =
  | IntegerLiteral
  | FloatLiteral
  | StringLiteral
  | BooleanLiteral
  | NullLiteral;

export interface IntegerLiteral extends AstNode {
  readonly kind: "IntegerLiteral";
  readonly value: number;
}

export interface FloatLiteral extends AstNode {
  readonly kind: "FloatLiteral";
  readonly value: number;
}

export interface StringLiteral extends AstNode {
  readonly kind: "StringLiteral";
  readonly value: string;
}

export interface BooleanLiteral extends AstNode {
  readonly kind: "BooleanLiteral";
  readonly value: boolean;
}

export interface NullLiteral extends AstNode {
  readonly kind: "NullLiteral";
}

/**
 * Literal with optional location annotation: `1@alice`, `true@every` (spec §located-literals).
 *
 * Syntactically optional, but the checker requires it: locations are never
 * inferred from context (spec §explicit-location-annotations).
 */
export interface LocatedLiteral extends AstNode {
  readonly kind: "LocatedLiteral";
  readonly literal: RawLiteral;
  readonly location?: LocationAnnotation;
}

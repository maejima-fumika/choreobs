import type { AstNode } from "./span.js";
import type { LocationAnnotation } from "./location.js";

/** Raw literal before optional `@` location (spec §5.15). */
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
 * Literal with optional location annotation: `1@alice`, `true@every` (spec §5.15).
 *
 * `location` may be omitted in local-function bodies before elaboration (spec §8.1).
 */
export interface LocatedLiteral extends AstNode {
  readonly kind: "LocatedLiteral";
  readonly literal: RawLiteral;
  readonly location?: LocationAnnotation;
}

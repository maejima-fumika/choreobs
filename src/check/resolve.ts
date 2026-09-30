import type { RawLiteral } from "../ast/literals.js";
import type { LocatedType } from "../ast/typed.js";

/**
 * The base type a literal is written as (spec §literals). Where it is located
 * is the checker's to decide (spec §explicit-location-annotations).
 */
export function rawLiteralBaseType(raw: RawLiteral): LocatedType["base"] {
  switch (raw.kind) {
    case "IntegerLiteral":
      return "integer";
    case "FloatLiteral":
      return "float";
    case "StringLiteral":
      return "string";
    case "BooleanLiteral":
      return "boolean";
    case "NullLiteral":
      return "null";
  }
}

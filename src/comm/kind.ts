import type { LocatedType } from "../ast/typed.js";
import type { CommKind } from "../ir/projected.js";
import { specRef } from "../spec/ref.js";

/**
 * The one kind every array type travels as, the only values ever copied: an
 * array is a BlueScript `any[]` whatever its element type (spec §type-mapping,
 * §communication-api).
 */
export const ARRAY_COMM_KIND = "array" satisfies CommKind;

/**
 * The payload kind a value of `type` travels as (spec §communication-api).
 *
 * Endpoint projection picks the send, receive, broadcast and copy functions
 * by it, and a dynamic transfer passes it to the runtime as its `kind`
 * argument (spec §dynamic-transfer), which dispatches on it the same way.
 *
 * Exhaustive on purpose. An earlier version defaulted every unrecognised base
 * type to `"integer"`, which silently emitted `sendInteger` for values that
 * were not integers at all. Anything not transferable must be rejected by the
 * checker (spec §transfer-typing), so reaching the throws below is an internal bug.
 */
export function commKindForType(type: LocatedType): CommKind {
  if (type.isArray === true) {
    // One kind carries every array. The element type is still checked: an
    // unsupported one is an internal bug here as much as below.
    supportedArrayBase(type);
    return ARRAY_COMM_KIND;
  }
  const base = type.base;
  switch (base) {
    case "integer":
    case "float":
    case "boolean":
    case "string":
    case "null":
      return base;
    case "void":
      throw new Error(
        `internal error: \`void\` has no value to transfer ${specRef("void", "invalid-use-of-void")}`,
      );
    default: {
      const unexpected: never = base;
      throw new Error(
        `internal error: unhandled transfer base type '${String(unexpected)}'`,
      );
    }
  }
}

/** An element type an array may have (spec §array-types). */
export type ArrayElementBase = "integer" | "float" | "boolean";

/**
 * The element type of the array type `type` (spec §array-types).
 *
 * Exhaustive on purpose, like {@link commKindForType}: the checker rejects every
 * other element type (spec §unsupported-array-element-type), so reaching the throw is an
 * internal bug rather than a reason to guess.
 */
export function supportedArrayBase(type: LocatedType): ArrayElementBase {
  switch (type.base) {
    case "integer":
    case "float":
    case "boolean":
      return type.base;
    default:
      throw new Error(
        `internal error: '${type.base}[]' is not a supported array type ${specRef("array-types")}`,
      );
  }
}

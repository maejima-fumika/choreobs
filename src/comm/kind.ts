import type { LocatedType } from "../ast/typed.js";
import type { CommKind } from "../ir/projected.js";
import { specRef } from "../spec/ref.js";

/**
 * The payload kind a value of `type` travels as (spec §communication-api).
 *
 * Endpoint projection picks the send, receive, broadcast and clone functions
 * by it, and a dynamic transfer passes it to the runtime as its `kind`
 * argument (spec-dyn.md, section 11), which dispatches on it the same way.
 *
 * Exhaustive on purpose. An earlier version defaulted every unrecognised base
 * type to `"integer"`, which silently emitted `sendInteger` for values that
 * were not integers at all. Anything not transferable must be rejected by the
 * checker (spec §transfer-typing), so reaching the throws below is an internal bug.
 */
export function commKindForType(type: LocatedType): CommKind {
  if (type.isArray === true) {
    switch (type.base) {
      case "integer":
        return "integerArray";
      case "float":
        return "floatArray";
      case "boolean":
        return "booleanArray";
      default:
        throw new Error(
          `internal error: '${type.base}[]' is not a supported array type ${specRef("array-types")}`,
        );
    }
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

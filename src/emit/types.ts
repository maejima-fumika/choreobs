import type { ProjectedType } from "../ir/projected.js";

/** ChoreoBS → BlueScript type names (spec §type-mapping). */
export function emitType(type: ProjectedType): string {
  if (type.kind === "AbsentType") {
    return "null";
  }
  switch (type.base) {
    // Only an `any[]` has `push` in BlueScript, so every array is one.
    case "integer[]":
    case "float[]":
    case "boolean[]":
      return "any[]";
    default:
      return type.base;
  }
}

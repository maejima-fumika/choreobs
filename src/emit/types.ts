import type { ProjectedType } from "../ir/projected.js";

/** ChoreoBS → BlueScript type names (spec §type-mapping). */
export function emitType(type: ProjectedType): string {
  if (type.kind === "AbsentType") {
    return "null";
  }
  return type.base;
}

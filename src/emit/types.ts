import type { ProjectedType } from "../ir/projected.js";

/** ChoreoBS → BlueScript type names (spec §13.1). */
export function emitType(type: ProjectedType): string {
  if (type.kind === "AbsentType") {
    return "null";
  }
  return type.base;
}

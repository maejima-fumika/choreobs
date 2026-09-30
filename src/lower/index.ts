import type { LoweredProgram, TypedProgram } from "../ast/typed.js";
import { lowerDyn } from "./dyn.js";
import { verifyLowered } from "./verify.js";

export { lowerDyn, verifyLowered };

/**
 * Dynamic location lowering of a tagged program, checked (spec §dyn-lowering): what
 * endpoint projection is given. Tags come first, so that a dynamic transfer is
 * numbered with the static ones (spec §communication-tags).
 */
export function lowerProgram(tagged: TypedProgram): LoweredProgram {
  const lowered = lowerDyn(tagged);
  verifyLowered(lowered);
  return lowered;
}

import type { TypedProgram } from "../ast/typed.js";

/**
 * Result of the lowering pass (spec §18.8–§18.14). Gradual ChoreoBS lowers
 * dynamic coercions to runtime helper calls during endpoint projection (the
 * spec defines them as "after EPP"), so this carries the typed program through
 * to EPP together with a flag recording whether any gradual feature is used.
 *
 * When `usesGradual` is false the program is pure Core v0 and projection/emit
 * must produce byte-for-byte identical output to Core v0.
 */
export interface LoweredProgram {
  readonly kind: "LoweredProgram";
  readonly typed: TypedProgram;
  readonly usesGradual: boolean;
}

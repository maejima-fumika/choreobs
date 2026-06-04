export type { LoweredProgram } from "./ir.js";
export { lowerProgram, programUsesGradual } from "./lower.js";
export {
  DYN_VALUE_CLASS,
  EVERY_CONSTANT,
  HERE_CONSTANT,
  PACK_DYNAMIC,
  REQUIRE_CONDITION,
  DYN_MOVE,
  DYN_ARRAY_GET,
  DYN_ARRAY_SET,
  DYN_ARRAY_PUSH,
  DYN_ARRAY_LENGTH,
  dynBinaryCallee,
  dynUnaryCallee,
  requireScalarCallee,
  requireArrayCallee,
  isGradualRuntimeCallee,
  GRADUAL_RUNTIME_CALLEES,
} from "./runtime.js";

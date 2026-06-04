/**
 * Re-exports of the Gradual ChoreoBS runtime symbol names for emit/cleanup.
 *
 * Cleanup uses {@link isGradualRuntimeCallee} to recognize dynamic runtime
 * helper calls that must never be folded away (spec §18.18, §18.19).
 */
export {
  GRADUAL_RUNTIME_CALLEES,
  isGradualRuntimeCallee,
  DYN_VALUE_CLASS,
  EVERY_CONSTANT,
  HERE_CONSTANT,
} from "../lowering/runtime.js";

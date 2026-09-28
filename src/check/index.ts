export type { TypeCheckError } from "./errors.js";
export { typeCheckError } from "./errors.js";
export { typeCheck, type TypeCheckResult } from "./checker.js";
export type {
  IncompatibleLocations,
  InferErr,
  InferOk,
  InferResult,
  ReturnCandidate,
  UnitReturnCandidate,
  ValueReturnCandidate,
} from "./inference.js";
export {
  checkReturnCoverage,
  inferReturnLocation,
  inferReturnTypeFromCandidates,
  inferenceError,
  inferenceOk,
  lubBase,
  lubLocatedType,
  lubLocation,
} from "./inference.js";

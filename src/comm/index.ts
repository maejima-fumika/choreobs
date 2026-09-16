export { CommTagGenerator, TOP_SCOPE } from "./tags.js";
export {
  checkCommunicationConsistency,
  type CommConsistencyError,
  type CommConsistencyResult,
  type CommScopeId,
} from "./consistency.js";
export {
  checkEmittedCommunicationConsistency,
  type EmittedEndpointOutput,
} from "./emitted.js";
export {
  verifyCommunicationConsistency,
  commConsistencyDiagnostics,
  type CommConsistencyDiagnostic,
} from "./verify.js";

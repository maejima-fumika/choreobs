import type { Span } from "../ast/span.js";
import type { ProjectedProgram } from "../ir/projected.js";
import type { CommConsistencyError, CommConsistencyResult } from "./consistency.js";
import { checkCommunicationConsistency } from "./consistency.js";
import {
  checkEmittedCommunicationConsistency,
  type EmittedEndpointOutput,
} from "./emitted.js";

/** Verifies projected AST and generated BlueScript communication APIs (spec §11–§12). */
export function verifyCommunicationConsistency(
  projected: readonly ProjectedProgram[],
  emitted: readonly EmittedEndpointOutput[],
): CommConsistencyResult {
  const projectedResult = checkCommunicationConsistency(projected);
  if (!projectedResult.ok) {
    return projectedResult;
  }
  return checkEmittedCommunicationConsistency(emitted);
}

export interface CommConsistencyDiagnostic {
  readonly message: string;
  readonly span?: Span;
}

export function commConsistencyDiagnostics(
  errors: readonly CommConsistencyError[],
): readonly CommConsistencyDiagnostic[] {
  return errors.map((e) => ({
    message: `communication consistency: ${e.message}`,
    span: e.span,
  }));
}

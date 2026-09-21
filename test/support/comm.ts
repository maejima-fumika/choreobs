import assert from "node:assert/strict";
import type { ProjectedProgram } from "../../src/ir/projected.js";
import {
  checkCommunicationConsistency,
  type CommConsistencyError,
} from "../../src/comm/index.js";

export function formatCommConsistencyErrors(
  errors: readonly CommConsistencyError[],
): string {
  return errors.map((e) => e.message).join("\n");
}

/** Asserts projected programs have paired send/receive/broadcast (spec §11–§12). */
export function assertCommConsistent(programs: readonly ProjectedProgram[]): void {
  const result = checkCommunicationConsistency(programs);
  assert.equal(
    result.ok,
    true,
    result.errors.length > 0
      ? `communication consistency errors:\n${formatCommConsistencyErrors(result.errors)}`
      : undefined,
  );
}

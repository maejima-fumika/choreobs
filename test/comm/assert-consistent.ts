import assert from "node:assert/strict";
import type { ProjectedProgram } from "../../src/ir/projected.js";
import type { ChoreoBSConfig } from "../../src/config/types.js";
import {
  checkCommunicationConsistency,
  type CommConsistencyError,
} from "../../src/comm/index.js";
import { parse } from "../../src/parser/index.js";
import { typeCheck } from "../../src/check/index.js";
import { projectAll } from "../../src/epp/index.js";
import { compileSource } from "../../src/driver/index.js";

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

/** Type-checks and projects all endpoints (EPP-only tests). */
export function assertSourceCommConsistent(
  source: string,
  config: ChoreoBSConfig,
): readonly ProjectedProgram[] {
  const { program, errors: pe } = parse(source);
  assert.equal(pe.length, 0, JSON.stringify(pe));
  assert.ok(program);
  const { typed, errors: te } = typeCheck(program, config);
  assert.equal(te.length, 0, JSON.stringify(te));
  assert.ok(typed);
  const all = projectAll(typed, config.endpoints);
  assertCommConsistent(all);
  return all;
}

/** Full compile; communication consistency is enforced by the driver. */
export function assertCompileSuccess(
  source: string,
  config: ChoreoBSConfig,
  cbsPath = "index.cbs",
): import("../../src/driver/index.js").CompileResult {
  const result = compileSource(source, cbsPath, config);
  assert.equal(
    result.success,
    true,
    `expected compile success, errors: ${JSON.stringify(result.errors)}`,
  );
  return result;
}

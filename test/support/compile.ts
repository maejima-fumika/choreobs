import assert from "node:assert/strict";
import {
  compileSource,
  type CompileResult,
} from "../../src/driver/index.js";
import type { ChoreoBSConfig } from "../../src/config/types.js";
import { aliceBob } from "./config.js";

/** Runs the whole pipeline: parse, check, project, finalize, clean, emit. */
export function compile(
  source: string,
  config: ChoreoBSConfig = aliceBob,
  cbsPath = "index.cbs",
): CompileResult {
  return compileSource(source, cbsPath, config);
}

/** The BlueScript emitted for one endpoint, without its trailing newline. */
export function bs(result: CompileResult, endpoint: string): string {
  const hit = result.outputs.find((o) => o.endpoint === endpoint);
  assert.ok(hit, `missing output for ${endpoint}`);
  return hit.source.trimEnd();
}

export function expectSuccess(result: CompileResult): void {
  assert.equal(
    result.success,
    true,
    `expected success, errors: ${JSON.stringify(result.errors)}`,
  );
}

export function expectFailure(result: CompileResult): void {
  assert.equal(result.success, false);
  assert.ok(result.errors.length > 0);
  assert.equal(result.outputs.length, 0);
}

/**
 * Nothing choreographic may survive into the generated BlueScript: no location
 * annotation, no transfer operator, and no `absent` artifact (spec §13.2,
 * §13.7).
 */
export function assertNoChoreoResidue(source: string, label?: string): void {
  assert.doesNotMatch(source, /@/, label);
  assert.doesNotMatch(source, /<-/, label);
  assert.doesNotMatch(source, /\babsent\b/, label);
}

import assert from "node:assert/strict";
import { describeDiags } from "./spec.js";
import {
  compileSource,
  type CompileResult,
} from "../../src/driver/index.js";
import type { ChoreoBSConfig } from "../../src/config/types.js";
import { NO_SOURCE_FILES, type SourceFiles } from "../../src/local-imports/index.js";
import { aliceBob } from "./config.js";
import { choreoResidue } from "../../scripts/fuzz/inspect.js";

/**
 * Runs the whole pipeline: parse, check, project, finalize, clean, emit.
 * `files` are the BlueScript source files beside the program
 * (spec §bluescript-source-files), by path below `src/`.
 */
export function compile(
  source: string,
  config: ChoreoBSConfig = aliceBob,
  cbsPath = "index.cbs",
  files: SourceFiles = NO_SOURCE_FILES,
): CompileResult {
  return compileSource(source, cbsPath, config, files);
}

/** {@link SourceFiles} from an object literal, ordered by path as the compiler reads them. */
export function sourceFiles(files: Readonly<Record<string, string>>): SourceFiles {
  return new Map(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
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
    `expected success, errors: ${describeDiags(result.errors)}`,
  );
}

export function expectFailure(result: CompileResult): void {
  assert.equal(result.success, false);
  assert.ok(result.errors.length > 0);
  assert.equal(result.outputs.length, 0);
}


/**
 * Nothing choreographic may survive into the generated BlueScript: no location
 * annotation, no transfer operator, and no `absent` artifact (spec §location-annotation-removal,
 * §absent-finalization).
 */
export function assertNoChoreoResidue(source: string, label?: string): void {
  const residue = choreoResidue(source);
  assert.equal(residue, undefined, label === undefined ? residue : `${label}: ${residue}`);
}

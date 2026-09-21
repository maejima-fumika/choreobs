import assert from "node:assert/strict";
import { parse } from "../../src/parser/index.js";
import { typeCheck, type TypeCheckResult } from "../../src/check/index.js";
import { projectAll } from "../../src/epp/index.js";
import type { ProjectedProgram } from "../../src/ir/projected.js";
import type { ChoreoBSConfig } from "../../src/config/types.js";
import { aliceBob } from "./config.js";

/** Parses and type-checks; the parse must succeed, the check need not. */
export function checkSource(
  source: string,
  config: ChoreoBSConfig = aliceBob,
): TypeCheckResult {
  const { program, errors: parseErrors } = parse(source);
  assert.equal(
    parseErrors.length,
    0,
    "parse errors: " + JSON.stringify(parseErrors),
  );
  assert.ok(program);
  return typeCheck(program, config);
}

/**
 * Parses, type-checks and projects every endpoint, asserting the first two
 * stages are clean. For tests that work on the projected IR rather than on
 * emitted text.
 */
export function projectSource(
  source: string,
  config: ChoreoBSConfig = aliceBob,
): readonly ProjectedProgram[] {
  const { program, errors: parseErrors } = parse(source);
  assert.equal(parseErrors.length, 0, JSON.stringify(parseErrors));
  assert.ok(program);
  const { typed, errors: typeErrors } = typeCheck(program, config);
  assert.equal(typeErrors.length, 0, JSON.stringify(typeErrors));
  assert.ok(typed);
  return projectAll(typed, config.endpoints);
}

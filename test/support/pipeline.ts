import assert from "node:assert/strict";
import { parse } from "../../src/parser/index.js";
import { typeCheck, type TypeCheckResult } from "../../src/check/index.js";
import type { TypedProgram } from "../../src/ast/typed.js";
import { assignCommTags } from "../../src/comm/index.js";
import { projectAll } from "../../src/epp/index.js";
import { lowerProgram } from "../../src/lower/index.js";
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
 * Parses, type-checks and assigns communication tags, asserting the first two
 * stages are clean. For tests that read `commTag` off the typed AST — the
 * checker no longer sets it (spec §communication-tags).
 */
export function tagSource(
  source: string,
  config: ChoreoBSConfig = aliceBob,
): TypedProgram {
  const { typed, errors } = checkSource(source, config);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.ok(typed);
  return assignCommTags(typed);
}

/**
 * Parses, type-checks, lowers and projects every endpoint, as the driver does
 * (spec §dyn-lowering), asserting the first two stages are clean. For tests that
 * work on the projected IR rather than on emitted text.
 */
export function projectSource(
  source: string,
  config: ChoreoBSConfig = aliceBob,
): readonly ProjectedProgram[] {
  return projectAll(lowerProgram(tagSource(source, config)), config.endpoints);
}

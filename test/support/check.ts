import assert from "node:assert/strict";
import { checkSource } from "./pipeline.js";
import { assertCites, describeDiags } from "./spec.js";
import type { SpecId } from "../../src/spec/ref.js";
import type { ChoreoBSConfig } from "../../src/config/types.js";
import type { IndividualLocation } from "../../src/ast/location.js";
import type {
  TypedFunctionDeclaration,
  TypedLetStatement,
  TypedLetTransferStatement,
  TypedProgram,
  TypedStatement,
  TypedTopLevelStatement,
} from "../../src/ast/typed.js";
import { DYN, EVERY, formatLocatedType } from "../../src/types/located.js";

/** Type checking, for the tests of the checker: what it accepts, what it rejects, and how it types. */

/** The locations the checker tests use, as the checker represents them. */
export const alice: IndividualLocation = { kind: "individual", name: "alice" };
export const bob: IndividualLocation = { kind: "individual", name: "bob" };
export const every = EVERY;
export const dyn = DYN;

/** The typed program for `source`, which must check without errors. */
export function expectChecks(source: string, config?: ChoreoBSConfig): TypedProgram {
  const { typed, errors } = checkSource(source, config);
  assert.equal(errors.length, 0, describeDiags(errors));
  assert.ok(typed);
  return typed;
}

/**
 * `source` must be rejected: with an error whose message contains `message`
 * (or one of them, when several are given), and one citing `spec`, as far as
 * either is asked for.
 */
export function expectCheckError(
  source: string,
  expected: {
    readonly message?: string | readonly string[];
    readonly spec?: SpecId;
    readonly config?: ChoreoBSConfig;
  } = {},
): void {
  const { typed, errors } = checkSource(source, expected.config);
  assert.equal(typed, null, `expected a rejection: ${source}`);
  if (expected.message !== undefined) {
    const needles = typeof expected.message === "string" ? [expected.message] : expected.message;
    assert.ok(
      needles.some((needle) => errors.some((e) => e.message.includes(needle))),
      `expected an error containing one of ${JSON.stringify(needles)}: ${describeDiags(errors)}`,
    );
  }
  if (expected.spec !== undefined) {
    assertCites(errors, expected.spec);
  }
}

/** The statements at top level, in order. */
export function topLevelStatements(typed: TypedProgram): TypedStatement[] {
  return typed.items.flatMap((item) =>
    "decl" in item ? [] : [(item as TypedTopLevelStatement).statement],
  );
}

/** The type of the top-level `let`, or transfer `let`, named `name`. */
export function letType(typed: TypedProgram, name: string): string {
  for (const stmt of topLevelStatements(typed)) {
    if (stmt.stmt.kind === "LetStatement" && stmt.stmt.name === name) {
      return formatLocatedType((stmt as TypedLetStatement).choreoType);
    }
    if (stmt.stmt.kind === "LetTransferStatement" && stmt.stmt.name === name) {
      return formatLocatedType((stmt as TypedLetTransferStatement).choreoType);
    }
  }
  assert.fail(`no top-level let ${name}`);
}

/** The function declared as `name`. */
export function fnNamed(typed: TypedProgram, name: string): TypedFunctionDeclaration {
  const hit = typed.items.find((item) => "decl" in item && item.decl.name === name);
  assert.ok(hit && "decl" in hit, `no function ${name}`);
  return hit;
}

/** The function that is the program's `index`th item. */
export function fnAt(typed: TypedProgram, index: number): TypedFunctionDeclaration {
  const item = typed.items[index];
  assert.ok(item && "decl" in item, `expected function at index ${index}`);
  return item;
}

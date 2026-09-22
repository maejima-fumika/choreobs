import assert from "node:assert/strict";
import { specNumber, type SpecCited, type SpecId } from "../../src/spec/ref.js";

type Diagnostic = SpecCited & { readonly message: string };

/** Diagnostics as message and citation, for an assertion's failure text. */
export function describeDiags(errors: readonly Diagnostic[]): string {
  return JSON.stringify(errors.map((e) => ({ message: e.message, spec: e.spec })));
}

/**
 * Some diagnostic rests on `id`.
 *
 * An identity test, not a substring one. Matching a printed number would let
 * a section pass for any other whose number it is a prefix of, and would break
 * whenever a section moved.
 */
export function assertCites(errors: readonly Diagnostic[], id: SpecId): void {
  assert.ok(
    errors.some((e) => e.spec.includes(id)),
    `expected a diagnostic citing ${id} (${specNumber(id)}), got ${describeDiags(errors)}`,
  );
}

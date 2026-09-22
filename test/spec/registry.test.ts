import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkSpec } from "../../scripts/spec/lint.js";

/**
 * `npm test` is this repo's only gate, so the spec lint runs here rather than
 * relying on anyone remembering `npm run spec:check`.
 */
describe("spec.md and the repo agree about the sections", () => {
  it("passes spec:check", () => {
    const findings = checkSpec();
    assert.deepEqual(
      findings,
      [],
      findings.map((f) => `${f.where}: ${f.message}`).join("\n"),
    );
  });
});

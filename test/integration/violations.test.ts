import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileSource } from "../../src/driver/index.js";
import { generate, VIOLATIONS } from "../../scripts/fuzz/generator.js";
import { rejectedFor } from "../../scripts/fuzz/match.js";
import { specNumber } from "../../src/spec/ref.js";

/**
 * A fixed slice of the mutation-fuzz corpus (see `scripts/fuzz/violate.ts`).
 *
 * Each program is valid apart from one deliberate rule violation emitted from
 * the generator's own type and location environment, so it must be rejected.
 * An accepted program is a soundness hole. Seeds are fixed so failures
 * reproduce; widen the search with the script, not this test.
 */
const ENDPOINTS = ["alice", "bob", "carol"];
const SAMPLES_PER_VIOLATION = 3;
const MAX_SEEDS = 80;

describe("injected rule violations are rejected (mutation fuzz corpus)", () => {
  for (const violation of VIOLATIONS) {
    it(`${violation.id} (${specNumber(violation.spec)})`, () => {
      let checked = 0;
      for (let seed = 1; seed <= MAX_SEEDS && checked < SAMPLES_PER_VIOLATION; seed += 1) {
        const program = generate({
          seed,
          endpoints: ENDPOINTS,
          violation: violation.id,
        });
        if (program.injected === undefined) {
          continue;
        }
        checked += 1;
        const result = compileSource(program.source, "index.cbs", {
          endpoints: ENDPOINTS,
          implicitDyn: program.implicitDyn,
        });
        assert.equal(
          result.success,
          false,
          `seed ${seed}: violation of ${specNumber(violation.spec)} compiled successfully ` +
            `(injected in ${program.injected.context})\n\n${program.source}`,
        );
        assert.ok(
          rejectedFor(violation, result.errors),
          `seed ${seed}: rejected, but not for ${specNumber(violation.spec)}: ` +
            JSON.stringify(result.errors.map((e) => ({ message: e.message, spec: e.spec }))),
        );
      }
      assert.ok(
        checked > 0,
        `no seed up to ${MAX_SEEDS} could inject ${violation.id}`,
      );
    });
  }
});

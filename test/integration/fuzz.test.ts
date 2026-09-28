import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileSource } from "../../src/driver/index.js";
import { generate } from "../../scripts/fuzz/generator.js";
import { assertNoChoreoResidue } from "../support/compile.js";

/**
 * A small, fixed slice of the fuzz corpus (see `scripts/fuzz/run.ts`).
 *
 * The generator only emits programs the specification calls well typed, so a
 * rejection here is a finding rather than an expected outcome. Seeds are fixed
 * so failures reproduce; widen the search with the script, not this test.
 */
interface Configuration {
  readonly label: string;
  readonly endpoints: readonly string[];
  readonly seed: number;
  readonly runs: number;
  readonly maxBlockDepth?: number;
  /** Generate `@dyn` (spec §dyn). */
  readonly dyn?: boolean;
  /** Compile in strict mode, and generate no omissions for it (spec §strict-mode). */
  readonly strict?: boolean;
}

const CONFIGURATIONS: readonly Configuration[] = [
  { label: "three endpoints", endpoints: ["alice", "bob", "carol"], seed: 1, runs: 150 },
  { label: "two endpoints", endpoints: ["alice", "bob"], seed: 100000, runs: 75 },
  { label: "five endpoints, deep nesting", endpoints: ["a", "b", "c", "d", "e"], seed: 200000, runs: 75, maxBlockDepth: 3 },
  { label: "dyn, three endpoints", endpoints: ["alice", "bob", "carol"], seed: 300000, runs: 150, dyn: true },
  { label: "dyn, strict mode", endpoints: ["alice", "bob"], seed: 400000, runs: 75, dyn: true, strict: true },
];

describe("generated programs compile (fuzz corpus)", () => {
  for (const config of CONFIGURATIONS) {
    it(config.label, () => {
      for (let i = 0; i < config.runs; i += 1) {
        const seed = config.seed + i;
        const program = generate({
          seed,
          endpoints: config.endpoints,
          maxBlockDepth: config.maxBlockDepth,
          dyn: config.dyn,
          implicitDyn: config.strict !== true,
        });
        const result = compileSource(program.source, "index.cbs", {
          endpoints: config.endpoints,
          implicitDyn: config.strict !== true,
        });
        assert.equal(
          result.success,
          true,
          `seed ${seed}:\n${result.errors.map((e) => e.message).join("\n")}\n\n${program.source}`,
        );
        assert.equal(result.outputs.length, config.endpoints.length);
        for (const out of result.outputs) {
          assertNoChoreoResidue(out.source, `seed ${seed}, ${out.endpoint}`);
        }
      }
    });
  }
});

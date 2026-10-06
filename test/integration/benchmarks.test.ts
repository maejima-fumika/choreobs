import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { compileProject } from "../../src/driver/index.js";
import { assertNoChoreoResidue } from "../support/compile.js";

const BENCHMARKS = join(import.meta.dirname, "..", "..", "benchmarks");
const GROUPS = ["micro", "macro"];

function benchmarkDirs(): string[] {
  return GROUPS.flatMap((group) =>
    readdirSync(join(BENCHMARKS, group))
      .filter((name) => statSync(join(BENCHMARKS, group, name)).isDirectory())
      .sort()
      .map((name) => join(group, name)),
  );
}

describe("benchmarks/ compile end to end", () => {
  const dirs = benchmarkDirs();

  it("finds the benchmark programs", () => {
    for (const group of GROUPS) {
      assert.ok(
        dirs.some((dir) => dir.startsWith(`${group}/`)),
        `expected at least one ${group} benchmark`,
      );
    }
  });

  for (const dir of dirs) {
    it(`compiles ${dir}`, () => {
      const root = join(BENCHMARKS, dir);
      // Each benchmark is the fully static baseline: strict mode, so every
      // location is written (benchmarks/README.md).
      const config = JSON.parse(readFileSync(join(root, "choreobs.json"), "utf8"));
      assert.equal(config.implicitDyn, false, `${dir}: expected "implicitDyn": false`);

      const result = compileProject(root);
      assert.equal(
        result.success,
        true,
        result.errors.map((e) => e.message).join("\n"),
      );
      assert.ok(result.outputs.length > 0, "expected projected outputs");
      for (const out of result.outputs) {
        assertNoChoreoResidue(out.source, `${dir}: ${out.endpoint}`);
      }
    });
  }
});

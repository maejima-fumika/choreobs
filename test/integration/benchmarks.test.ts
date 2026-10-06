import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileProject } from "../../src/driver/index.js";
import { assertNoChoreoResidue } from "../support/compile.js";
import { projectRoots, REPO_ROOT } from "../support/project.js";

const GROUPS = ["micro", "macro"];

/** The benchmark projects, as paths relative to the repository root. */
function benchmarkDirs(): string[] {
  return projectRoots().filter((dir) => dir.startsWith("benchmarks/"));
}

describe("benchmarks/ compile end to end", () => {
  const dirs = benchmarkDirs();

  it("finds the benchmark programs", () => {
    for (const group of GROUPS) {
      assert.ok(
        dirs.some((dir) => dir.startsWith(`benchmarks/${group}/`)),
        `expected at least one ${group} benchmark`,
      );
    }
  });

  for (const dir of dirs) {
    it(`compiles ${dir}`, () => {
      const root = join(REPO_ROOT, dir);
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

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
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

describe("benchmarks/macro-esp32 are macro benchmarks on a board", () => {
  const dir = join(REPO_ROOT, "benchmarks", "macro-esp32");
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const read = (...path: string[]) => readFileSync(join(...path), "utf8");
  // Finder leaves .DS_Store files behind.
  const sources = (root: string) => readdirSync(join(root, "src")).filter((f) => !f.startsWith(".")).sort();

  it("finds the benchmark programs", () => {
    assert.ok(names.length > 0, "expected at least one macro-esp32 benchmark");
  });

  for (const name of names) {
    // The program is the macro benchmark's, so the two measure the same
    // thing; only where the endpoints run differs (benchmarks/README.md).
    it(`${name} is macro/${name} with every endpoint on its own esp32`, () => {
      const root = join(dir, name);
      const base = join(REPO_ROOT, "benchmarks", "macro", name);
      assert.deepEqual(sources(root), sources(base));
      for (const file of sources(base)) {
        assert.equal(read(root, "src", file), read(base, "src", file), `${name}: src/${file} differs from macro`);
      }

      const config = JSON.parse(read(root, "choreobs.json"));
      const baseConfig = JSON.parse(read(base, "choreobs.json"));
      assert.equal(config.implicitDyn, false, `${name}: expected "implicitDyn": false`);
      assert.deepEqual(
        config.endpoints.map((e: { name: string }) => e.name),
        baseConfig.endpoints.map((e: { name: string }) => e.name),
      );
      const endpoints: { name: string; board: string; deviceName?: string }[] = config.endpoints;
      for (const e of endpoints) {
        assert.equal(e.board, "esp32", `${name}: ${e.name} is not on esp32`);
        assert.equal(typeof e.deviceName, "string", `${name}: ${e.name} has no deviceName`);
      }
      // bscript connects to each board by its name, so no two may share one.
      assert.equal(new Set(endpoints.map((e) => e.deviceName)).size, endpoints.length, `${name}: a deviceName repeats`);
    });
  }
});

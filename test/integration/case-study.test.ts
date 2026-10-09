import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { compileProject } from "../../src/driver/index.js";
import { assertNoChoreoResidue } from "../support/compile.js";
import { REPO_ROOT } from "../support/project.js";

const CASE_STUDY = join(REPO_ROOT, "case-study");

function subdirs(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort();
}

describe("case-study/ compiles end to end", () => {
  const scenarios = subdirs(CASE_STUDY);

  it("finds the scenarios", () => {
    assert.ok(scenarios.length > 0, "expected at least one scenario");
  });

  for (const scenario of scenarios) {
    const steps = subdirs(join(CASE_STUDY, scenario));

    it(`${scenario} ends in strict mode`, () => {
      // Each scenario finishes by locating everything (case-study/README.md).
      const last = steps[steps.length - 1]!;
      const config = JSON.parse(readFileSync(join(CASE_STUDY, scenario, last, "choreobs.json"), "utf8"));
      assert.equal(config.implicitDyn, false, `${scenario}/${last}: expected "implicitDyn": false`);
    });

    for (const step of steps) {
      it(`compiles ${scenario}/${step}`, () => {
        const result = compileProject(join(CASE_STUDY, scenario, step));
        assert.equal(
          result.success,
          true,
          result.errors.map((e) => e.message).join("\n"),
        );
        assert.ok(result.outputs.length > 0, "expected projected outputs");
        for (const out of result.outputs) {
          assertNoChoreoResidue(out.source, `${scenario}/${step}: ${out.endpoint}`);
        }
      });
    }
  }
});

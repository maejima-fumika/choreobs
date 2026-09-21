import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { compileFile } from "../../src/driver/index.js";
import { assertNoChoreoResidue } from "../support/compile.js";

const EXAMPLES = join(import.meta.dirname, "..", "..", "examples");

function exampleDirs(): string[] {
  return readdirSync(EXAMPLES)
    .filter((name) => statSync(join(EXAMPLES, name)).isDirectory())
    .sort();
}

describe("examples/ compile end to end", () => {
  const dirs = exampleDirs();

  it("finds the example programs", () => {
    assert.ok(dirs.length > 0, "expected at least one example directory");
  });

  for (const dir of dirs) {
    it(`compiles ${dir}`, () => {
      const result = compileFile(join(EXAMPLES, dir, "index.cbs"));
      assert.equal(
        result.success,
        true,
        result.errors.map((e) => e.message).join("\n"),
      );
      assert.ok(result.outputs.length > 0, "expected projected outputs");
      for (const out of result.outputs) {
        assertNoChoreoResidue(out.source, out.path);
      }
    });
  }
});

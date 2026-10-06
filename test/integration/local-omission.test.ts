import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { compileProject, compileSource } from "../../src/driver/index.js";
import { compilerConfig } from "../../src/config/index.js";
import { outputsKey } from "../../scripts/fuzz/inspect.js";
import { stripLocalFunctionLocations } from "../../scripts/fuzz/strip.js";

/**
 * A location left out inside `function f@P` is `P`
 * (spec §local-function-location-inference). So every location written in a local function of
 * a program that compiles can be left out, and the program compiles to the
 * same output — in strict mode too, which the benchmarks are written for.
 *
 * The examples already leave those locations out, so only programs that still
 * write some are compared; the fuzz corpus covers the rest (`fuzz.test.ts`).
 */
const ROOT = join(import.meta.dirname, "..", "..");
const PROGRAM_DIRS = ["examples", "benchmarks/micro", "benchmarks/macro"];

function projectRoots(): string[] {
  return PROGRAM_DIRS.flatMap((dir) =>
    readdirSync(join(ROOT, dir))
      .filter((name) => statSync(join(ROOT, dir, name)).isDirectory())
      .sort()
      .map((name) => join(dir, name)),
  );
}

describe("stripLocalFunctionLocations", () => {
  it("leaves out the locations inside a local function, but not its own", () => {
    assert.equal(
      stripLocalFunctionLocations(
        "function f@alice(a: integer@alice): integer[]@alice { return [a, 1@alice]@alice; }",
      ),
      "function f@alice(a: integer): integer[] { return [a, 1]; }",
    );
  });

  it("does not touch choreography functions, top level, comments or strings", () => {
    const source = `// 1@alice
function g(a: integer@alice): void {}
let x: integer@bob = 1@bob;
function f@alice(): void { print("@bob"); print(2@alice); }
let y: integer@alice = 3@alice;
`;
    assert.equal(
      stripLocalFunctionLocations(source),
      `// 1@alice
function g(a: integer@alice): void {}
let x: integer@bob = 1@bob;
function f@alice(): void { print("@bob"); print(2); }
let y: integer@alice = 3@alice;
`,
    );
  });

  it("follows nested blocks to the end of the function", () => {
    assert.equal(
      stripLocalFunctionLocations(
        "function f@alice(c: boolean@alice) { if (c) { return 1@alice; } else { return 2@alice; } } let z: integer@bob = 0@bob;",
      ),
      "function f@alice(c: boolean) { if (c) { return 1; } else { return 2; } } let z: integer@bob = 0@bob;",
    );
  });
});

describe("leaving out the locations inside local functions changes no output", () => {
  const programs = projectRoots().flatMap((dir) => {
    const result = compileProject(join(ROOT, dir));
    const stripped = result.source === undefined ? undefined : stripLocalFunctionLocations(result.source);
    return stripped === undefined || stripped === result.source ? [] : [{ dir, result, stripped }];
  });

  it("finds programs whose local functions write their locations", () => {
    assert.ok(programs.length > 0, "expected a benchmark or example with a located local function");
  });

  for (const { dir, result, stripped } of programs) {
    it(dir, () => {
      assert.equal(result.success, true, result.errors.map((e) => e.message).join("\n"));
      assert.ok(result.config !== undefined);
      const omitted = compileSource(stripped, result.sourcePath, compilerConfig(result.config));
      assert.equal(
        omitted.success,
        true,
        `${dir}:\n${omitted.errors.map((e) => e.message).join("\n")}`,
      );
      assert.equal(outputsKey(omitted), outputsKey(result), dir);
    });
  }
});

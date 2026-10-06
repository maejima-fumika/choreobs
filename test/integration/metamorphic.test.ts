import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { join } from "node:path";
import { compileProject, compileSource } from "../../src/driver/index.js";
import { compilerConfig } from "../../src/config/index.js";
import { constifyLets } from "../../scripts/fuzz/constify.js";
import { REWRITES, rewriteProblem } from "../../scripts/fuzz/metamorphic.js";
import { stripLocalFunctionLocations } from "../../scripts/fuzz/strip.js";
import { projectRoots, REPO_ROOT } from "../support/project.js";

/**
 * The source rewrites of `scripts/fuzz/metamorphic.ts`, which must not change
 * what a program compiles to beyond what they rewrite:
 *
 * - a location left out inside `function f@P` is `P`
 *   (spec §local-function-location-inference), so the written ones can be left out;
 * - a `let` that is never stored into can be a `const` (spec §const-statement),
 *   which changes only the keyword of its bindings.
 *
 * Each rewrite is tested on its own, then applied to every example and
 * benchmark — in strict mode too, which the benchmarks are written for. The
 * fuzz corpus applies them to generated programs (`fuzz.test.ts`).
 */

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

describe("constifyLets", () => {
  it("rewrites the declarations of names nothing stores into", () => {
    const { source, names } = constifyLets(
      "let a = 1@alice; let b: integer@bob <- a; let c = 2@alice; c = 3@alice;",
    );
    assert.equal(source, "const a = 1@alice; const b: integer@bob <- a; let c = 2@alice; c = 3@alice;");
    assert.deepEqual([...names].sort(), ["a", "b"]);
  });

  it("keeps a name stored into by a transfer statement or a `for` clause", () => {
    const { source } = constifyLets(
      "let t = 1@alice; t <- 2@alice; let u = 0@every; for (u = 1@every; u < 3@every; ) { } let v = 0@every; for (let i = 0@every; i < 3@every; v = i) { i = i + 1@every; }",
    );
    assert.equal(source.includes("const"), false, source);
  });

  it("goes by name, so a name stored into anywhere keeps every declaration", () => {
    const { source } = constifyLets(
      "function f@alice(): void { let x = 1; x = 2; } let x = 3@alice;",
    );
    assert.equal(source.includes("const"), false, source);
  });

  it("leaves a `for` header's `let` and an element target alone", () => {
    const { source } = constifyLets(
      "let xs = [1]@every; xs[0@every] = 2@every; for (let i = 0@every; i < 1@every; ) { }",
    );
    assert.equal(source, "const xs = [1]@every; xs[0@every] = 2@every; for (let i = 0@every; i < 1@every; ) { }");
  });

  it("is compared to a program with `const`s of its own, read back on both sides", () => {
    const original = "const k: integer@alice = 1@alice; function f@alice(): integer { return k; } let x = f();";
    const constify = REWRITES.find((r) => r.rewrite(original) !== undefined && r.description.includes("const"));
    assert.ok(constify, "the constify rewrite applies");
    const compile = (source: string) => compileSource(source, "index.cbs", { endpoints: ["alice", "bob"] });
    assert.equal(rewriteProblem(constify, original, compile(original), compile), undefined);
  });
});

describe("rewrites of the examples and benchmarks change nothing they must not", () => {
  const programs = projectRoots().map((dir) => ({ dir, result: compileProject(join(REPO_ROOT, dir)) }));

  for (const rewrite of REWRITES) {
    describe(rewrite.description, () => {
      const applicable = programs.filter(
        ({ result }) => result.source !== undefined && rewrite.rewrite(result.source) !== undefined,
      );

      it("applies to some program", () => {
        assert.ok(applicable.length > 0, `no example or benchmark to rewrite by ${rewrite.description}`);
      });

      for (const { dir, result } of applicable) {
        it(dir, () => {
          assert.equal(result.success, true, result.errors.map((e) => e.message).join("\n"));
          assert.ok(result.source !== undefined && result.config !== undefined);
          const config = compilerConfig(result.config);
          const problem = rewriteProblem(rewrite, result.source, result, (source) =>
            compileSource(source, result.sourcePath, config, result.files),
          );
          assert.equal(problem, undefined, dir);
        });
      }
    });
  }
});

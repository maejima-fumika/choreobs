import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { join } from "node:path";
import { compileProject, compileSource, type CompileResult } from "../../src/driver/index.js";
import { runtimeSource } from "../../src/runtime/source.js";
import {
  PROFILE_COUNTERS,
  PROFILE_EXPORTS,
  PROFILE_FORMAT_VERSION,
  PROFILE_MARKER,
  PROFILE_REPORT,
} from "../../src/runtime/profile.js";
import { exportsName, importsOf, inspectOutputs } from "../../scripts/fuzz/inspect.js";
import { parseSpec } from "../../scripts/spec/parse.js";
import { aliceBob } from "../support/config.js";
import { projectRoots, REPO_ROOT } from "../support/project.js";
import { unprofileProgram, unprofileRuntime } from "../support/profile.js";

const AB = aliceBob.endpoints;
const FIVE = ["a", "b", "c", "d", "e"];

const DYN_TRANSFER = `
let x: integer@alice = 1@alice;
let y: integer@dyn <- x;
let z: integer@bob <- y;
print(z);
`;

function profiled(source: string, endpoints: readonly string[] = AB): CompileResult {
  return compileSource(source, "index.cbs", { endpoints }, undefined, { profile: true });
}

/** The lines of the section `slug` of spec.md, up to the next heading of its level or above. */
function specSection(slug: string): string {
  const spec = parseSpec();
  const start = spec.bySlug.get(slug);
  assert.ok(start, `${slug} not found`);
  const end = spec.headings.find((h) => h.line > start.line && h.level <= start.level);
  return spec.lines.slice(start.line - 1, end === undefined ? undefined : end.line - 1).join("\n");
}

describe("profiling build (spec §profiling-build)", () => {
  it("is the ordinary build plus its own additions, for every example and benchmark", () => {
    for (const dir of projectRoots()) {
      const root = join(REPO_ROOT, dir);
      const plain = compileProject(root);
      const prof = compileProject(root, { profile: true });
      assert.equal(prof.success, plain.success, dir);
      assert.equal(inspectOutputs(prof, plain.outputs.map((o) => o.endpoint)), undefined, dir);
      prof.outputs.forEach((out, i) => {
        assert.equal(unprofileProgram(out.source), plain.outputs[i]!.source, `${dir}: ${out.endpoint}`);
      });
      prof.runtimeOutputs.forEach((out, i) => {
        assert.equal(unprofileRuntime(out.source), plain.runtimeOutputs[i]!.source, `${dir}: ${out.endpoint} runtime`);
      });
      assert.deepEqual(prof.sourceFiles, plain.sourceFiles, dir);
    }
  });

  it("adds to the runtime file, with and without dyn, for two and five endpoints", () => {
    for (const endpoints of [AB, FIVE]) {
      for (const dyn of [false, true]) {
        for (const endpoint of endpoints) {
          const prof = runtimeSource(endpoint, endpoints, dyn, { profile: true });
          assert.equal(unprofileRuntime(prof), runtimeSource(endpoint, endpoints, dyn));
        }
      }
    }
  });

  it("ends every program with the report, and imports the profiling names after the ordinary ones", () => {
    const plain = compileSource(DYN_TRANSFER, "index.cbs", aliceBob);
    const prof = profiled(DYN_TRANSFER);
    for (const [i, out] of prof.outputs.entries()) {
      assert.ok(out.source.endsWith(`\n${PROFILE_REPORT}();\n`), out.endpoint);
      const ordinary = importsOf(plain.outputs[i]!.source);
      const names = importsOf(out.source);
      assert.deepEqual(names.slice(0, ordinary.length), ordinary);
      const added = names.slice(ordinary.length);
      assert.deepEqual(added, PROFILE_EXPORTS.filter((name) => added.includes(name)), "out of order");
      assert.equal(added.at(-1), PROFILE_REPORT);
      // Every wrapper a program calls is imported, and nothing it does not call.
      const called = new Set([...out.source.matchAll(/(__prof_\w+)\(/g)].map((m) => m[1]!));
      assert.deepEqual(new Set(added.slice(0, -1)), called, out.endpoint);
    }
  });

  it("gives an endpoint with no code of its own a program that only reports", () => {
    const result = profiled(`let x: integer@alice = 1@alice;\n`);
    assert.equal(
      result.outputs.find((o) => o.endpoint === "bob")!.source,
      `import { ${PROFILE_REPORT} } from "./__runtime";\n\n${PROFILE_REPORT}();\n`,
    );
  });

  it("wraps the dynamic runtime's own communication", () => {
    const runtime = profiled(DYN_TRANSFER).runtimeOutputs[0]!.source;
    const dispatch = runtime.slice(
      runtime.indexOf("function __sendAny("),
      runtime.indexOf("export function __dynTransfer("),
    );
    assert.match(dispatch, /__prof_sendInteger\(to, tag, v\);/);
    assert.match(dispatch, /return __prof_receiveInteger\(from, tag\);/);
    assert.match(dispatch, /__prof_broadcastInteger\(tag, v\);/);
    // No call of the API itself is left there, only of the wrappers.
    assert.doesNotMatch(dispatch, /(?<![A-Za-z0-9_])(send|receive|broadcast)[A-Z]\w*\(/);
  });

  it("declares exactly the counters, as primitives, first in the file", () => {
    const runtime = runtimeSource("alice", AB, true, { profile: true });
    const lets = [...runtime.matchAll(/^let (\w+): (\w+) = (\S+);$/gm)].map((m) => [m[1], m[2], m[3]]);
    assert.deepEqual(
      lets,
      PROFILE_COUNTERS.map(({ key, type }) => [`__prof_${key}`, type, type === "float" ? "0.0" : "0"]),
    );
    assert.ok(runtime.indexOf("let __prof_") < runtime.indexOf("export function __nothing1("));
    for (const name of PROFILE_EXPORTS) {
      assert.ok(exportsName(runtime, name), `${name} is not exported`);
    }
  });

  it("prints the marker, the version, the count and the counters in order", () => {
    const runtime = runtimeSource("alice", AB, false, { profile: true });
    const body = /export function __profReport\(\): void \{\n([\s\S]*?)\n\}/.exec(runtime)![1]!;
    const printed = [...body.matchAll(/^ {2}print\((.*)\);$/gm)].map((m) => m[1]);
    assert.deepEqual(printed, [
      JSON.stringify(PROFILE_MARKER),
      String(PROFILE_FORMAT_VERSION),
      String(PROFILE_COUNTERS.length),
      ...PROFILE_COUNTERS.map(({ key }) => `__prof_${key}`),
    ]);
  });

  it("differs between endpoints only in the comment and __here", () => {
    const strip = (text: string) =>
      text.split("\n").filter((line) => !line.startsWith("//") && !line.startsWith("export const __here")).join("\n");
    assert.equal(
      strip(runtimeSource("alice", AB, true, { profile: true })),
      strip(runtimeSource("bob", AB, true, { profile: true })),
    );
  });

  it("is what spec.md shows: the wrappers verbatim, and the counters in the table's order", () => {
    const section = specSection("profiling-build");
    const runtime = runtimeSource("alice", AB, false, { profile: true });
    const blocks = [...section.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1]!.trimEnd());
    assert.ok(blocks.length > 0);
    for (const block of blocks) {
      assert.ok(runtime.includes(block), `not in the profiled runtime:\n${block}`);
    }
    const keys = [...section.matchAll(/^\| `(\w+)` \| `(\w+)` \|/gm)].map((m) => [m[1], m[2]]);
    assert.deepEqual(keys, PROFILE_COUNTERS.map(({ key, type }) => [key, type]));
  });
});

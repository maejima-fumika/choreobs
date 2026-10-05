import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compile, expectSuccess, assertNoChoreoResidue } from "../support/compile.js";
import { runtimeSource } from "../../src/runtime/source.js";
import { CORE_RUNTIME_EXPORTS } from "../../src/runtime/core.js";
import {
  DYN_RUNTIME,
  DYN_RUNTIME_EXPORTS,
  type ArgumentShape,
  type ResultShape,
} from "../../src/runtime/dyn.js";
import { parseSpec } from "../../scripts/spec/parse.js";
import { aliceBobCarol } from "../support/config.js";

/** `source` declares `name` as an export of its own. */
function exports(source: string, name: string): boolean {
  return new RegExp(`^export (?:class|function|const) ${name}\\b`, "m").test(source);
}

/** The runtime file and its import (spec §runtime-files, §runtime-import, §runtime-support-functions). */
describe("runtime file (spec §runtime-files)", () => {
  it("exports every name a generated program may import", () => {
    const source = runtimeSource("alice", true);
    for (const name of [...CORE_RUNTIME_EXPORTS, ...DYN_RUNTIME_EXPORTS]) {
      assert.ok(exports(source, name), `${name} is not exported`);
    }
  });

  it("holds the core helpers alone without dyn", () => {
    const source = runtimeSource("alice", false);
    for (const name of CORE_RUNTIME_EXPORTS) {
      assert.ok(exports(source, name), `${name} is not exported`);
    }
    for (const name of DYN_RUNTIME_EXPORTS) {
      assert.ok(!exports(source, name), `${name} is exported`);
    }
    assert.doesNotMatch(source, /__here/);
  });

  it("opens with the core helpers, the dynamic-location runtime after them (spec §runtime-files)", () => {
    const core = runtimeSource("alice", false);
    // The header comment is the one line that tells the two apart.
    const body = (text: string) => text.split("\n").filter((line) => !line.startsWith("//")).join("\n");
    assert.ok(body(runtimeSource("alice", true)).startsWith(body(core)));
  });

  it("declares the nothing helpers with one any parameter per argument (spec §nothing)", () => {
    const source = runtimeSource("alice", false);
    for (let arity = 1; arity <= 5; arity++) {
      const params = Array.from({ length: arity }, (_, i) => `a${i + 1}: any`).join(", ");
      assert.ok(
        source.includes(`export function __nothing${arity}(${params}): null {\n  return null;\n}\n`),
        `__nothing${arity}`,
      );
    }
    assert.ok(!exports(source, "__nothing0"));
    assert.ok(!exports(source, "__nothing6"));
  });

  it("declares each runtime function as lowering types its calls (spec §runtime-functions)", () => {
    // What `verifyLowered` checks the calls against, as BlueScript sees it.
    const parameter: Record<ArgumentShape, string> = {
      dyn: "__DynVal",
      concrete: "any",
      constant: "string",
      payload: "any",
    };
    const result: Record<ResultShape, string> = { dyn: "__DynVal", named: "any", void: "void" };
    const source = runtimeSource("alice", true);
    for (const [name, signature] of Object.entries(DYN_RUNTIME)) {
      const declared = new RegExp(`^export function ${name}\\(([^)]*)\\): (\\S+) \\{$`, "m").exec(source);
      assert.ok(declared, `${name} is not declared as an exported function`);
      const params = declared[1] === "" ? [] : declared[1]!.split(", ").map((p) => p.split(": ")[1]);
      assert.deepEqual(params, signature.args.map((shape) => parameter[shape]), `${name} parameters`);
      assert.equal(declared[2], result[signature.result], `${name} result`);
    }
  });

  it("differs between endpoints in __here and the header comment alone", () => {
    const strip = (text: string) =>
      text
        .split("\n")
        .filter((line) => !line.startsWith("//") && !line.startsWith("export const __here"))
        .join("\n");
    for (const dyn of [false, true]) {
      assert.equal(strip(runtimeSource("alice", dyn)), strip(runtimeSource("bob", dyn)));
    }
    assert.match(runtimeSource("bob", true), /^export const __here: string = "bob";$/m);
  });

  it("is the code spec.md lists, block for block (spec §runtime-support-functions)", () => {
    // Every `ts` block of the runtime chapter must appear, as written, in the
    // generated file, and in the same order: the specification shows the
    // runtime, not a sketch of it.
    const spec = parseSpec();
    const start = spec.bySlug.get("runtime-support-functions");
    assert.ok(start, "runtime chapter not found");
    const end = spec.headings.find((h) => h.line > start.line && h.level <= start.level);
    const sections = spec.lines.slice(start.line - 1, end === undefined ? undefined : end.line - 1);
    const blocks = [...sections.join("\n").matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1]!);
    assert.ok(blocks.length >= 12, `expected the runtime's code blocks, found ${blocks.length}`);
    const source = runtimeSource("alice", true);
    let from = 0;
    for (const block of blocks) {
      const at = source.indexOf(block.trimEnd(), from);
      assert.ok(at >= 0, `not in the generated runtime, or out of order:\n${block}`);
      from = at + block.trimEnd().length;
    }
  });

  it("carries nothing choreographic", () => {
    assertNoChoreoResidue(runtimeSource("alice", true));
  });

  it("stops on a location error through runtime_error (spec §location-errors)", () => {
    assert.match(
      runtimeSource("alice", true),
      /export function __locationError\(a: string, b: string\): void \{\n  const message = "location error: " \+ a \+ " and " \+ b;\n  code`runtime_error\(gc_string_to_cstr\(\$\{message\}\)\);`;\n\}/,
    );
    const source = runtimeSource("alice", true);
    assert.match(source, /__locationError\(ra\.bound, rb\.bound\);/);
    assert.match(source, /__locationError\(r\.bound, loc\);/);
  });

  it("is written for every endpoint of a program that uses dyn", () => {
    const result = compile(`let x: integer@dyn = 1@dyn;`, aliceBobCarol);
    expectSuccess(result);
    assert.deepEqual(result.runtimeOutputs.map((o) => o.endpoint), ["alice", "bob", "carol"]);
    assert.equal(result.runtimeOutputs[1]!.source, runtimeSource("bob", true));
    assert.equal(result.outputs.length, 3);
    assert.match(result.outputs[2]!.source, /^import \{ __DynVal, __dynUnbound \} from "\.\/__runtime";\n\n/);
  });

  it("is written with the core helpers even when nothing imports from it (spec §runtime-files)", () => {
    const result = compile(`let x: integer@alice = 1@alice;
let y: integer@bob <- x;`);
    expectSuccess(result);
    assert.deepEqual(
      result.runtimeOutputs.map((o) => [o.endpoint, o.source]),
      [
        ["alice", runtimeSource("alice", false)],
        ["bob", runtimeSource("bob", false)],
      ],
    );
    for (const out of result.outputs) {
      assert.doesNotMatch(out.source, /import/);
    }
  });

  it("imports the copy helper where a transfer copies an array (spec §copy-array-helper)", () => {
    const result = compile(`let xs: integer[]@alice = [1, 2]@alice;
let ys: integer[]@alice <- xs;`);
    expectSuccess(result);
    assert.match(result.outputs[0]!.source, /^import \{ __copyArray \} from "\.\/__runtime";\n\n/);
    assert.match(result.outputs[0]!.source, /let ys: any\[\] = __copyArray\(xs\);/);
    assert.ok(
      runtimeSource("alice", false).includes(
        "export function __copyArray(v: any[]): any[] {\n  return new Array<any>(v);\n}\n",
      ),
    );
    // The copy helper is a core helper: it does not pull in the dynamic-location runtime.
    assert.equal(result.runtimeOutputs[0]!.source, runtimeSource("alice", false));
  });

  it("imports every compiler name an endpoint program calls (spec §runtime-import)", () => {
    const result = compile(`let xs: integer[]@alice = [1, 2]@alice;
let ys: integer[]@every <- xs;
let a: boolean@alice = true@alice;
let b: boolean@alice = a && a || a;
let d = 3;
print(d + 1);`);
    expectSuccess(result);
    for (const out of result.outputs) {
      const imported = /^import \{ ([^}]*) \}/.exec(out.source)?.[1]?.split(", ") ?? [];
      const body = out.source.replace(/^import .*\n/, "");
      const called = [...body.matchAll(/\b(__\w+)\(/g)]
        .map((m) => m[1]!)
        .filter((name) => !name.startsWith("__transfer_"));
      assert.ok(called.length > 0, out.endpoint);
      for (const name of called) {
        assert.ok(imported.includes(name), `${out.endpoint} calls ${name} without importing it`);
      }
    }
  });

  it("is written with the core helpers alone for a program without dyn that calls one (spec §runtime-files)", () => {
    const result = compile(`let a: boolean@alice = true@alice;
let b: boolean@alice = a && a;`);
    expectSuccess(result);
    assert.deepEqual(
      result.runtimeOutputs.map((o) => [o.endpoint, o.source]),
      [
        ["alice", runtimeSource("alice", false)],
        ["bob", runtimeSource("bob", false)],
      ],
    );
    assert.match(result.outputs[0]!.source, /^import \{ __and \} from "\.\/__runtime";\n\n/);
    // `bob` holds none of it, so it imports nothing, and is given the file all the same.
    assert.doesNotMatch(result.outputs[1]!.source, /import/);
  });

  it("lists the core helpers before the dynamic-location runtime's names (spec §runtime-import)", () => {
    const result = compile(`let a: boolean@alice = true@alice;
let b: boolean@alice = a || a && a;
let d: boolean@dyn = true@dyn;`);
    expectSuccess(result);
    assert.match(
      result.outputs[0]!.source,
      /^import \{ __and, __or, __DynVal, __dynUnbound \} from "\.\/__runtime";\n\n/,
    );
    assert.equal(result.runtimeOutputs[0]!.source, runtimeSource("alice", true));
  });

  it("imports what a function signature uses even when nothing calls the runtime", () => {
    const result = compile(`function f(a: integer@dyn): void {}`);
    expectSuccess(result);
    assert.match(result.outputs[0]!.source, /^import \{ __DynVal \} from "\.\/__runtime";/);
    assert.equal(result.runtimeOutputs.length, 2);
  });
});

describe("input file names (spec §reserved-input-file-name)", () => {
  it("rejects a name that takes the compiler's __ prefix", () => {
    const result = compile(`let x: integer@alice = 1@alice;`, undefined, "dir/__main.cbs");
    assert.equal(result.success, false);
    assert.ok(result.errors[0]!.message.includes("must not begin with '__'"));
    assert.deepEqual(result.errors[0]!.spec, ["input-files", "reserved-input-file-name"]);
  });
});

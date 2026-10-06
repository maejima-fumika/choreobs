import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compile, expectSuccess, assertNoChoreoResidue } from "../support/compile.js";
import { runtimeSource } from "../../src/runtime/source.js";
import { CORE_RUNTIME_EXPORTS } from "../../src/runtime/core.js";
import {
  DYN_RUNTIME,
  DYN_RUNTIME_EXPORTS,
  KIND_CONSTANTS,
  locationConstants,
  type ArgumentShape,
  type ResultShape,
} from "../../src/runtime/dyn.js";
import { ALL_COMM_KINDS } from "../../src/runtime/names.js";
import { exportsName, importsOf } from "../../scripts/fuzz/inspect.js";
import { parseSpec } from "../../scripts/spec/parse.js";
import { aliceBob, aliceBobCarol } from "../support/config.js";

/** The endpoints the runtime is shown for in spec.md, and the tests' default. */
const AB = aliceBob.endpoints;

/** The location and kind constants the runtime file for `endpoints` declares, in order. */
function constantNames(endpoints: readonly string[]): string[] {
  return [...locationConstants(endpoints), ...KIND_CONSTANTS].map((c) => c.name);
}

/** The runtime file and its import (spec §runtime-files, §runtime-import, §runtime-support-functions). */
describe("runtime file (spec §runtime-files)", () => {
  it("exports every name a generated program may import", () => {
    const source = runtimeSource("alice", AB, true);
    for (const name of [...CORE_RUNTIME_EXPORTS, ...DYN_RUNTIME_EXPORTS, ...constantNames(AB)]) {
      assert.ok(exportsName(source, name), `${name} is not exported`);
    }
  });

  it("holds the core helpers alone without dyn", () => {
    const source = runtimeSource("alice", AB, false);
    for (const name of CORE_RUNTIME_EXPORTS) {
      assert.ok(exportsName(source, name), `${name} is not exported`);
    }
    for (const name of [...DYN_RUNTIME_EXPORTS, ...constantNames(AB)]) {
      assert.ok(!exportsName(source, name), `${name} is exported`);
    }
    assert.doesNotMatch(source, /__here|__loc_|__kind_|__locationName/);
  });

  it("opens with the core helpers, the dynamic-location runtime after them (spec §runtime-files)", () => {
    const core = runtimeSource("alice", AB, false);
    // The header comment is the one line that tells the two apart.
    const body = (text: string) => text.split("\n").filter((line) => !line.startsWith("//")).join("\n");
    assert.ok(body(runtimeSource("alice", AB, true)).startsWith(body(core)));
  });

  it("declares the nothing helpers with one any parameter per argument (spec §nothing)", () => {
    const source = runtimeSource("alice", AB, false);
    for (let arity = 1; arity <= 5; arity++) {
      const params = Array.from({ length: arity }, (_, i) => `a${i + 1}: any`).join(", ");
      assert.ok(
        source.includes(`export function __nothing${arity}(${params}): null {\n  return null;\n}\n`),
        `__nothing${arity}`,
      );
    }
    assert.ok(!exportsName(source, "__nothing0"));
    assert.ok(!exportsName(source, "__nothing6"));
  });

  it("declares each runtime function as lowering types its calls (spec §runtime-functions)", () => {
    // What `verifyLowered` checks the calls against, as BlueScript sees it.
    const parameter: Record<ArgumentShape, string> = {
      dyn: "__DynVal",
      concrete: "any",
      tag: "string",
      kind: "integer",
      location: "integer",
      payload: "any",
    };
    const result: Record<ResultShape, string> = { dyn: "__DynVal", named: "any", void: "void" };
    const source = runtimeSource("alice", AB, true);
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
      assert.equal(strip(runtimeSource("alice", AB, dyn)), strip(runtimeSource("bob", AB, dyn)));
    }
    assert.match(runtimeSource("bob", AB, true), /^export const __here: integer = __loc_bob;$/m);
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
    const source = runtimeSource("alice", AB, true);
    let from = 0;
    for (const block of blocks) {
      const at = source.indexOf(block.trimEnd(), from);
      assert.ok(at >= 0, `not in the generated runtime, or out of order:\n${block}`);
      from = at + block.trimEnd().length;
    }
  });

  it("carries nothing choreographic", () => {
    assertNoChoreoResidue(runtimeSource("alice", AB, true));
  });

  it("stops on a location error through runtime_error (spec §location-errors)", () => {
    assert.match(
      runtimeSource("alice", AB, true),
      /export function __locationError\(a: integer, b: integer\): void \{\n  const message = "location error: " \+ __locationName\(a\) \+ " and " \+ __locationName\(b\);\n  code`runtime_error\(gc_string_to_cstr\(\$\{message\}\)\);`;\n\}/,
    );
    const source = runtimeSource("alice", AB, true);
    assert.match(source, /__locationError\(ra\.bound, rb\.bound\);/);
    assert.match(source, /__locationError\(r\.bound, loc\);/);
  });

  it("is written for every endpoint of a program that uses dyn", () => {
    const result = compile(`let x: integer@dyn = 1@dyn;`, aliceBobCarol);
    expectSuccess(result);
    assert.deepEqual(result.runtimeOutputs.map((o) => o.endpoint), ["alice", "bob", "carol"]);
    assert.equal(result.runtimeOutputs[1]!.source, runtimeSource("bob", aliceBobCarol.endpoints, true));
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
        ["alice", runtimeSource("alice", AB, false)],
        ["bob", runtimeSource("bob", AB, false)],
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
      runtimeSource("alice", AB, false).includes(
        "export function __copyArray(v: any[]): any[] {\n  return new Array<any>(v);\n}\n",
      ),
    );
    // The copy helper is a core helper: it does not pull in the dynamic-location runtime.
    assert.equal(result.runtimeOutputs[0]!.source, runtimeSource("alice", AB, false));
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
      const imported = importsOf(out.source);
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
        ["alice", runtimeSource("alice", AB, false)],
        ["bob", runtimeSource("bob", AB, false)],
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
    assert.equal(result.runtimeOutputs[0]!.source, runtimeSource("alice", AB, true));
  });

  it("imports what a function signature uses even when nothing calls the runtime", () => {
    const result = compile(`function f(a: integer@dyn): void {}`);
    expectSuccess(result);
    assert.match(result.outputs[0]!.source, /^import \{ __DynVal \} from "\.\/__runtime";/);
    assert.equal(result.runtimeOutputs.length, 2);
  });
});

describe("location and kind codes (spec §location-and-kind-codes)", () => {
  /** The value `source` gives the integer constant `name`. */
  const valueOf = (source: string, name: string): number => {
    const m = new RegExp(`^export const ${name}: integer = (\\d+);$`, "m").exec(source);
    assert.ok(m, `${name} is not declared`);
    return Number(m[1]);
  };

  /** A program that injects, casts, and transfers to an endpoint and to dyn, with no static transfer. */
  const DYN_PROGRAM = `let a: integer@alice = 1@alice;
let d: integer@dyn = a;
let b: integer@bob <- d;
let e: integer@dyn <- d;
let c: boolean@every = true@every;
let f: boolean@dyn = c;
let g: integer@alice = d;
let h: float[]@dyn = [1.5]@dyn;
let k: float[]@carol <- h;`;

  it("numbers dyn 0, every 1, and the endpoints from 2 in their order", () => {
    const source = runtimeSource("alice", ["carol", "alice", "bob"], true);
    assert.deepEqual(
      ["__loc_dyn", "__loc_every", "__loc_carol", "__loc_alice", "__loc_bob"].map((n) => valueOf(source, n)),
      [0, 1, 2, 3, 4],
    );
    assert.match(source, /^export const __here: integer = __loc_alice;$/m);
  });

  it("numbers the kinds in the communication API's order", () => {
    const source = runtimeSource("alice", AB, true);
    assert.deepEqual(
      KIND_CONSTANTS.map((k) => k.kind),
      ALL_COMM_KINDS,
    );
    for (const [i, kind] of ALL_COMM_KINDS.entries()) {
      assert.equal(valueOf(source, `__kind_${kind}`), i);
    }
  });

  it("names every location code back, in code order", () => {
    const source = runtimeSource("alice", ["carol", "alice"], true);
    assert.ok(
      source.includes(`function __locationName(loc: integer): string {
  if (loc === __loc_dyn) {
    return "dyn";
  } else if (loc === __loc_every) {
    return "every";
  } else if (loc === __loc_carol) {
    return "carol";
  } else if (loc === __loc_alice) {
    return "alice";
  }
  return "";
}
`),
    );
  });

  it("declares nothing at top level that the collector traces", () => {
    // A primitive top-level constant is a plain C global; anything else would
    // live in the module's root set (spec §unverified-bluescript-assumptions).
    for (const endpoints of [AB, ["e1", "e2", "e3", "e4", "e5"]]) {
      for (const dyn of [false, true]) {
        const source = runtimeSource(endpoints[0]!, endpoints, dyn);
        const declarations = source.split("\n").filter((line) => /^(?:export )?(?:const|let|var) /.test(line));
        for (const line of declarations) {
          assert.match(line, /^export const __\w+: integer = (?:\d+|__loc_\w+);$/);
        }
        // The location and kind constants, and `__here`.
        assert.equal(declarations.length, dyn ? constantNames(endpoints).length + 1 : 0);
      }
    }
  });

  it("evaluates no string literal outside naming a location", () => {
    // String literals allocate on every evaluation in BlueScript; only the
    // paths that communicate or fail name a location.
    const source = runtimeSource("alice", AB, true);
    const without = (text: string, name: string): string =>
      text.replace(new RegExp(`(?:export )?function ${name}\\([^]*?\\n\\}\\n`), "");
    const rest = without(without(source, "__locationName"), "__locationError");
    assert.doesNotMatch(rest, /"/);
  });

  it("passes locations and kinds as constants, and tags as the only strings", () => {
    const result = compile(DYN_PROGRAM, aliceBobCarol);
    expectSuccess(result);
    for (const out of result.outputs) {
      const strings = [...out.source.matchAll(/"[^"]*"/g)].map((m) => m[0]);
      for (const literal of strings) {
        assert.match(literal, /^"(?:__top_\d+|\.\/__runtime)"$/, `${out.endpoint}: ${literal}`);
      }
      const imported = importsOf(out.source);
      const constants = imported.filter((name) => /^__(?:loc|kind)_/.test(name));
      assert.deepEqual(constants, [...constants].sort(), `${out.endpoint}: constants in name order`);
      const body = out.source.replace(/^import .*\n/, "");
      for (const [name] of body.matchAll(/\b__(?:loc|kind)_\w+\b/g)) {
        assert.ok(imported.includes(name), `${out.endpoint} uses ${name} without importing it`);
      }
    }
    assert.match(result.outputs[0]!.source, /__dynTransfer\("__top_\d+", __kind_integer, __loc_bob, d\)/);
    assert.match(result.outputs[0]!.source, /__dynTransfer\("__top_\d+", __kind_array, __loc_carol, h\)/);
  });

  it("gives each endpoint the same program whatever order the endpoints are declared in", () => {
    const forward = compile(DYN_PROGRAM, aliceBobCarol);
    const reversed = compile(DYN_PROGRAM, { endpoints: [...aliceBobCarol.endpoints].reverse() });
    expectSuccess(forward);
    expectSuccess(reversed);
    const at = (result: typeof forward, endpoint: string, files: "outputs" | "runtimeOutputs") =>
      result[files].find((o) => o.endpoint === endpoint)?.source;
    for (const endpoint of aliceBobCarol.endpoints) {
      assert.equal(at(reversed, endpoint, "outputs"), at(forward, endpoint, "outputs"));
      // The codes are what differ.
      assert.notEqual(at(reversed, endpoint, "runtimeOutputs"), at(forward, endpoint, "runtimeOutputs"));
    }
  });

  it("is only ever written for an endpoint of the list", () => {
    assert.throws(() => runtimeSource("alice", ["bob"], true), /internal error/);
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

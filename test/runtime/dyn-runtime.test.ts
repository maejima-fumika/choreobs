import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compile, expectSuccess, assertNoChoreoResidue } from "../support/compile.js";
import { dynRuntimeSource } from "../../src/runtime/source.js";
import { DYN_RUNTIME_EXPORTS } from "../../src/runtime/dyn.js";
import { aliceBobCarol } from "../support/config.js";

/** The runtime file and its import (spec-dyn.md, sections 6–7 and 9–12). */
describe("dynamic-location runtime (spec-dyn.md, section 7)", () => {
  it("exports every name a generated program may import", () => {
    const source = dynRuntimeSource("alice");
    for (const name of DYN_RUNTIME_EXPORTS) {
      assert.match(
        source,
        new RegExp(`^export (?:class|function|const) ${name}\\b`, "m"),
        `${name} is not exported`,
      );
    }
  });

  it("differs between endpoints in __here alone", () => {
    const strip = (text: string) =>
      text
        .split("\n")
        .filter((line) => !line.startsWith("//") && !line.startsWith("export const __here"))
        .join("\n");
    assert.equal(strip(dynRuntimeSource("alice")), strip(dynRuntimeSource("bob")));
    assert.match(dynRuntimeSource("bob"), /^export const __here: string = "bob";$/m);
  });

  it("carries nothing choreographic", () => {
    assertNoChoreoResidue(dynRuntimeSource("alice"));
  });

  it("halts on a location error instead of returning (section 6.2)", () => {
    assert.match(
      dynRuntimeSource("alice"),
      /export function __locationError\(\): void \{\n  while \(true\) \{\n  \}\n\}/,
    );
  });

  it("is written for every endpoint of a program that uses dyn", () => {
    const result = compile(`let x: integer@dyn = 1@dyn;`, aliceBobCarol, "dir/index.cbs");
    expectSuccess(result);
    assert.deepEqual(
      result.runtimeOutputs.map((o) => [o.endpoint, o.path]),
      [
        ["alice", "dir/__runtime_alice.bs"],
        ["bob", "dir/__runtime_bob.bs"],
        ["carol", "dir/__runtime_carol.bs"],
      ],
    );
    assert.equal(result.runtimeOutputs[1]!.source, dynRuntimeSource("bob"));
    assert.equal(result.outputs.length, 3);
    assert.match(result.outputs[2]!.source, /^import \{ __DynVal, __dynUnbound \} from "\.\/__runtime_carol";\n\n/);
  });

  it("is not written, and nothing is imported, for a program without dyn (section 7.2)", () => {
    const result = compile(`let x: integer@alice = 1@alice;
let y: integer@bob <- x;`);
    expectSuccess(result);
    assert.equal(result.runtimeOutputs.length, 0);
    for (const out of result.outputs) {
      assert.doesNotMatch(out.source, /import/);
    }
  });

  it("imports what a function signature uses even when nothing calls the runtime", () => {
    const result = compile(`function f(a: integer@dyn): void {}`);
    expectSuccess(result);
    assert.match(result.outputs[0]!.source, /^import \{ __DynVal \} from "\.\/__runtime_alice";/);
    assert.equal(result.runtimeOutputs.length, 2);
  });
});

describe("input file names (spec-dyn.md, section 7.1)", () => {
  it("rejects a name that takes the compiler's __ prefix", () => {
    const result = compile(`let x: integer@alice = 1@alice;`, undefined, "dir/__runtime_x.cbs");
    assert.equal(result.success, false);
    assert.ok(result.errors[0]!.message.includes("must not begin with '__'"));
    assert.deepEqual(result.errors[0]!.spec, ["input-files"]);
  });
});

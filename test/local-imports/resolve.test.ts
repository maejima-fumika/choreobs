import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SpecId } from "../../src/spec/ref.js";
import { compile, expectSuccess, sourceFiles } from "../support/compile.js";
import { aliceBob } from "../support/config.js";
import { assertCites, describeDiags } from "../support/spec.js";

const FILES = sourceFiles({
  "clock.bs": `let ticks: integer = 0;\nexport function now(): integer {\n  ticks = ticks + 1;\n  return ticks;\n}\n`,
  "sensor@alice.bs": `export function readSensor(t: integer): float {\n  return 20.5 + t;\n}\n\nexport function sum(xs: integer[]): integer {\n  return 0;\n}\n`,
  "lib/math.bs": `export function add(a: integer, b: integer): integer { return a + b; }\n`,
  "broken.bs": `export function f(: integer {}\n`,
  "chatty.bs": `export function report(x: integer): void {\n  sendInteger("bob", "t", x);\n}\n`,
});

/** `source` must fail with one error containing `message`, citing `spec`; the error's span covers `at` when given. */
function rejected(source: string, message: string, spec: SpecId, at?: string) {
  const result = compile(source, aliceBob, "index.cbs", FILES);
  assert.equal(result.success, false, `expected a rejection: ${source}`);
  assert.equal(result.errors.length, 1, describeDiags(result.errors));
  const error = result.errors[0]!;
  assert.ok(error.message.includes(message), describeDiags(result.errors));
  assertCites(result.errors, spec);
  if (at !== undefined) {
    assert.ok(error.span !== undefined && "start" in error.span && typeof error.span.start === "number");
    const span = error.span as { start: number; end: number };
    assert.equal(source.slice(span.start, span.end), at);
  }
}

describe("resolving imports (spec §import-declarations, §imported-signatures)", () => {
  it("finds a shared file, an endpoint-specific one, and one in a directory", () => {
    expectSuccess(compile(
      `import@alice { now } from "./clock";
import@alice { readSensor } from "./sensor@alice";
import@bob { add } from "./lib/math";
let r: float@alice = readSensor(now());
let s: integer@bob = add(1@bob, 2@bob);
`,
      aliceBob, "index.cbs", FILES,
    ));
  });

  describe("the location (spec §invalid-import-location)", () => {
    it("rejects `every`, `dyn` and an unknown endpoint", () => {
      rejected(`import@every { now } from "./clock";`, "cannot import at 'every'", "invalid-import-location", "@every");
      rejected(`import@dyn { now } from "./clock";`, "cannot import at 'dyn'", "invalid-import-location");
      rejected(`import@carol { now } from "./clock";`, "unknown endpoint 'carol'", "unknown-endpoint", "@carol");
    });
  });

  describe("the module path (spec §invalid-module-path, §imported-file-not-found)", () => {
    it("must begin with './', name no '..', '.' or empty name, and leave out '.bs'", () => {
      rejected(`import@alice { now } from "clock";`, `beginning with './': write "./clock"`, "invalid-module-path", `"clock"`);
      rejected(`import@alice { now } from "../src/clock";`, "beginning with './'", "invalid-module-path");
      rejected(`import@alice { now } from "./lib/../clock";`, "has an empty, '.' or '..' name", "invalid-module-path");
      rejected(`import@alice { add } from "./lib//math";`, "has an empty, '.' or '..' name", "invalid-module-path");
      rejected(`import@alice { now } from "./clock.bs";`, "without '.bs'", "invalid-module-path");
    });

    it("must name a source file, in its own case", () => {
      rejected(`import@alice { now } from "./timer";`, "there is no source file 'src/timer.bs'", "imported-file-not-found", `"./timer"`);
      rejected(`import@alice { now } from "./Clock";`, `did you mean "./clock"?`, "imported-file-not-found");
    });

    it("imports an endpoint-specific file only at its endpoint (spec §importing-another-endpoints-file)", () => {
      rejected(
        `import@bob { readSensor } from "./sensor@alice";`,
        "'src/sensor@alice.bs' goes to alice alone, so only an import at alice may import from it, not one at bob",
        "importing-another-endpoints-file",
        `"./sensor@alice"`,
      );
    });
  });

  describe("the file and its names", () => {
    it("reports a file that may not be imported from at the import, with the file's position", () => {
      rejected(`import@alice { f } from "./broken";`, "src/broken.bs:1:19: src/broken.bs cannot be imported from: syntax error", "unsupported-imported-file", `"./broken"`);
      rejected(`import@alice { report } from "./chatty";`, "src/chatty.bs:2:3", "unsupported-imported-file");
    });

    it("reports a name that is not exported, at its specifier (spec §name-not-exported)", () => {
      rejected(`import@alice { now, later } from "./clock";`, "'later' is not declared in src/clock.bs", "name-not-exported", "later");
      rejected(`import@alice { ticks as t } from "./clock";`, "'ticks' is declared but not exported in src/clock.bs", "name-not-exported", "ticks as t");
    });

    it("reports a declaration that cannot be imported, with where it is (spec §unsupported-export)", () => {
      rejected(
        `import@alice { sum } from "./sensor@alice";`,
        "src/sensor@alice.bs:5:21: 'sum' cannot be imported: its parameter 'xs' has the array type 'integer[]'",
        "unsupported-export",
        "sum",
      );
    });

    it("does not look at a declaration nothing imports", () => {
      expectSuccess(compile(`import@alice { readSensor } from "./sensor@alice";`, aliceBob, "index.cbs", FILES));
    });
  });

  describe("source file names, imported or not (spec §invalid-bluescript-file-name)", () => {
    it("are checked before the program is parsed", () => {
      const result = compile(`let x = ;`, aliceBob, "index.cbs", sourceFiles({ "sensor@carol.bs": "" }));
      assert.equal(result.errors.length, 1, describeDiags(result.errors));
      assertCites(result.errors, "invalid-bluescript-file-name");
    });

    it("fail a program that imports nothing", () => {
      const result = compile(`let x: integer@alice = 1@alice;`, aliceBob, "index.cbs", sourceFiles({ "__util.bs": "" }));
      assert.equal(result.success, false);
      assertCites(result.errors, "reserved-input-file-name");
    });
  });
});

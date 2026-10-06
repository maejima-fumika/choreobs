import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expectCheckError, expectChecks, fnNamed, letType } from "../support/check.js";
import { sourceFiles } from "../support/compile.js";
import { formatLocatedType } from "../../src/types/located.js";

/**
 * Imported names (spec §imported-names): an imported function is a local
 * function at the import's endpoint whose body is BlueScript, and an imported
 * constant is a top-level constant there.
 */
const FILES = sourceFiles({
  "clock.bs": [
    "let ticks: integer = 0;",
    "export function now(): integer { ticks = ticks + 1; return ticks; }",
    "export function later(): integer { return 0; }",
    "export const period: integer = 10;",
    "",
  ].join("\n"),
  "timer.bs": "export function now(): integer { return 0; }\n",
  "sensor@alice.bs": [
    "export const threshold = 30;",
    "export function readSensor(t: integer): float { return 20.5 + t; }",
    "export function log(x: float): void {}",
    "",
  ].join("\n"),
});

const CLOCK = `import@alice { now, period } from "./clock";\n`;
const SENSOR = `import@alice { readSensor, log, threshold } from "./sensor@alice";\n`;

function checks(source: string) {
  return expectChecks(source, undefined, FILES);
}

function rejects(source: string, expected: Parameters<typeof expectCheckError>[1] = {}) {
  expectCheckError(source, { ...expected, files: FILES });
}

describe("imported names (spec §imported-names)", () => {
  describe("an imported function is a local function at its endpoint", () => {
    it("is called from a choreography context, with the file's types located there", () => {
      const typed = checks(`${CLOCK}${SENSOR}
let t: integer@alice = now();
let r = readSensor(t);
log(r);
`);
      assert.equal(letType(typed, "r"), "float@alice");
    });

    it("is called from a local function at its endpoint, and its type flows into inference", () => {
      const typed = checks(`${CLOCK}
function twice@alice() {
    return now() + now();
}
let x = twice();
`);
      assert.equal(letType(typed, "x"), "integer@alice");
      assert.equal(formatLocatedType(fnNamed(typed, "twice").returnType), "integer@alice");
    });

    it("is not called from a local function at another endpoint (spec §calling-functions-from-a-local-context)", () => {
      rejects(`${CLOCK}
function f@bob(): integer@bob {
    return now();
}
`, { message: "cannot call function 'now' at 'alice' from 'bob'", spec: "calling-functions-from-a-local-context" });
    });

    it("takes arguments as a local function does: at its endpoint, of its types", () => {
      rejects(`${SENSOR}let r = readSensor(1@bob);`, { spec: "invalid-function-argument-location" });
      rejects(`${SENSOR}let r = readSensor(1.0@alice);`);
      rejects(`${SENSOR}log(1@alice);`, {});
      checks(`${SENSOR}let d: integer@dyn = 3@dyn;\nlet r = readSensor(d);`);
    });

    it("returns `void` where the file says so (spec §invalid-use-of-void)", () => {
      rejects(`${SENSOR}let v = log(1.0@alice);`, { spec: "invalid-use-of-void" });
    });

    it("is a function name, not a value", () => {
      rejects(`${CLOCK}let f = now;`, { message: "'now' is a function name, not a value" });
    });
  });

  describe("an imported constant is a top-level constant at its endpoint", () => {
    it("is visible at top level, in a choreography function and in a local function there", () => {
      const typed = checks(`${CLOCK}${SENSOR}
let p = period;
function every2(): integer@alice { return period * 2@alice; }
function over@alice(x: integer@alice): boolean@alice { return x > threshold; }
let o = over(p);
`);
      assert.equal(letType(typed, "p"), "integer@alice");
    });

    it("is not used in a local function at another endpoint (spec §local-function-strict-location-rule)", () => {
      rejects(`${CLOCK}
function f@bob(): integer@bob {
    return period;
}
`, { message: "imported constant 'period' at alice is not usable in local function at bob", spec: "invalid-value-used-inside-local-function" });
    });

    it("is never stored into (spec §assignment-to-a-constant)", () => {
      rejects(`${CLOCK}period = 3@alice;`, { spec: "assignment-to-a-constant" });
    });

    it("may be shadowed by a parameter, a local and a block's variable, but not redeclared at top level", () => {
      checks(`${CLOCK}
function f@alice(period: integer@alice): integer@alice { return period; }
function g(): integer@bob { let period: integer@bob = 1@bob; return period; }
if (true@every) {
    let period: integer@bob = 2@bob;
}
`);
      rejects(`${CLOCK}let period: integer@bob = 1@bob;`, { message: "'period' is an imported constant", spec: "imported-names" });
    });

    it("is initialized before every statement (spec §top-level-constant-initialization-order)", () => {
      checks(`${CLOCK}
let x: integer@alice = f();
function f@alice(): integer@alice { return period; }
`);
    });
  });

  describe("names (spec §imported-names, §namespaces)", () => {
    it("may not be an endpoint's or a reserved runtime name", () => {
      rejects(`import@alice { now as alice } from "./clock";`, { message: "'alice' is an endpoint name and cannot be the name of an import", spec: "err-name-already-held" });
      rejects(`import@alice { now as print } from "./clock";`, { message: "'print' is a reserved runtime name", spec: "function-names" });
      rejects(`import@alice { now as sendInteger } from "./clock";`, { spec: "codegen-function-names" });
      rejects(`import@alice { now as __now } from "./clock";`, { spec: "codegen-function-names" });
    });

    it("may not be a declared function's, nor taken by a variable or parameter when it is a function", () => {
      rejects(`${CLOCK}function now@alice(): integer@alice { return 1@alice; }`, { message: "function 'now' has the name of an imported function", spec: "imported-names" });
      rejects(`${CLOCK}function period(): void {}`, { message: "function 'period' has the name of an imported constant", spec: "err-name-already-held" });
      rejects(`${CLOCK}let now: integer@alice = 1@alice;`, { message: "'now' is a function name and cannot be used as a variable name", spec: "err-name-already-held" });
      rejects(`${CLOCK}function f@alice(now: integer@alice): void {}`, { spec: "err-name-already-held" });
    });

    it("may be imported again when it binds the same thing, and one export under two names", () => {
      const typed = checks(`import@alice { now } from "./clock";
import@alice { now, now as t, period, period as p } from "./clock";
let a = now() + t();
let b = period + p;
`);
      assert.equal(letType(typed, "a"), "integer@alice");
    });

    it("may not bind one name to two things (spec §conflicting-imports)", () => {
      rejects(`import@alice { now } from "./clock";\nimport@bob { now } from "./clock";`, {
        message: "'now' is already imported at alice; import it at bob under another name, with 'as'",
        spec: "conflicting-imports",
      });
      rejects(`import@alice { now } from "./clock";\nimport@alice { now } from "./timer";`, {
        message: "'now' is already imported, as 'now' from src/clock.bs at alice",
        spec: "conflicting-imports",
      });
      rejects(`import@alice { now, later as now } from "./clock";`, { spec: "conflicting-imports" });
    });

    it("may share an export at two endpoints under two names", () => {
      checks(`import@alice { now as nowAtAlice } from "./clock";
import@bob { now as nowAtBob } from "./clock";
let a = nowAtAlice();
let b = nowAtBob();
`);
    });
  });
});

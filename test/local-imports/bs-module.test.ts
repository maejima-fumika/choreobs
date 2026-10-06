import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readBsModule, type BsExport, type BsModule } from "../../src/local-imports/index.js";

function moduleOf(text: string): BsModule {
  const result = readBsModule(text);
  assert.ok(result.ok, result.ok ? "" : result.error.message);
  return result.module;
}

function exportOf(text: string, name: string): BsExport {
  const entry = moduleOf(text).exports.get(name);
  assert.ok(entry, `'${name}' is not exported`);
  return entry;
}

function unsupported(text: string, name: string, reason: string): void {
  const entry = exportOf(text, name);
  assert.equal(entry.kind, "unsupported", JSON.stringify(entry));
  if (entry.kind === "unsupported") {
    assert.ok(entry.reason.includes(reason), entry.reason);
  }
}

function fileError(text: string, message: string, line: number, column: number): void {
  const result = readBsModule(text);
  assert.equal(result.ok, false, "expected the file to be rejected");
  if (!result.ok) {
    assert.ok(result.error.message.includes(message), result.error.message);
    assert.deepEqual(result.error.at, { line, column });
  }
}

describe("reading an imported BlueScript file (spec §imported-signatures)", () => {
  describe("types (spec §imported-types)", () => {
    it("reads each type as BlueScript does", () => {
      assert.deepEqual(
        exportOf(
          `export function f(a: integer, b: number, c: float, d: boolean, e: string, g: null, h: undefined): void {}`,
          "f",
        ),
        { kind: "function", params: ["integer", "integer", "float", "boolean", "string", "null", "null"], returnType: "void" },
      );
      assert.deepEqual(exportOf(`export function g(): float { return 1.0; }`, "g"), {
        kind: "function", params: [], returnType: "float",
      });
      assert.deepEqual(exportOf(`export const n: integer = 3;`, "n"), { kind: "constant", type: "integer" });
    });

    it("rejects arrays, `any`, `int32`, unions, function and class types", () => {
      unsupported(`export function f(xs: integer[]): integer { return 0; }`, "f", "the array type 'integer[]', and arrays cannot be imported");
      unsupported(`export function f(xs: Array<integer>): integer { return 0; }`, "f", "arrays cannot be imported");
      unsupported(`export function f(): any[] { return []; }`, "f", "arrays cannot be imported");
      unsupported(`export function f(x: any): integer { return 0; }`, "f", "the type 'any'");
      unsupported(`export function f(x: int32): integer { return 0; }`, "f", "the type 'int32'");
      unsupported(`export function f(x: string | null): integer { return 0; }`, "f", "the type 'string | null'");
      unsupported(`export function f(g: (x: integer) => integer): integer { return 0; }`, "f", "which ChoreoBS does not have");
      unsupported(`class P {}\nexport function f(p: P): integer { return 0; }`, "f", "the type 'P'");
      unsupported(`export function f(x: void): void {}`, "f", "'void', which only a return type may be");
      unsupported(`export const xs: integer[] = [1];`, "xs", "arrays cannot be imported");
    });

    it("takes a constant's type from a literal initializer, by BlueScript's reading of numbers", () => {
      const types = moduleOf(
        `export const a = 10, b = 0x1F, c = 1e3, d = 1.5, e = -2, f = -2.5, g = "s", h = true, i = null;`,
      ).exports;
      assert.deepEqual(
        Object.fromEntries([...types].map(([name, entry]) => [name, entry.kind === "constant" ? entry.type : entry.kind])),
        { a: "integer", b: "integer", c: "integer", d: "float", e: "integer", f: "float", g: "string", h: "boolean", i: "null" },
      );
      unsupported(`export const big = 1_000;`, "big", "BlueScript does not read the number '1_000'");
      unsupported(`export const scale = 2.0 * 3.0;`, "scale", "its initializer is not a literal: write its type");
    });
  });

  describe("what can be imported (spec §imported-exports)", () => {
    it("rejects a function without its types, or with an unusual parameter or form", () => {
      unsupported(`export function f(x: integer) { return x; }`, "f", "it has no return type");
      unsupported(`export function f(x): integer { return 0; }`, "f", "its parameter 'x' has no type");
      unsupported(`export function f(x?: integer): integer { return 0; }`, "f", "its parameter 'x' is optional");
      unsupported(`export function f(x: integer = 0): integer { return x; }`, "f", "a parameter has a default value");
      unsupported(`export function f(...xs: integer[]): integer { return 0; }`, "f", "it has a rest parameter");
      unsupported(`export async function f(): integer { return 0; }`, "f", "it is an async function");
      unsupported(`export function* f(): integer { return 0; }`, "f", "it is a generator");
      unsupported(`export function f<T>(x: integer): integer { return 0; }`, "f", "it takes type parameters");
      unsupported(`export function f(x: integer): integer;`, "f", "declared without a body");
    });

    it("imports only a `const` that holds no function, and no class", () => {
      unsupported(`export let count: integer = 0;`, "count", "it is declared with 'let'");
      unsupported(`export const twice = (x: integer): integer => x * 2;`, "twice", "it holds a function");
      unsupported(`export class Point {}`, "Point", "it is a class");
    });

    it("tells a name declared without `export` from one only listed in `export { ... }`", () => {
      const module = moduleOf(`let ticks: integer = 0;\nfunction step(): void {}\nexport { step };`);
      assert.deepEqual([...module.exports.keys()], []);
      assert.equal(module.unexported.get("ticks"), "is declared but not exported");
      assert.match(module.unexported.get("step")!, /only listed in 'export \{ \.\.\. \}', which BlueScript ignores/);
      assert.equal(module.unexported.get("missing"), undefined);
    });

    it("records where an unsupported declaration is, 1-based", () => {
      const entry = exportOf(`\n  export class Point {}`, "Point");
      assert.deepEqual(entry.kind === "unsupported" ? entry.at : undefined, { line: 2, column: 10 });
    });
  });

  describe("what a file may not do (spec §imported-file-restrictions)", () => {
    it("rejects a syntax error, with its position", () => {
      fileError(`export function f(x: integer: integer {}`, "syntax error: Unexpected token", 1, 29);
    });

    it("rejects importing a value or re-exporting, and allows `import type`", () => {
      fileError(`\nimport { now } from "./clock";`, "it imports from './clock'", 2, 1);
      fileError(`export { now } from "./clock";`, "it re-exports from './clock'", 1, 1);
      fileError(`export * from "./clock";`, "it re-exports from './clock'", 1, 1);
      assert.ok(readBsModule(`import type { integer, float } from "./types";\nexport const n: integer = 1;`).ok);
    });

    it("rejects naming a communication function anywhere, but not a property of that name", () => {
      fileError(
        `export function report(x: integer): void {\n  sendInteger("bob", "t", x);\n}`,
        "it names the communication function 'sendInteger'",
        2, 3,
      );
      fileError(`const f = receiveFloat;`, "'receiveFloat'", 1, 11);
      assert.ok(readBsModule(`function g(o: any): void { o.sendInteger = 1; }`).ok);
    });
  });
});

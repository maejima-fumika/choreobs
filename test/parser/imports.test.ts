import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse } from "../../src/parser/index.js";
import type { SpecId } from "../../src/spec/ref.js";
import { assertCites } from "../support/spec.js";

/** The one syntax error of `source`, which must fail to parse. */
function parseError(source: string, message: string, spec?: SpecId) {
  const { program, errors } = parse(source);
  assert.equal(program, null, `expected a syntax error: ${source}`);
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.ok(errors[0]!.message.includes(message), JSON.stringify(errors));
  if (spec !== undefined) {
    assertCites(errors, spec);
  }
  return errors[0]!;
}

describe("import declarations (spec §import-declarations)", () => {
  it("parses the location, the names and the module, apart from the items", () => {
    const source = `import@alice { foo as fooAtAlice, foo2 } from "./foo@alice";
import@bob { now } from "./lib/clock";
let x: integer@alice = fooAtAlice();
`;
    const { program, errors } = parse(source);
    assert.deepEqual(errors, []);
    assert.ok(program);
    assert.equal(program.items.length, 1);
    assert.equal(program.imports.length, 2);
    const [first, second] = program.imports;
    assert.deepEqual(first!.at.location, { kind: "individual", name: "alice" });
    assert.deepEqual(
      first!.specifiers.map((s) => [s.imported, s.local]),
      [["foo", "fooAtAlice"], ["foo2", "foo2"]],
    );
    assert.equal(first!.module.value, "./foo@alice");
    assert.equal(source.slice(first!.module.span.start, first!.module.span.end), `"./foo@alice"`);
    assert.equal(source.slice(first!.specifiers[0]!.span.start, first!.specifiers[0]!.span.end), "foo as fooAtAlice");
    assert.equal(second!.module.value, "./lib/clock");
    assert.equal(program.span.start, 0);
  });

  it("gives a program without imports an empty list", () => {
    const { program } = parse(`let x: integer@alice = 1@alice;`);
    assert.deepEqual(program?.imports, []);
  });

  it("accepts any location after '@', for the resolver to judge (spec §invalid-import-location)", () => {
    for (const at of ["every", "dyn", "carol"]) {
      const { errors } = parse(`import@${at} { now } from "./clock";`);
      assert.deepEqual(errors, [], at);
    }
  });

  it("imports a name that is a reserved word only under another name", () => {
    const { program, errors } = parse(`import@alice { every as each, string as text } from "./words";`);
    assert.deepEqual(errors, []);
    assert.deepEqual(program?.imports[0]!.specifiers.map((s) => [s.imported, s.local]), [["every", "each"], ["string", "text"]]);
    parseError(`import@alice { every } from "./words";`, "'every' is a reserved word in ChoreoBS: import it under another name with 'as'", "import-declarations");
    parseError(`import@alice { now as every } from "./clock";`, "expected a name after 'as'", "import-declarations");
  });

  it("leaves `from` an ordinary identifier elsewhere (spec §keywords)", () => {
    const { errors } = parse(`let from: integer@alice = 1@alice;\nlet y: integer@alice = from;`);
    assert.deepEqual(errors, []);
  });

  describe("syntax errors", () => {
    it("requires a location", () => {
      parseError(`import { now } from "./clock";`, "an import declaration names the endpoint it imports at", "invalid-import-location");
    });

    it("requires at least one name, and no comma after the last", () => {
      parseError(`import@alice {} from "./clock";`, "imports at least one name", "import-declarations");
      parseError(`import@alice { now, } from "./clock";`, "expected a name to import", "import-declarations");
      parseError(`import@alice { now later } from "./clock";`, "expected ',' or '}' after an imported name");
    });

    it("requires `from`, a string and `;`", () => {
      parseError(`import@alice { now } of "./clock";`, "expected 'from' after '}'", "import-declarations");
      parseError(`import@alice { now } from clock;`, "expected the file to import from, as a string, after 'from'", "import-declarations");
      parseError(`import@alice { now } from "./clock"`, "expected ';' after import declaration");
    });
  });

  describe("imports come first, at top level (spec §misplaced-import-declaration)", () => {
    const MISPLACED = "an import declaration must come before every function and statement";

    it("rejects an import after a statement", () => {
      parseError(`let x: integer@alice = 1@alice;\nimport@alice { now } from "./clock";`, MISPLACED, "misplaced-import-declaration");
    });

    it("rejects an import after a function", () => {
      parseError(`function f@alice(): void {}\nimport@alice { now } from "./clock";`, MISPLACED, "misplaced-import-declaration");
    });

    it("rejects an import in a block or a function body", () => {
      parseError(`if (true@every) {\n  import@alice { now } from "./clock";\n}`, MISPLACED, "misplaced-import-declaration");
      parseError(`function f@alice(): void {\n  import@alice { now } from "./clock";\n}`, MISPLACED, "misplaced-import-declaration");
    });

    it("no longer reports `import` as unsupported (spec §keywords)", () => {
      const { errors } = parse(`import;`);
      assert.equal(errors.length, 1);
      assert.ok(!errors[0]!.message.includes("is not supported"), errors[0]!.message);
    });
  });
});

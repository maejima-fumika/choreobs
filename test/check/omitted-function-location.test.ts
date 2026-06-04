import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse } from "../../src/parser/index.js";
import { typeCheck } from "../../src/check/index.js";
import { project } from "../../src/epp/index.js";
import { cleanupProgram } from "../../src/cleanup/index.js";
import { emit } from "../../src/emit/index.js";
import type { ChoreoBSConfig } from "../../src/config/types.js";
import type { TypedFunctionDeclaration } from "../../src/ast/typed.js";

const config: ChoreoBSConfig = { participants: ["alice", "bob"] };

function parseFn(source: string) {
  const { program, errors } = parse(source);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  const fn = program?.items[0];
  assert.ok(fn && fn.kind === "FunctionDeclaration");
  return fn;
}

function check(source: string) {
  const { program, errors: parseErrors } = parse(source);
  assert.equal(parseErrors.length, 0, JSON.stringify(parseErrors));
  assert.ok(program);
  return typeCheck(program, config);
}

function functionItem(
  typed: NonNullable<ReturnType<typeof typeCheck>["typed"]>,
  index = 0,
): TypedFunctionDeclaration {
  const item = typed.items[index];
  assert.ok(item && "decl" in item);
  return item;
}

function at(source: string, participant: string): string {
  const { typed, errors } = check(source);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  return emit(cleanupProgram(project(typed!, participant)));
}

describe("omitted function location (spec §18.16.1)", () => {
  describe("parser", () => {
    it("parses function without @Location as @every", () => {
      const fn = parseFn(`function main(): unit@every { return; }`);
      assert.equal(fn.name, "main");
      assert.equal(fn.at.kind, "every");
      assert.equal(fn.context.kind, "every");
    });

    it("keeps explicit @every, @alice, and @bob locations", () => {
      for (const [source, kind, participant] of [
        [`function f@every() { return; }`, "every", undefined],
        [`function g@alice() { return; }`, "concrete", "alice"],
        [`function h@bob() { return; }`, "concrete", "bob"],
      ] as const) {
        const fn = parseFn(source);
        assert.equal(fn.at.kind, kind);
        if (kind === "concrete") {
          assert.equal(fn.at.name, participant);
          assert.equal(fn.context.kind, "local");
        } else {
          assert.equal(fn.context.kind, "every");
        }
      }
    });
  });

  describe("type checker / elaboration", () => {
    it("treats omitted location as choreographic @every, not local", () => {
      const { typed, errors } = check(`
function add(a: integer, b: integer): integer {
  return a + b;
}
`);
      assert.equal(errors.length, 0);
      const fn = functionItem(typed!);
      assert.equal(fn.decl.at.kind, "every");
      assert.equal(fn.decl.context.kind, "every");
      assert.equal(fn.params[0]?.type.location.kind, "dynamic");
      assert.equal(fn.params[1]?.type.location.kind, "dynamic");
    });

    it("matches explicit @every for parameter and return defaults", () => {
      const omitted = check(`function id(a: integer): integer { return a; }`);
      const explicit = check(`function id@every(a: integer): integer { return a; }`);
      assert.equal(omitted.errors.length, 0);
      assert.equal(explicit.errors.length, 0);
      const o = functionItem(omitted.typed!);
      const e = functionItem(explicit.typed!);
      assert.equal(o.decl.at.kind, e.decl.at.kind);
      assert.equal(o.params[0]?.type.location.kind, e.params[0]?.type.location.kind);
      assert.equal(o.returnType.location.kind, e.returnType.location.kind);
    });

    it("keeps explicit local function at concrete location", () => {
      const { typed, errors } = check(`
function add@alice(a: integer, b: integer): integer {
  return a + b;
}
`);
      assert.equal(errors.length, 0);
      const fn = functionItem(typed!);
      assert.equal(fn.decl.at.kind, "concrete");
      if (fn.decl.at.kind === "concrete") {
        assert.equal(fn.decl.at.name, "alice");
      }
      assert.equal(fn.params[0]?.type.location.kind, "concrete");
    });

    it("infers return type using @every rules when location is omitted", () => {
      const { typed, errors } = check(`
function f() {
  return 1@alice;
}
`);
      assert.equal(errors.length, 0);
      const fn = functionItem(typed!);
      assert.equal(fn.decl.at.kind, "every");
      assert.equal(fn.returnType.base, "integer");
      if (fn.returnType.location.kind === "concrete") {
        assert.equal(fn.returnType.location.name, "alice");
      }
    });

    it("rejects incompatible inferred return locations in omitted-location function", () => {
      const { typed, errors } = check(`
function choose(c: boolean@every) {
  if (c) {
    return 1@alice;
  } else {
    return 2@bob;
  }
}
`);
      assert.equal(typed, null);
      assert.ok(errors.some((e) => e.message.includes("location")));
    });

    it("accepts explicit base-only return for cross-location returns", () => {
      const { errors } = check(`
function choose(c: boolean@every): integer {
  if (c) {
    return 1@alice;
  } else {
    return 2@bob;
  }
}
`);
      assert.equal(errors.length, 0);
    });

    it("rejects duplicate definition with explicit @every", () => {
      const { typed, errors } = check(`
function f() {
  return;
}
function f@every() {
  return;
}
`);
      assert.equal(typed, null);
      assert.ok(errors.some((e) => e.message.includes("duplicate function")));
    });

    it("rejects same name at different locations", () => {
      const { typed, errors } = check(`
function f() {
  return;
}
function f@alice() {
  return;
}
`);
      assert.equal(typed, null);
      assert.ok(errors.some((e) => e.message.includes("duplicate function")));
    });

    it("rejects recursion when location defaults to @every", () => {
      const { typed, errors } = check(`
function loop(n: integer) {
  if (n > 0@every) {
    loop(n - 1@every);
  }
}
`);
      assert.equal(typed, null);
      assert.ok(errors.some((e) => e.message.includes("recursive")));
    });
  });

  describe("EPP", () => {
    it("lowers omitted-location @every function with dynamic params and dynAdd", () => {
      const src = `
function add(a: integer, b: integer) {
  return a + b;
}
`;
      const alice = at(src, "alice");
      assert.match(alice, /function add\(a: DynValue, b: DynValue\)/);
      assert.match(alice, /return dynAdd\(a, b\);/);
    });

    it("matches explicit @every lowering for the same body", () => {
      const omitted = at(`function add(a: integer, b: integer) { return a + b; }`, "alice");
      const explicit = at(
        `function add@every(a: integer, b: integer) { return a + b; }`,
        "alice",
      );
      assert.equal(omitted, explicit);
    });
  });
});

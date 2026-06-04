import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse } from "../../src/parser/index.js";
import { typeCheck } from "../../src/check/index.js";
import type { ChoreoBSConfig } from "../../src/config/types.js";

const aliceBob: ChoreoBSConfig = { participants: ["alice", "bob"] };

function check(source: string) {
  const { program, errors: parseErrors } = parse(source);
  assert.equal(parseErrors.length, 0, JSON.stringify(parseErrors));
  assert.ok(program);
  return typeCheck(program, aliceBob);
}

describe("gradual location omission (spec §18.4, §18.16, §18.21)", () => {
  it("defaults omitted function location to @every (§18.16.1)", () => {
    const { typed, errors } = check(
      `function add(a: integer, b: integer): integer { return a + b; }`,
    );
    assert.equal(errors.length, 0, JSON.stringify(errors));
    assert.ok(typed);
    const fn = typed.items[0];
    assert.ok(fn && "decl" in fn);
    assert.equal(fn.decl.at.kind, "every");
    assert.equal(fn.decl.context.kind, "every");
    assert.equal(fn.params[0]?.type.location.kind, "dynamic");
  });

  it("defaults omitted @every function parameters to @dynamic (§18.16.1)", () => {
    const { typed, errors } = check(
      `function id@every(a: integer): integer@dynamic { return a; }`,
    );
    assert.equal(errors.length, 0, JSON.stringify(errors));
    assert.ok(typed);
    const fn = typed.items[0];
    assert.ok(fn && "decl" in fn);
    assert.equal(fn.params[0]?.type.location.kind, "dynamic");
    assert.equal(fn.returnType.location.kind, "dynamic");
  });

  it("accepts an explicit @dynamic parameter in an @every function (§18.16.1)", () => {
    const { errors } = check(
      `function id@every(a: integer@dynamic): integer@dynamic { return a; }`,
    );
    assert.equal(errors.length, 0, JSON.stringify(errors));
  });

  it("defaults local function parameters to the concrete location (§18.4, Core v0)", () => {
    const { typed, errors } = check(
      `function add@alice(a: integer, b: integer): integer { return a + b; }`,
    );
    assert.equal(errors.length, 0, JSON.stringify(errors));
    assert.ok(typed);
    const fn = typed.items[0];
    assert.ok(fn && "decl" in fn);
    assert.equal(fn.params[0]?.type.location.kind, "concrete");
  });

  it("rejects a @dynamic parameter in a local function (§18.21.3)", () => {
    const { typed, errors } = check(
      `function bad@alice(x: integer@dynamic): integer { return 1@alice; }`,
    );
    assert.equal(typed, null);
    assert.ok(errors.some((e) => e.message.includes("dynamic")));
  });

  it("rejects a @dynamic return type in a local function (§18.21.4)", () => {
    const { typed, errors } = check(
      `function bad@alice(): integer@dynamic { return 1@alice; }`,
    );
    assert.equal(typed, null);
    assert.ok(errors.some((e) => e.message.includes("dynamic")));
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse } from "../../src/parser/index.js";
import { typeCheck } from "../../src/check/index.js";
import { project } from "../../src/epp/index.js";
import { cleanupProgram } from "../../src/cleanup/index.js";
import { emit } from "../../src/emit/index.js";
import type { ChoreoBSConfig } from "../../src/config/types.js";

const config: ChoreoBSConfig = { participants: ["alice", "bob"] };

function at(source: string, participant: string): string {
  const { program, errors: parseErrors } = parse(source);
  assert.equal(parseErrors.length, 0, JSON.stringify(parseErrors));
  const { typed, errors } = typeCheck(program!, config);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  return emit(cleanupProgram(project(typed!, participant)));
}

describe("gradual cleanup (spec §18.19)", () => {
  it("preserves nothing(...) wrapping a require helper", () => {
    const src = `
let d = 1;
let x: integer@alice = d;
`;
    const bob = at(src, "bob");
    assert.match(bob, /nothing\(requireIntegerAt\(d, "alice"\)\);/);
  });

  it("preserves nothing(...) wrapping dynamic helper call arguments", () => {
    const src = `
function add3@alice(a: integer, b: integer) {
  return a + b;
}
add3(1, 3);
`;
    const bob = at(src, "bob");
    assert.match(bob, /nothing\(requireIntegerAt\(/);
  });

  it("removes nothing(null, null) produced by static-only absent arguments", () => {
    const src = `
function add@alice(a: integer, b: integer): integer { return a + b; }
let x: integer@alice = add(1@alice, 2@alice);
`;
    const bob = at(src, "bob");
    assert.doesNotMatch(bob, /nothing/);
    assert.doesNotMatch(bob, /add\(/);
  });
});

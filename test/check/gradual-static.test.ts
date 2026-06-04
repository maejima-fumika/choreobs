import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse } from "../../src/parser/index.js";
import { typeCheck } from "../../src/check/index.js";
import type { ChoreoBSConfig } from "../../src/config/types.js";

const aliceBob: ChoreoBSConfig = { participants: ["alice", "bob"] };

function check(source: string, config: ChoreoBSConfig = aliceBob) {
  const { program, errors: parseErrors } = parse(source);
  assert.equal(parseErrors.length, 0, JSON.stringify(parseErrors));
  assert.ok(program);
  return typeCheck(program, config);
}

function expectError(source: string, needle: string, config?: ChoreoBSConfig) {
  const { typed, errors } = check(source, config);
  assert.equal(typed, null, `expected failure for: ${source}`);
  assert.ok(
    errors.some((e) => e.message.includes(needle)),
    `expected error containing "${needle}": ${JSON.stringify(errors)}`,
  );
}

describe("gradual static errors stay compile-time (spec §18.7, §18.21)", () => {
  it("rejects base type mismatch even through @dynamic (§18.7)", () => {
    expectError(
      `
let d = 1;
let s: string@dynamic = d;
`,
      "cannot assign",
    );
  });

  it("rejects base type mismatch when requiring a @dynamic value (§18.7)", () => {
    expectError(
      `
let d = 1;
let s: string@alice = d;
`,
      "cannot assign",
    );
  });

  it("keeps pure static cross-location assignment a compile error (§18.7)", () => {
    expectError(`let x: integer@alice = 1@bob;`, "invalid assignment across locations");
  });

  it("keeps pure static cross-location binary a compile error (§18.7)", () => {
    expectError(
      `
let a: integer@alice = 1@alice;
let b: integer@bob = 2@bob;
let c: integer@alice = a + b;
`,
      "compatible location",
    );
  });

  it("rejects 'dynamic' as a participant name (§18.21.1)", () => {
    expectError(`let x: integer@alice = 1@alice;`, "dynamic", {
      participants: ["alice", "dynamic"],
    });
  });

  it("rejects @dynamic in a local function parameter (§18.21.3)", () => {
    expectError(
      `function bad@alice(x: integer@dynamic): integer { return 1@alice; }`,
      "dynamic",
    );
  });
});

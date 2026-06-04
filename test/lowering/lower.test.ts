import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse } from "../../src/parser/index.js";
import { typeCheck } from "../../src/check/index.js";
import { lowerProgram } from "../../src/lowering/index.js";
import {
  dynBinaryCallee,
  dynUnaryCallee,
  requireScalarCallee,
  requireArrayCallee,
  isGradualRuntimeCallee,
} from "../../src/lowering/runtime.js";
import type { ChoreoBSConfig } from "../../src/config/types.js";

const aliceBob: ChoreoBSConfig = { participants: ["alice", "bob"] };

function lower(source: string) {
  const { program, errors: parseErrors } = parse(source);
  assert.equal(parseErrors.length, 0, JSON.stringify(parseErrors));
  assert.ok(program);
  const { typed, errors } = typeCheck(program, aliceBob);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.ok(typed);
  return lowerProgram(typed);
}

describe("lowering pass (spec §18.8–§18.14)", () => {
  it("flags gradual usage for unlocated literals (§18.4)", () => {
    assert.equal(lower("let x = 1;").usesGradual, true);
  });

  it("flags gradual usage for explicit @dynamic (§18.2)", () => {
    assert.equal(lower("let x: integer@dynamic = 1@alice;").usesGradual, true);
  });

  it("does not flag pure Core v0 programs", () => {
    const lowered = lower(`
let x: integer@alice = 1@alice;
let y: integer@bob <~ x;
`);
    assert.equal(lowered.usesGradual, false);
  });

  it("does not flag a fully static local function", () => {
    const lowered = lower(
      `function add@alice(a: integer, b: integer): integer { return a + b; }`,
    );
    assert.equal(lowered.usesGradual, false);
  });

  it("carries the typed program through unchanged", () => {
    const lowered = lower("let x = 1;");
    assert.equal(lowered.typed.items.length, 1);
  });
});

describe("runtime callee selectors (spec §18.12, §18.10)", () => {
  it("maps binary operators to dyn* helpers", () => {
    assert.equal(dynBinaryCallee("+"), "dynAdd");
    assert.equal(dynBinaryCallee("%"), "dynMod");
    assert.equal(dynBinaryCallee("&&"), "dynAnd");
    assert.equal(dynBinaryCallee("==="), "dynEq");
    assert.equal(dynBinaryCallee("!=="), "dynNeq");
    assert.equal(dynBinaryCallee("<="), "dynLe");
  });

  it("maps unary operators to dyn* helpers", () => {
    assert.equal(dynUnaryCallee("!"), "dynNot");
    assert.equal(dynUnaryCallee("-"), "dynNeg");
  });

  it("maps base types to require helpers", () => {
    assert.equal(requireScalarCallee("integer"), "requireIntegerAt");
    assert.equal(requireScalarCallee("boolean"), "requireBooleanAt");
    assert.equal(requireArrayCallee("float"), "requireFloatArrayAt");
  });

  it("recognizes gradual runtime callees", () => {
    assert.equal(isGradualRuntimeCallee("dynAdd"), true);
    assert.equal(isGradualRuntimeCallee("packDynamic"), true);
    assert.equal(isGradualRuntimeCallee("requireIntegerAt"), true);
    assert.equal(isGradualRuntimeCallee("add3"), false);
  });
});

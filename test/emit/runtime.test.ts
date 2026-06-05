import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emitRuntimeModule } from "../../src/emit/runtime.js";

describe("DynValue runtime module (spec §18.20)", () => {
  it("specializes HERE for the endpoint", () => {
    assert.match(emitRuntimeModule("alice"), /const HERE: string = "alice";/);
    assert.match(emitRuntimeModule("bob"), /const HERE: string = "bob";/);
  });

  it("defines the DynValue class with copyWrapper", () => {
    const rt = emitRuntimeModule("alice");
    assert.match(rt, /class DynValue \{/);
    assert.match(rt, /copyWrapper\(\): DynValue \{/);
    assert.match(rt, /const EVERY: string = "every";/);
  });

  it("exports runtime definitions for import from endpoint programs", () => {
    const rt = emitRuntimeModule("alice");
    assert.match(rt, /export class DynValue/);
    assert.match(rt, /export const EVERY/);
    assert.match(rt, /export function packDynamic/);
  });

  it("defines packing, require, operator, communication, and array helpers", () => {
    const rt = emitRuntimeModule("alice");
    for (const name of [
      "packDynamic",
      "requireIntegerAt",
      "requireFloatAt",
      "requireBooleanAt",
      "requireStringAt",
      "requireIntegerArrayAt",
      "requireCondition",
      "dynAdd",
      "dynSub",
      "dynMul",
      "dynDiv",
      "dynMod",
      "dynAnd",
      "dynOr",
      "dynLt",
      "dynLe",
      "dynGt",
      "dynGe",
      "dynEq",
      "dynNeq",
      "dynNot",
      "dynNeg",
      "dynMove",
      "dynArrayGet",
      "dynArraySet",
      "dynArrayPush",
      "dynArrayLength",
      "sendAny",
      "receiveAny",
      "broadcastAny",
      "clonePayload",
    ]) {
      assert.match(rt, new RegExp(`function ${name}\\b`), `missing ${name}`);
    }
  });
});

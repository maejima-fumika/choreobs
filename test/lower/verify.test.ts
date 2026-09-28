import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tagSource } from "../support/pipeline.js";
import { lowerDyn, verifyLowered } from "../../src/lower/index.js";
import type {
  LoweredProgram,
  TypedLetStatement,
  TypedTopLevelStatement,
} from "../../src/ast/typed.js";

/**
 * `verifyLowered` is the check that `lowerDyn` left nothing for endpoint
 * projection to get silently wrong (spec-dyn.md, section 8.2). These tests
 * break a lowered program by hand and expect it to say so.
 */

function lowered(source: string): LoweredProgram {
  return lowerDyn(tagSource(source));
}

/** The lowered program with the initializer of its `index`th top-level `let` replaced. */
function withInitializer(
  program: LoweredProgram,
  index: number,
  replace: (let_: TypedLetStatement) => TypedLetStatement["initializer"],
): LoweredProgram {
  const items = program.items.map((item, i) => {
    if (i !== index) {
      return item;
    }
    const top = item as TypedTopLevelStatement;
    const let_ = top.statement as TypedLetStatement;
    return { ...top, statement: { ...let_, initializer: replace(let_) } };
  });
  return { ...program, items };
}

describe("verifyLowered (spec-dyn.md, section 8.2)", () => {
  const source = `
let d: integer@dyn = 1@dyn;
let x: integer@alice = d;
`;

  it("accepts what lowerDyn produces", () => {
    verifyLowered(lowered(source));
  });

  it("rejects a cast that was left out", () => {
    const program = lowered(source);
    // `x`'s initializer is `__cast(d, "alice")`; put the bare `d` back.
    const broken = withInitializer(program, 1, (let_) => {
      assert.equal(let_.initializer.expr.kind, "RuntimeCallExpression");
      return (let_.initializer as { args: readonly TypedLetStatement["initializer"][] }).args[0]!;
    });
    assert.throws(() => verifyLowered(broken), /let initializer is integer@dyn where alice is required/);
  });

  it("rejects a dyn literal that was not lowered", () => {
    const typed = tagSource(source);
    const unlowered: LoweredProgram = { ...typed, kind: "LoweredProgram" };
    assert.throws(() => verifyLowered(unlowered), /literal at dyn was not lowered/);
  });

  it("rejects a dynamic transfer that was not lowered", () => {
    const typed = tagSource(`let d: integer@dyn = 1@dyn;
let t: integer@bob <- d;`);
    const partly = lowerDyn(typed);
    const unlowered: LoweredProgram = {
      ...partly,
      items: [partly.items[0]!, typed.items[1]!],
    };
    assert.throws(() => verifyLowered(unlowered), /dynamic transfer was not lowered/);
  });

  it("rejects a runtime call with the wrong location shape", () => {
    const program = lowered(`let a: integer@alice = 1@alice;
let y: integer@dyn = a;`);
    // `y`'s initializer is `__inject(a, "alice")`; claim it yields a value at alice.
    const broken = withInitializer(program, 1, (let_) => ({
      ...let_.initializer,
      choreoType: { ...let_.initializer.choreoType, location: { kind: "individual", name: "alice" } },
    }));
    assert.throws(() => verifyLowered(broken), /__inject must yield a dyn value/);
  });
});

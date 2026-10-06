import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tagSource } from "../support/pipeline.js";
import { lowerDyn, verifyLowered } from "../../src/lower/index.js";
import type {
  LoweredProgram,
  TypedExpression,
  TypedLetStatement,
  TypedRuntimeCallExpression,
  TypedTopLevelStatement,
} from "../../src/ast/typed.js";

/**
 * `verifyLowered` is the check that `lowerDyn` left nothing for endpoint
 * projection to get silently wrong (spec §dyn-lowering). These tests
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

describe("verifyLowered (spec §dyn-lowering)", () => {
  const source = `
let d: integer@dyn = 1@dyn;
let x: integer@alice = d;
`;

  it("accepts what lowerDyn produces", () => {
    verifyLowered(lowered(source));
  });

  it("rejects a cast that was left out", () => {
    const program = lowered(source);
    // `x`'s initializer is `__cast(d, __loc_alice)`; put the bare `d` back.
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
    // `y`'s initializer is `__inject(a, __loc_alice)`; claim it yields a value at alice.
    const broken = withInitializer(program, 1, (let_) => ({
      ...let_.initializer,
      choreoType: { ...let_.initializer.choreoType, location: { kind: "individual", name: "alice" } },
    }));
    assert.throws(() => verifyLowered(broken), /__inject must yield a dyn value/);
  });

  /** The lowered program with argument `at` of the runtime call that initializes `let` `index` replaced. */
  function withArgument(
    program: LoweredProgram,
    index: number,
    at: number,
    replace: (arg: TypedExpression) => TypedExpression,
  ): LoweredProgram {
    return withInitializer(program, index, (let_) => {
      const call = let_.initializer as TypedRuntimeCallExpression;
      assert.equal(call.expr.kind, "RuntimeCallExpression");
      return { ...call, args: call.args.map((arg, i) => (i === at ? replace(arg) : arg)) };
    });
  }

  const asString = (arg: TypedExpression, value: string): TypedExpression => {
    const literal = {
      kind: "LocatedLiteral" as const,
      literal: { kind: "StringLiteral" as const, value, span: arg.expr.span },
      span: arg.expr.span,
    };
    return {
      expr: { kind: "LiteralExpression", literal, span: arg.expr.span },
      choreoType: { base: "string", location: { kind: "every" } },
      literal,
    } as TypedExpression;
  };

  /** `arg` replaced by the identifier `name`, of the same type. */
  const renamed = (arg: TypedExpression, name: string): TypedExpression =>
    ({
      expr: { kind: "IdentifierExpression", name, span: arg.expr.span },
      choreoType: arg.choreoType,
    }) as TypedExpression;

  it("rejects a location given as a string (spec §location-and-kind-codes)", () => {
    const broken = withArgument(lowered(source), 1, 1, (arg) => asString(arg, "alice"));
    assert.throws(() => verifyLowered(broken), /expected a location constant argument/);
  });

  it("rejects a kind constant where a location constant belongs", () => {
    const broken = withArgument(lowered(source), 1, 1, (arg) => renamed(arg, "__kind_integer"));
    assert.throws(() => verifyLowered(broken), /expected a location constant argument/);
  });

  it("rejects a cast to one location that claims another", () => {
    const broken = withArgument(lowered(source), 1, 1, (arg) => renamed(arg, "__loc_bob"));
    assert.throws(() => verifyLowered(broken), /__cast\(…, __loc_bob\) must yield a value at bob/);
  });

  it("rejects an inject whose constant names another location than its value's", () => {
    const program = lowered(`let a: integer@alice = 1@alice;
let y: integer@dyn = a;`);
    // `y`'s initializer is `__inject(a, __loc_alice)`.
    const broken = withArgument(program, 1, 1, (arg) => renamed(arg, "__loc_bob"));
    assert.throws(() => verifyLowered(broken), /__inject\(…, __loc_bob\) must take a value at bob/);
  });

  it("rejects a dynamic transfer whose tag, kind or location is not of its shape", () => {
    const transfer = `let d: integer@dyn = 1@dyn;
let t: integer@dyn <- d;`;
    const program = lowered(transfer);
    assert.throws(
      () => verifyLowered(withArgument(program, 1, 0, (arg) => renamed(arg, "__top_0"))),
      /expected a string@every tag argument/,
    );
    assert.throws(
      () => verifyLowered(withArgument(program, 1, 1, (arg) => asString(arg, "integer"))),
      /expected a kind constant argument/,
    );
    assert.throws(
      () => verifyLowered(withArgument(program, 1, 2, (arg) => renamed(arg, "__kind_integer"))),
      /expected a location constant argument/,
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FunctionDeclaration } from "../../src/ast/declarations.js";
import type { Expression } from "../../src/ast/expressions.js";
import type { Block } from "../../src/ast/statements.js";
import { parse } from "../../src/parser/index.js";
import { locatedType } from "../../src/types/located.js";
import {
  checkReturnCoverage,
  collectReturnCandidates,
  inferFunctionReturnType,
  lubBase,
  lubLocatedType,
  lubLocation,
  type ExprTypeResolver,
} from "../../src/check/inference.js";

const alice = { kind: "individual" as const, name: "alice" };
const every = { kind: "every" as const };

function parseFunctionBody(bodySource: string): Block {
  const { program, errors } = parse(`function f@alice() { ${bodySource} }`);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  const fn = program!.items[0];
  assert.equal(fn?.kind, "FunctionDeclaration");
  return (fn as FunctionDeclaration).body;
}

const literalResolver: ExprTypeResolver = (expr: Expression) => {
  if (expr.kind !== "LiteralExpression") {
    return { ok: false, message: "test resolver supports literals only" };
  }
  // Locations are never inferred from context (spec §8.1), so read the written
  // annotation, exactly as the checker does.
  const written = expr.literal.location?.location;
  if (written === undefined) {
    return { ok: false, message: "location annotation required on literal" };
  }
  switch (expr.literal.literal.kind) {
    case "IntegerLiteral":
      return { ok: true, value: locatedType("integer", written) };
    case "FloatLiteral":
      return { ok: true, value: locatedType("float", written) };
    case "BooleanLiteral":
      return { ok: true, value: locatedType("boolean", written) };
    default:
      return { ok: false, message: "unsupported literal in test resolver" };
  }
};

describe("return inference utilities (spec §7.14.4)", () => {
  describe("lubBase", () => {
    it("computes numeric lubs", () => {
      const ii = lubBase("integer", "integer");
      assert.equal(ii.ok, true);
      if (ii.ok) {
        assert.equal(ii.value, "integer");
      }
      const ift = lubBase("integer", "float");
      assert.equal(ift.ok, true);
      if (ift.ok) {
        assert.equal(ift.value, "float");
      }
      const fi = lubBase("float", "integer");
      assert.equal(fi.ok, true);
      if (fi.ok) {
        assert.equal(fi.value, "float");
      }
      const ff = lubBase("float", "float");
      assert.equal(ff.ok, true);
      if (ff.ok) {
        assert.equal(ff.value, "float");
      }
    });

    it("accepts identical non-numeric types", () => {
      const bb = lubBase("boolean", "boolean");
      assert.equal(bb.ok, true);
      if (bb.ok) {
        assert.equal(bb.value, "boolean");
      }
    });

    it("rejects incompatible base types", () => {
      assert.equal(lubBase("integer", "boolean").ok, false);
      assert.equal(lubBase("string", "integer").ok, false);
    });
  });

  describe("lubLocation", () => {
    it("requires equal locations", () => {
      const r = lubLocation(alice, alice);
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.deepEqual(r.value, alice);
      }
    });

    it("rejects different individual locations", () => {
      const bob = { kind: "individual" as const, name: "bob" };
      assert.equal(lubLocation(alice, bob).ok, false);
    });

    it("rejects every with individual", () => {
      assert.equal(lubLocation(every, alice).ok, false);
    });
  });

  describe("lubLocatedType", () => {
    it("joins integer and float at the same location", () => {
      const r = lubLocatedType(
        locatedType("integer", alice),
        locatedType("float", alice),
      );
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal(r.value.base, "float");
        assert.deepEqual(r.value.location, alice);
      }
    });

    it("fails when locations differ", () => {
      const bob = { kind: "individual" as const, name: "bob" };
      assert.equal(
        lubLocatedType(locatedType("integer", alice), locatedType("integer", bob)).ok,
        false,
      );
    });
  });

  describe("checkReturnCoverage", () => {
    it("accepts a final return expr", () => {
      const body = parseFunctionBody("return 1@alice;");
      assert.equal(checkReturnCoverage(body), true);
    });

    it("accepts if/else with both branches returning", () => {
      const body = parseFunctionBody(`
if (true@alice) {
  return 1@alice;
} else {
  return 2.0@alice;
}
`);
      assert.equal(checkReturnCoverage(body), true);
    });

    it("accepts nested if/else coverage", () => {
      const body = parseFunctionBody(`
if (true@alice) {
  if (false@alice) {
    return 1@alice;
  } else {
    return 2@alice;
  }
} else {
  return 3@alice;
}
`);
      assert.equal(checkReturnCoverage(body), true);
    });

    it("rejects if without else even when then returns", () => {
      const body = parseFunctionBody(`
if (true@alice) {
  return 1@alice;
}
`);
      assert.equal(checkReturnCoverage(body), false);
    });

    it("rejects trailing non-return after guarded returns", () => {
      const body = parseFunctionBody(`
if (true@alice) {
  return 1@alice;
} else {
  return 2@alice;
}
let x = 1@alice;
`);
      assert.equal(checkReturnCoverage(body), false);
    });
  });

  describe("inferFunctionReturnType", () => {
    it("infers void when there are no returns", () => {
      const body = parseFunctionBody("let x = 1@alice;");
      const r = inferFunctionReturnType(body, alice, literalResolver);
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal(r.value.base, "void");
        assert.deepEqual(r.value.location, alice);
      }
    });

    it("infers float from mixed integer and float returns", () => {
      const body = parseFunctionBody(`
if (true@alice) {
  return 1@alice;
} else {
  return 2.0@alice;
}
`);
      const r = inferFunctionReturnType(body, alice, literalResolver);
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal(r.value.base, "float");
        assert.deepEqual(r.value.location, alice);
      }
    });

    it("rejects mixing bare and value returns", () => {
      const body = parseFunctionBody(`
return;
return 1@alice;
`);
      const r = inferFunctionReturnType(body, alice, literalResolver);
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.ok(r.message.includes("§7.14.5"));
      }
    });

    it("rejects value returns without coverage", () => {
      const body = parseFunctionBody(`
if (true@alice) {
  return 1@alice;
}
`);
      const r = inferFunctionReturnType(body, alice, literalResolver);
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.ok(r.message.includes("§7.14.6"));
      }
    });
  });

  describe("collectReturnCandidates", () => {
    it("collects returns from nested blocks", () => {
      const body = parseFunctionBody(`
if (true@alice) {
  return 1@alice;
} else {
  return 2@alice;
}
return 3@alice;
`);
      const r = collectReturnCandidates(body, literalResolver);
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal(r.value.length, 3);
        assert.ok(r.value.every((c) => c.kind === "value"));
      }
    });
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FunctionDeclaration } from "../../src/ast/declarations.js";
import type { Block } from "../../src/ast/statements.js";
import { parse } from "../../src/parser/index.js";
import { locatedType } from "../../src/types/located.js";
import {
  checkReturnCoverage,
  inferReturnTypeFromCandidates,
  lubBase,
  lubLocatedType,
  lubLocation,
  type ReturnCandidate,
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

describe("return inference utilities (spec §function-return-type-inference)", () => {
  describe("lubBase", () => {
    it("returns T for lub(T, T)", () => {
      for (const base of ["integer", "float", "boolean", "string", "null"] as const) {
        const r = lubBase(base, base);
        assert.equal(r.ok, true, base);
        if (r.ok) {
          assert.equal(r.value, base);
        }
      }
    });

    it("rejects incompatible base types", () => {
      assert.equal(lubBase("integer", "boolean").ok, false);
      assert.equal(lubBase("string", "integer").ok, false);
    });

    it("gives integer and float no lub, in either order (spec §subtyping)", () => {
      assert.equal(lubBase("integer", "float").ok, false);
      assert.equal(lubBase("float", "integer").ok, false);
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

    it("is ⊔ with dyn: dyn absorbs any location (spec-dyn.md, section 3.1)", () => {
      const dyn = { kind: "dyn" as const };
      for (const other of [alice, every, dyn]) {
        const r = lubLocation(other, dyn);
        assert.equal(r.ok, true);
        if (r.ok) {
          assert.deepEqual(r.value, dyn);
        }
      }
    });

    it("gives dyn for two concrete locations only when asked to (spec-dyn.md, section 4.3)", () => {
      const r = lubLocation(every, alice, "dyn");
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal(r.value.kind, "dyn");
      }
      const strict = lubLocation(every, alice, "error");
      assert.equal(strict.ok, false);
      if (!strict.ok) {
        assert.ok(strict.spec.includes("incompatible-inferred-return-locations"));
      }
    });
  });

  describe("lubLocatedType", () => {
    it("does not join integer and float at the same location", () => {
      const r = lubLocatedType(
        locatedType("integer", alice),
        locatedType("float", alice),
      );
      assert.equal(r.ok, false);
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

  describe("inferReturnTypeFromCandidates", () => {
    const span = { start: 0, end: 1 };
    const value = (type: ReturnType<typeof locatedType>): ReturnCandidate => ({
      kind: "value",
      type,
      span,
    });
    const bare: ReturnCandidate = { kind: "void", span };

    it("infers void when there are no returns (§function-return-type-inference)", () => {
      const body = parseFunctionBody("let x = 1@alice;");
      const r = inferReturnTypeFromCandidates(body, alice, []);
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal(r.value.base, "void");
        assert.deepEqual(r.value.location, alice);
      }
    });

    it("rejects mixed integer and float returns (§function-return-type-inference)", () => {
      const body = parseFunctionBody(`
if (true@alice) {
  return 1@alice;
} else {
  return 2.0@alice;
}
`);
      const r = inferReturnTypeFromCandidates(body, alice, [
        value(locatedType("integer", alice)),
        value(locatedType("float", alice)),
      ]);
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.ok(r.message.includes("incompatible return types"), r.message);
        assert.deepEqual(r.spec, ["function-return-type-inference"]);
      }
    });

    it("rejects mixing bare and value returns (§mixing-return-and-return-expr)", () => {
      const body = parseFunctionBody(`
return;
return 1@alice;
`);
      const r = inferReturnTypeFromCandidates(body, alice, [
        bare,
        value(locatedType("integer", alice)),
      ]);
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.deepEqual(r.spec, ["mixing-return-and-return-expr"]);
      }
    });

    it("rejects value returns without coverage (§return-coverage-for-non-void-functions)", () => {
      const body = parseFunctionBody(`
if (true@alice) {
  return 1@alice;
}
`);
      const r = inferReturnTypeFromCandidates(body, alice, [
        value(locatedType("integer", alice)),
      ]);
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.deepEqual(r.spec, ["return-coverage-for-non-void-functions"]);
      }
    });
  });
});

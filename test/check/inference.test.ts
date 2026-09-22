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

    it("infers float from mixed integer and float returns (§function-return-type-inference)", () => {
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
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal(r.value.base, "float");
        assert.deepEqual(r.value.location, alice);
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

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileSource } from "../../src/driver/index.js";
import type { CompileResult } from "../../src/driver/index.js";

const aliceBob: { participants: string[] } = { participants: ["alice", "bob"] };
const aliceBobCarol: { participants: string[] } = {
  participants: ["alice", "bob", "carol"],
};

function compile(
  source: string,
  config: { participants: string[] } = aliceBob,
): CompileResult {
  return compileSource(source, "index.cbs", config);
}

function bs(result: CompileResult, participant: string): string {
  const hit = result.outputs.find((o) => o.participant === participant);
  assert.ok(hit, `missing output for ${participant}`);
  return hit.source.trimEnd();
}

function expectSuccess(result: CompileResult): void {
  assert.equal(
    result.success,
    true,
    `expected success, errors: ${JSON.stringify(result.errors)}`,
  );
}

describe("EPP and cleanup — full pipeline (spec §13.9, §15)", () => {
  describe("§15.7 cleanup via compileSource", () => {
    it("removes bob body for alice-only top-level let", () => {
      const source = `let x: integer@alice = 1@alice;`;
      const result = compile(source);
      expectSuccess(result);
      assert.match(bs(result, "alice"), /let x: integer = 1/);
      assert.equal(bs(result, "bob"), "");
      assert.doesNotMatch(bs(result, "bob"), /nothing|null/);
    });

    it("removes nested nothing statement at uninvolved participant", () => {
      const source = `
let a: integer@alice = 1@alice;
let b: integer@bob = 2@bob;
`;
      const result = compile(source);
      expectSuccess(result);
      assert.equal(bs(result, "bob"), `let b: integer = 2;`);
      assert.doesNotMatch(bs(result, "bob"), /nothing/);
    });
  });

  describe("§15.4 @every function — nothing(choose(c)) regression", () => {
    const chooseSource = `
function choose@every(c: boolean@every): integer@alice {
  if (c) {
    return 1@alice;
  } else {
    return 0@alice;
  }
}
let c: boolean@every = true@every;
let x: integer@alice = choose(c);
`;

    it("preserves nothing(choose(c)) on bob after cleanup (spec §15.4 note)", () => {
      const result = compile(chooseSource);
      expectSuccess(result);
      const bob = bs(result, "bob");
      assert.match(bob, /nothing\(choose\(c\)\);/);
      assert.doesNotMatch(bob, /^choose\(c\);$/m);
      assert.doesNotMatch(bob, /^null;$/m);
    });

    it("does not simplify nothing(choose(c)) to null on bob", () => {
      const result = compile(chooseSource);
      expectSuccess(result);
      const bob = bs(result, "bob");
      assert.doesNotMatch(bob, /nothing\(null\)/);
      assert.doesNotMatch(bob, /nothing\(choose\(c\), null\)/);
    });
  });

  describe("§15.2 broadcast — if branch cleanup at alice", () => {
    it("removes nothing from empty if branches on alice after cleanup", () => {
      const source = `
let localOk: boolean@alice = true@alice;
let ok: boolean@every <~ localOk;

if (ok) {
  let msg: string@bob = "ok"@bob;
} else {
  let msg: string@bob = "ng"@bob;
}
`;
      const result = compile(source);
      expectSuccess(result);
      const alice = bs(result, "alice");
      assert.match(alice, /broadcastBoolean\("top_0", localOk\)/);
      assert.match(alice, /if \(ok\) \{\s*\} else \{\s*\}/);
      assert.doesNotMatch(alice, /nothing/);
    });

    it("keeps bob-side bindings inside if branches", () => {
      const source = `
let localOk: boolean@alice = true@alice;
let ok: boolean@every <~ localOk;

if (ok) {
  let msg: string@bob = "ok"@bob;
} else {
  let msg: string@bob = "ng"@bob;
}
`;
      const result = compile(source);
      expectSuccess(result);
      const bob = bs(result, "bob");
      assert.match(bob, /receiveBoolean\("alice", "top_0"\)/);
      assert.match(bob, /let msg: string = "ok"/);
      assert.match(bob, /let msg: string = "ng"/);
    });
  });

  describe("multi-participant broadcast (spec §11.3)", () => {
    it("emits broadcast on sender and receive on all other participants", () => {
      const source = `
let x: boolean@alice = true@alice;
let ok: boolean@every <~ x;
`;
      const result = compile(source, aliceBobCarol);
      expectSuccess(result);
      assert.equal(result.outputs.length, 3);

      assert.match(
        bs(result, "alice"),
        /broadcastBoolean\("top_0", x\)/,
      );
      assert.match(
        bs(result, "bob"),
        /let ok: boolean = receiveBoolean\("alice", "top_0"\)/,
      );
      assert.match(
        bs(result, "carol"),
        /let ok: boolean = receiveBoolean\("alice", "top_0"\)/,
      );
      assert.equal(bs(result, "bob"), bs(result, "carol"));
    });
  });

  describe("for-loop communication EPP (spec §15.6)", () => {
    it("reuses top_0 tag on each loop iteration at both endpoints", () => {
      const source = `
for (
  let i: integer@every = 0@every;
  i < 2@every;
  i = i + 1@every
) {
  let x: integer@alice = i;
  let y: integer@bob <~ x;
}
`;
      const result = compile(source);
      expectSuccess(result);
      const alice = bs(result, "alice");
      const bob = bs(result, "bob");
      assert.match(alice, /sendInteger\("bob", "top_0", x\)/);
      assert.match(bob, /receiveInteger\("alice", "top_0"\)/);
      assert.doesNotMatch(alice, /top_1/);
    });
  });

  it("does not emit invalid index-assignment artifacts on unavailable endpoint", () => {
    const result = compile(`
let xs: integer[]@alice = [1, 2]@alice;
xs[0@alice] = 9@alice;
`);
    expectSuccess(result);
    const bob = bs(result, "bob");
    assert.doesNotMatch(bob, /null\[null\]/);
  });
});

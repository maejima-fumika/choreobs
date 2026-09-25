import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tagSource } from "../support/pipeline.js";
import { TOP_SCOPE } from "../../src/comm/tags.js";
import type {
  TypedProgram,
  TypedStatement,
  TypedBlock,
  TypedLetTransferStatement,
  TypedTransferStatement,
  TypedIfStatement,
  TypedWhileStatement,
  TypedForStatement,
} from "../../src/ast/typed.js";

type Transfer = TypedLetTransferStatement | TypedTransferStatement;

/**
 * Every transfer in the program, in source order, paired with the scope it
 * was numbered in. Mirrors the traversal `assignCommTags` performs, so a tag
 * that drifts out of order shows up as a mismatched pair rather than a
 * missing one.
 */
function transfers(typed: TypedProgram): { scope: string; tag?: string }[] {
  const out: { scope: string; tag?: string }[] = [];

  const walkBlock = (scope: string, block: TypedBlock): void => {
    for (const stmt of block.statements) {
      walkStatement(scope, stmt);
    }
  };

  const walkStatement = (scope: string, stmt: TypedStatement): void => {
    switch (stmt.stmt.kind) {
      case "LetTransferStatement":
      case "TransferStatement":
        out.push({ scope, tag: (stmt as Transfer).commTag });
        return;
      case "IfStatement": {
        const s = stmt as TypedIfStatement;
        walkBlock(scope, s.then);
        if (s.else !== undefined) {
          walkBlock(scope, s.else);
        }
        return;
      }
      case "WhileStatement":
        walkBlock(scope, (stmt as TypedWhileStatement).body);
        return;
      case "ForStatement":
        walkBlock(scope, (stmt as TypedForStatement).body);
        return;
      default:
        return;
    }
  };

  for (const item of typed.items) {
    if ("decl" in item) {
      walkBlock(item.decl.name, item.body);
    } else {
      walkStatement(TOP_SCOPE, item.statement);
    }
  }
  return out;
}

/** Just the tags, in source order; `null` stands for an untagged transfer. */
function tags(typed: TypedProgram): (string | null)[] {
  return transfers(typed).map((t) => t.tag ?? null);
}

describe("comm — assignCommTags (spec §communication-tags)", () => {
  it("numbers top-level transfers in source order", () => {
    const typed = tagSource(`
let a: integer@alice = 1@alice;
let b: integer@bob <- a;
let c: integer@alice <- b;
`);
    assert.deepEqual(tags(typed), ["__top_0", "__top_1"]);
  });

  it("numbers each function in its own scope", () => {
    const typed = tagSource(`
function worker(): void {
  let x: integer@alice = 1@alice;
  let y: integer@bob <- x;
  let z: integer@alice <- y;
}
function other(): void {
  let p: integer@alice = 2@alice;
  let q: integer@bob <- p;
}
let t: integer@alice = 3@alice;
let u: integer@bob <- t;
`);
    assert.deepEqual(transfers(typed), [
      { scope: "worker", tag: "worker_0" },
      { scope: "worker", tag: "worker_1" },
      { scope: "other", tag: "other_0" },
      { scope: TOP_SCOPE, tag: "__top_0" },
    ]);
  });

  it("gives a function named 'top' its own series, since the top-level scope name is reserved", () => {
    const typed = tagSource(`
function top(): void {
  let x: integer@alice = 1@alice;
  let y: integer@bob <- x;
}
let a: integer@alice = 2@alice;
let b: integer@bob <- a;
`);
    // `__top` carries the compiler-reserved prefix (spec §function-names), so no
    // function name can equal it and the two series cannot collide.
    assert.deepEqual(transfers(typed), [
      { scope: "top", tag: "top_0" },
      { scope: TOP_SCOPE, tag: "__top_0" },
    ]);
    const assigned = tags(typed);
    assert.equal(new Set(assigned).size, assigned.length, `tags collided: ${assigned}`);
  });

  it("assigns no tag to a local copy (spec §transfer-typing)", () => {
    const typed = tagSource(`
let e: integer@every = 1@every;
let same: integer@alice = 2@alice;
let a: integer@alice <- e;
let b: integer@alice <- same;
let c: integer@bob <- same;
`);
    assert.deepEqual(tags(typed), [null, null, "__top_0"]);
  });

  it("numbers through nested control structures in source order", () => {
    const typed = tagSource(`
let flag: boolean@every = true@every;
let a: integer@alice = 1@alice;
if (flag) {
  let x: integer@bob <- a;
  while (flag) {
    let y: integer@bob <- a;
  }
} else {
  let z: integer@bob <- a;
  for (let i: integer@every = 0@every; i < 3@every; i = i + 1@every) {
    let w: integer@bob <- a;
  }
}
let last: integer@bob <- a;
`);
    assert.deepEqual(tags(typed), [
      "__top_0", // if-then
      "__top_1", // while inside if-then
      "__top_2", // else
      "__top_3", // for inside else
      "__top_4", // after the if
    ]);
  });

  it("gives a loop body one tag, not one per iteration", () => {
    const typed = tagSource(`
let a: integer@alice = 1@alice;
for (let i: integer@every = 0@every; i < 3@every; i = i + 1@every) {
  let x: integer@bob <- a;
}
`);
    assert.deepEqual(tags(typed), ["__top_0"]);
  });

  it("tags a broadcast like any other communication", () => {
    const typed = tagSource(`
let a: integer@alice = 1@alice;
let shared: integer@every <- a;
let back: integer@bob <- a;
`);
    assert.deepEqual(tags(typed), ["__top_0", "__top_1"]);
  });

  it("leaves the rest of the typed program untouched", () => {
    const source = `
let a: integer@alice = 1@alice;
let b: integer@bob <- a;
`;
    const typed = tagSource(source);
    // The syntactic nodes and resolved types survive the rebuild.
    const item = typed.items[1];
    assert.ok(item && "statement" in item);
    assert.equal(item.statement.stmt.kind, "LetTransferStatement");
    assert.ok("choreoType" in item.statement);
    assert.deepEqual(item.statement.choreoType.location, {
      kind: "individual",
      name: "bob",
    });
  });
});

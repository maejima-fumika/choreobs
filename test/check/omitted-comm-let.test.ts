import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse } from "../../src/parser/index.js";
import { typeCheck } from "../../src/check/index.js";
import { project } from "../../src/epp/index.js";
import { cleanupProgram } from "../../src/cleanup/index.js";
import { emit } from "../../src/emit/index.js";
import type { ChoreoBSConfig } from "../../src/config/types.js";
import type { LocatedType } from "../../src/ast/typed.js";

const config: ChoreoBSConfig = { participants: ["alice", "bob"] };

function checkSource(source: string) {
  const { program, errors: parseErrors } = parse(source);
  assert.equal(parseErrors.length, 0, JSON.stringify(parseErrors));
  assert.ok(program);
  return typeCheck(program, config);
}

function at(source: string, participant: string): string {
  const { typed, errors } = checkSource(source);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  return emit(cleanupProgram(project(typed!, participant)));
}

function commLetType(
  typed: NonNullable<ReturnType<typeof typeCheck>["typed"]>,
  index: number,
): LocatedType | undefined {
  const item = typed.items[index];
  if (item && "statement" in item && "choreoType" in item.statement) {
    return item.statement.choreoType;
  }
  return undefined;
}

describe("communication let with omitted destination type (spec §18.6.1)", () => {
  it("1. infers integer@dynamic from scalar at concrete location", () => {
    const { typed, errors } = checkSource(`let a <~ 14@alice;`);
    assert.equal(errors.length, 0);
    const t = commLetType(typed!, 0);
    assert.equal(t?.base, "integer");
    assert.equal(t?.location.kind, "dynamic");
    assert.match(
      at(`let a <~ 14@alice;`, "alice"),
      /let a: DynValue = dynMove\(packDynamic\(14, "alice"\), "top_0", EVERY\)/,
    );
    assert.match(
      at(`let a <~ 14@alice;`, "bob"),
      /let a: DynValue = dynMove\(packDynamic\(null, "alice"\), "top_0", EVERY\)/,
    );
  });

  it("2. infers float@dynamic from float source", () => {
    const { typed, errors } = checkSource(`let a <~ 14.5@alice;`);
    assert.equal(errors.length, 0);
    const t = commLetType(typed!, 0);
    assert.equal(t?.base, "float");
    assert.equal(t?.location.kind, "dynamic");
  });

  it("3. does not widen integer to float when destination type is omitted", () => {
    const { typed, errors } = checkSource(`let a <~ 14@alice;`);
    assert.equal(errors.length, 0);
    const t = commLetType(typed!, 0);
    assert.equal(t?.base, "integer");
    assert.notEqual(t?.base, "float");
  });

  it("4. explicit float destination still allows integer source via subtyping", () => {
    const { typed, errors } = checkSource(`let a: float <~ 14@alice;`);
    assert.equal(errors.length, 0);
    const t = commLetType(typed!, 0);
    assert.equal(t?.base, "float");
    assert.equal(t?.location.kind, "dynamic");
  });

  it("5. infers integer[]@dynamic from array source", () => {
    const src = `
let xs: integer[]@alice = [1, 2, 3]@alice;
let ys <~ xs;
`;
    const { typed, errors } = checkSource(src);
    assert.equal(errors.length, 0);
    const t = commLetType(typed!, 1);
    assert.equal(t?.base, "integer");
    assert.equal(t?.isArray, true);
    assert.equal(t?.location.kind, "dynamic");
    assert.match(
      at(src, "alice"),
      /let ys: DynValue = dynMove\(packDynamic\(xs, "alice"\), "top_0", EVERY\)/,
    );
    assert.match(
      at(src, "bob"),
      /let ys: DynValue = dynMove\(packDynamic\(null, "alice"\), "top_0", EVERY\)/,
    );
  });

  it("6. accepts dynamic every source and lowers to dynMove with EVERY destination", () => {
    const src = `
let x = 1;
let y <~ x;
`;
    const { errors } = checkSource(src);
    assert.equal(errors.length, 0);
    assert.match(at(src, "alice"), /let y: DynValue = dynMove\(x, "top_0", EVERY\)/);
    assert.match(at(src, "bob"), /let y: DynValue = dynMove\(x, "top_0", EVERY\)/);
  });

  it("7. partially annotated communication let remains integer@dynamic with EVERY", () => {
    const src = `
let x: integer@alice = 1@alice;
let y: integer <~ x;
`;
    const { typed, errors } = checkSource(src);
    assert.equal(errors.length, 0);
    const t = commLetType(typed!, 1);
    assert.equal(t?.base, "integer");
    assert.equal(t?.location.kind, "dynamic");
    assert.match(at(src, "alice"), /dynMove\(packDynamic\(x, "alice"\), "top_0", EVERY\)/);
    assert.match(at(src, "bob"), /dynMove\(packDynamic\(null, "alice"\), "top_0", EVERY\)/);
  });

  it("8. dynamic communication assignment uses variable location not EVERY", () => {
    const src = `
let x: integer@dynamic = 0@alice;
let y: integer@dynamic = 1@bob;
x <~ y;
`;
    const { errors } = checkSource(src);
    assert.equal(errors.length, 0);
    assert.match(at(src, "alice"), /x = dynMove\(y, "top_0", x\.location\)/);
    assert.match(at(src, "bob"), /x = dynMove\(y, "top_0", x\.location\)/);
    assert.doesNotMatch(at(src, "alice"), /x = dynMove\([^,]+, "top_0", EVERY\)/);
    assert.doesNotMatch(at(src, "bob"), /x = dynMove\(y, "top_0", EVERY\)/);
  });

  it("9. explicit base mismatch is static; omitted type accepts source base", () => {
    const { errors: errExplicit } = checkSource(`
let s: string@alice = "hello"@alice;
let x: integer <~ s;
`);
    assert.ok(
      errExplicit.some((e) => e.message.includes("communication type mismatch")),
    );

    const { typed, errors } = checkSource(`
let s: string@alice = "hello"@alice;
let x <~ s;
`);
    assert.equal(errors.length, 0);
    const t = commLetType(typed!, 1);
    assert.equal(t?.base, "string");
    assert.equal(t?.location.kind, "dynamic");
  });
});

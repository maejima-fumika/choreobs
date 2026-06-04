import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse } from "../../src/parser/index.js";
import { typeCheck } from "../../src/check/index.js";
import { project } from "../../src/epp/index.js";
import { cleanupProgram } from "../../src/cleanup/index.js";
import { emit } from "../../src/emit/index.js";
import type { ChoreoBSConfig } from "../../src/config/types.js";

const config: ChoreoBSConfig = { participants: ["alice", "bob"] };

function at(source: string, participant: string): string {
  const { program, errors: parseErrors } = parse(source);
  assert.equal(parseErrors.length, 0, JSON.stringify(parseErrors));
  const { typed, errors } = typeCheck(program!, config);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  return emit(cleanupProgram(project(typed!, participant)));
}

describe("gradual endpoint projection (spec §18.9–§18.18)", () => {
  it("packs a static value at owner and null elsewhere (§18.9)", () => {
    const src = `let x: integer@dynamic = 1@alice;`;
    assert.match(at(src, "alice"), /packDynamic\(1, "alice"\)/);
    assert.match(at(src, "bob"), /packDynamic\(null, "alice"\)/);
  });

  it("wraps a dynamic value in new DynValue with EVERY (§18.3)", () => {
    assert.match(at(`let x = 1;`, "alice"), /new DynValue\(1, EVERY\)/);
    assert.match(at(`let x = 1;`, "bob"), /new DynValue\(1, EVERY\)/);
  });

  it("inserts requireIntegerAt for dynamic-to-static let (§18.10.2)", () => {
    const src = `
let d = 1;
let x: integer@alice = d;
`;
    assert.match(at(src, "alice"), /requireIntegerAt\(d, "alice"\)/);
    // non-owner still evaluates the require, wrapped in nothing(...)
    assert.match(at(src, "bob"), /nothing\(requireIntegerAt\(d, "alice"\)\)/);
  });

  it("lowers dynamic operators to dyn* with packed static operands (§18.12.1)", () => {
    const src = `
let a: integer = 100;
let b: integer = 200;
a + b;
a + 10@alice;
a + 20@every;
`;
    const alice = at(src, "alice");
    assert.match(alice, /dynAdd\(a, b\)/);
    assert.match(alice, /dynAdd\(a, packDynamic\(10, "alice"\)\)/);
    assert.match(alice, /dynAdd\(a, packDynamic\(20, EVERY\)\)/);
    const bob = at(src, "bob");
    assert.match(bob, /dynAdd\(a, packDynamic\(null, "alice"\)\)/);
    assert.match(bob, /dynAdd\(a, packDynamic\(20, EVERY\)\)/);
  });

  it("lowers dynamic unary operators (§18.12.4)", () => {
    const src = `
let f = true;
!f;
`;
    assert.match(at(src, "alice"), /dynNot\(f\)/);
  });

  it("lowers dynamic communication to dynMove (§18.13)", () => {
    const src = `
let a: integer = 100;
let b: integer = 200;
let c: integer = 300@alice;

a <~ b;
a <~ c;
c <~ a;
let d: integer <~ a;
let e: integer@alice <~ a;
`;
    const alice = at(src, "alice");
    assert.match(alice, /let c: integer = 300;/);
    assert.match(alice, /a = dynMove\(b, "top_0", a\.location\);/);
    assert.match(
      alice,
      /a = dynMove\(packDynamic\(c, "alice"\), "top_1", a\.location\);/,
    );
    assert.match(
      alice,
      /c = requireIntegerAt\(dynMove\(a, "top_2", "alice"\), "alice"\);/,
    );
    assert.match(alice, /dynMove\(a, "top_3", EVERY\)/);
    assert.match(
      alice,
      /requireIntegerAt\(dynMove\(a, "top_4", "alice"\), "alice"\)/,
    );

    const bob = at(src, "bob");
    assert.match(
      bob,
      /a = dynMove\(packDynamic\(null, "alice"\), "top_1", a\.location\);/,
    );
    // c <~ a and e have static alice destination: bob keeps the require as a statement
    assert.match(
      bob,
      /requireIntegerAt\(dynMove\(a, "top_2", "alice"\), "alice"\);/,
    );
  });

  it("broadcasts a dynamic communication let with omitted destination (§18.6)", () => {
    const src = `
let x: integer@alice = 1@alice;
let y: integer <~ x;
`;
    assert.match(
      at(src, "alice"),
      /dynMove\(packDynamic\(x, "alice"\), "top_0", EVERY\)/,
    );
    assert.match(
      at(src, "bob"),
      /dynMove\(packDynamic\(null, "alice"\), "top_0", EVERY\)/,
    );
  });

  it("lowers dynamic array get/set/push/length (§18.14)", () => {
    const get = `
let arr = [1, 3, 5];
let i = 0;
arr[i];
`;
    assert.match(at(get, "alice"), /dynArrayGet\(arr, i\)/);

    const set = `
let arr = [1, 3, 5];
arr[0] = 5;
`;
    assert.match(
      at(set, "alice"),
      /dynArraySet\(arr, new DynValue\(0, EVERY\), new DynValue\(5, EVERY\)\)/,
    );
    assert.match(
      at(set, "bob"),
      /dynArraySet\(arr, new DynValue\(0, EVERY\), new DynValue\(5, EVERY\)\)/,
    );

    const pushLen = `
let arr = [1, 3, 5];
push(arr, 3);
let n = length(arr);
`;
    assert.match(at(pushLen, "alice"), /dynArrayPush\(arr, new DynValue\(3, EVERY\)\)/);
    assert.match(at(pushLen, "alice"), /dynArrayLength\(arr\)/);
  });

  it("packs a static array variable for dynamic array set (§18.14.2)", () => {
    const src = `
let arr2 = [1, 3, 5]@alice;
arr2[0] = 3;
`;
    assert.match(
      at(src, "alice"),
      /dynArraySet\(packDynamic\(arr2, "alice"\), new DynValue\(0, EVERY\), new DynValue\(3, EVERY\)\)/,
    );
    assert.match(
      at(src, "bob"),
      /dynArraySet\(packDynamic\(null, "alice"\), new DynValue\(0, EVERY\), new DynValue\(3, EVERY\)\)/,
    );
  });

  it("copies the wrapper for dynamic-to-dynamic assignment (§18.15)", () => {
    const src = `
let xs = [1, 2, 3];
let ys = xs;
push(xs, 4);
`;
    const alice = at(src, "alice");
    assert.match(alice, /let ys: DynValue = xs\.copyWrapper\(\);/);
    assert.match(alice, /dynArrayPush\(xs, new DynValue\(4, EVERY\)\)/);
  });

  it("emits @every functions with dynamic params lowered to dyn* (§18.16.1)", () => {
    const src = `
function add@every(a: integer, b: integer) {
  return a + b;
}
`;
    const alice = at(src, "alice");
    assert.match(alice, /function add\(a: DynValue, b: DynValue\)/);
    assert.match(alice, /return dynAdd\(a, b\);/);
  });

  it("preserves dynamic checks in non-owner local call arguments (§18.16.4)", () => {
    const src = `
function add3@alice(a: integer, b: integer) {
  return a + b;
}
add3(1, 3);
`;
    const alice = at(src, "alice");
    assert.match(
      alice,
      /add3\(requireIntegerAt\(new DynValue\(1, EVERY\), "alice"\), requireIntegerAt\(new DynValue\(3, EVERY\), "alice"\)\)/,
    );
    const bob = at(src, "bob");
    assert.match(
      bob,
      /nothing\(requireIntegerAt\(new DynValue\(1, EVERY\), "alice"\), requireIntegerAt\(new DynValue\(3, EVERY\), "alice"\)\)/,
    );
  });

  it("packs a static local-function result into a dynamic let (§18.16.5)", () => {
    const src = `
function add3@alice(a: integer, b: integer) {
  return a + b;
}
let y: integer@dynamic = add3(1@alice, 2@alice);
`;
    assert.match(at(src, "alice"), /packDynamic\(add3\(1, 2\), "alice"\)/);
    assert.match(at(src, "bob"), /packDynamic\(null, "alice"\)/);
  });

  it("wraps a dynamic condition in requireCondition (§18.17)", () => {
    const src = `
let c = true;
if (c) {
  let x = 1;
}
`;
    assert.match(at(src, "alice"), /if \(requireCondition\(c\)\)/);
    assert.match(at(src, "bob"), /if \(requireCondition\(c\)\)/);
  });
});

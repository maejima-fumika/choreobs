import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tagSource } from "../support/pipeline.js";
import { aliceBobStrict } from "../support/config.js";
import {
  alice,
  bob,
  dyn,
  every,
  expectCheckError,
  expectChecks,
  fnNamed,
  letType,
  topLevelStatements,
} from "../support/check.js";
import type {
  LocatedType,
  TypedExpressionStatement,
  TypedLetStatement,
  TypedLetTransferStatement,
  TypedTopLevelStatement,
} from "../../src/ast/typed.js";
import {
  concreteLocationsAgree,
  formatLocatedType,
  joinLocations,
  locationsCompatible,
  residesAt,
} from "../../src/types/located.js";

/**
 * Gradual locating in the checker (spec §dyn, §omitted-locations): `~` and `⊔`,
 * omission as `dyn`, strict mode, and where `dyn` is not allowed.
 */

function types(...located: LocatedType[]): string[] {
  return located.map(formatLocatedType);
}

describe("location relations (spec §location-consistency-and-join)", () => {
  it("~ accepts dyn with anything and concrete locations only when equal", () => {
    assert.equal(locationsCompatible(alice, dyn), true);
    assert.equal(locationsCompatible(dyn, every), true);
    assert.equal(locationsCompatible(dyn, dyn), true);
    assert.equal(locationsCompatible(alice, alice), true);
    assert.equal(locationsCompatible(alice, bob), false);
    assert.equal(locationsCompatible(alice, every), false);
  });

  it("⊔ is the location itself, or dyn when either side is dyn", () => {
    assert.deepEqual(joinLocations(alice, alice), alice);
    assert.deepEqual(joinLocations(alice, dyn), dyn);
    assert.deepEqual(joinLocations(dyn, every), dyn);
  });

  it("is not transitive, so a construct checks its concrete locations together", () => {
    assert.equal(concreteLocationsAgree([alice, dyn, alice]), true);
    assert.equal(concreteLocationsAgree([dyn, dyn]), true);
    assert.equal(concreteLocationsAgree([alice, dyn, bob]), false);
  });

  it("a dyn value resides at every endpoint (spec §location-matching-and-residency)", () => {
    assert.equal(residesAt(dyn, "alice"), true);
    assert.equal(residesAt(dyn, "bob"), true);
  });
});

describe("typing with ~ and ⊔ (spec §location-consistency-and-join)", () => {
  const decls = `
let d: integer@dyn = 1@dyn;
let a: integer@alice = 2@alice;
let arrAlice: integer[]@alice = [1]@alice;
let arrDyn: integer[]@dyn = [1]@dyn;
`;

  it("places a dyn value at a concrete location and the reverse", () => {
    const typed = expectChecks(`${decls}
let x: integer@alice = d;
let y: integer@dyn = a;
let z: integer@every = d;
`);
    assert.equal(letType(typed, "x"), "integer@alice");
    assert.equal(letType(typed, "y"), "integer@dyn");
    assert.equal(letType(typed, "z"), "integer@every");
  });

  it("locates an operation with a dyn operand at dyn", () => {
    const typed = expectChecks(`${decls}
let s = d + a;
let g = arrAlice[d];
let h = arrDyn[a];
let n = arrDyn.length;
let c = d as float;
let u = -d;
`);
    assert.deepEqual(
      ["s", "g", "h", "n", "c", "u"].map((name) => letType(typed, name)),
      ["integer@dyn", "integer@dyn", "integer@dyn", "integer@dyn", "float@dyn", "integer@dyn"],
    );
  });

  it("accepts a dyn condition in a choreography context (spec §if-condition-typing)", () => {
    expectChecks(`let c: boolean@dyn = true@dyn;
if (c) {}
while (c) {}
`);
  });

  it("accepts element operations that mix dyn with one concrete location", () => {
    expectChecks(`${decls}
arrAlice[d] = a;
arrDyn[a] = d;
arrAlice.push(d);
arrDyn.push(a);
let xs = [a, d];
`);
  });

  it("accepts a print of a dyn value, written or left by an omission (spec §print-typing)", () => {
    const typed = expectChecks(`let d: integer@dyn = 3@dyn;
print(d);
print(1);
`);
    // The void result carries the value's location, so both prints are dynamic.
    for (const stmt of topLevelStatements(typed).slice(1)) {
      assert.ok(stmt.stmt.kind === "ExpressionStatement");
      assert.deepEqual((stmt as TypedExpressionStatement).expression.choreoType.location, dyn);
    }
  });

  it("rejects two concrete locations in an element assignment, dyn or not", () => {
    expectCheckError(
      `${decls}
let b: integer@bob = 3@bob;
arrDyn[a] = b;
`, { message: "must not be at different locations", spec: "element-assignment-across-locations" });
  });

  it("rejects two concrete locations among array elements", () => {
    expectCheckError(
      `let xs = [1@alice, 2@bob]@dyn;`, { message: "array literal elements must not be at different locations", spec: "array-literal-elements-across-locations" });
  });

  it("still rejects two concrete locations in a binary operation", () => {
    expectCheckError(`let x = 1@alice + 2@bob;`, { message: "binary operands must be at the same location" });
  });

  it("keeps base types static: integer and float stay unrelated", () => {
    expectCheckError(`let x: float@dyn = 1@dyn;`, { message: "cannot assign integer", spec: "type-mismatch" });
    expectCheckError(`let x = 1@dyn + 1.5@dyn;`, { message: "same numeric type" });
  });
});

describe("omission is dyn (spec §omitted-locations)", () => {
  // The example of spec §omitted-locations.
  const example = `
3;
let a = 32;
let b: integer <- 32@alice;
function foo(a: integer) {}
function boo(flag: boolean@every) {
    if (flag) { return 3@alice; }
    else { return 4@every; }
}
function bar(): integer {
    return 3@alice;
}
function baz@bob(x: integer) {
    return x + 1;
}
`;

  it("completes the example of spec §omitted-locations", () => {
    const typed = expectChecks(example);
    assert.equal(letType(typed, "a"), "integer@dyn");
    assert.equal(letType(typed, "b"), "integer@dyn");
    assert.deepEqual(types(...fnNamed(typed, "foo").params.map((p) => p.type)), ["integer@dyn"]);
    assert.equal(formatLocatedType(fnNamed(typed, "foo").returnType), "void");
    assert.equal(formatLocatedType(fnNamed(typed, "boo").returnType), "integer@dyn");
    assert.equal(formatLocatedType(fnNamed(typed, "bar").returnType), "integer@alice");
    // A local function's omissions are its location (spec §local-function-location-inference).
    assert.deepEqual(types(...fnNamed(typed, "baz").params.map((p) => p.type)), ["integer@bob"]);
    assert.equal(formatLocatedType(fnNamed(typed, "baz").returnType), "integer@bob");
  });

  it("makes an unannotated array literal dyn, with its bare elements", () => {
    const typed = expectChecks(`let xs = [1, 2]; let ys: float[] = [];`);
    assert.equal(letType(typed, "xs"), "integer[]@dyn");
    assert.equal(letType(typed, "ys"), "float[]@dyn");
  });

  it("gives an empty literal the annotation's element type (spec §array-literal-typing)", () => {
    const typed = expectChecks(`let e: float[]@alice = [];`);
    const item = typed.items[0] as TypedTopLevelStatement;
    const initializer = (item.statement as TypedLetStatement).initializer;
    assert.equal(formatLocatedType(initializer.choreoType), "float[]@dyn");
  });

  it("checks an empty literal's location against the annotation", () => {
    expectCheckError(
      `let xs: integer[]@alice = []@bob;`, { message: "invalid assignment across locations", spec: "invalid-assignment-across-locations" });
  });

  it("joins returns with ⊔, so an explicit dyn stays dyn in strict mode too", () => {
    for (const config of [undefined, aliceBobStrict]) {
      const typed = expectChecks(
        `function f(c: boolean@every, x: integer@dyn) {
  if (c) { return x; } else { return 3@alice; }
}`,
        config);
      assert.equal(formatLocatedType(fnNamed(typed, "f").returnType), "integer@dyn");
    }
  });

  it("checks a partial return annotation's base like a written one", () => {
    expectCheckError(
      `function f(): float { return 3@alice; }`, { message: "is not compatible with float@alice" });
  });

  it("does not make a function dyn: an unlocated function is a choreography function", () => {
    const typed = expectChecks(`function f() { return 1@alice; }`);
    assert.equal(fnNamed(typed, "f").context.kind, "choreography");
  });
});

describe("strict mode (spec §strict-mode)", () => {
  it("reports each omission of spec §omitted-locations instead", () => {
    expectCheckError(`3;`, { message: "location annotation required on literal", spec: "location-annotation-omission", config: aliceBobStrict });
    expectCheckError(`print(3);`, { message: "location annotation required on literal", spec: "location-annotation-omission", config: aliceBobStrict });
    expectCheckError(`let xs = [1, 2];`, { message: "array literal location annotation required", spec: "array-literal-without-required-location", config: aliceBobStrict });
    expectCheckError(`function foo(a: integer) {}`, { message: "location annotation required on type", spec: "location-annotation-omission", config: aliceBobStrict });
    expectCheckError(
      `let b: integer <- 32@alice;`, { message: "location annotation required on type", spec: "transfer-let-does-not-infer-destination-type", config: aliceBobStrict });
    expectCheckError(
      `function boo(flag: boolean@every) {
    if (flag) { return 3@alice; }
    else { return 4@every; }
}`, { message: "incompatible return locations", spec: "incompatible-inferred-return-locations", config: aliceBobStrict });
  });

  it("still infers: let from its initializer, a partial return type from its returns", () => {
    const typed = expectChecks(
      `let a: integer = 3@alice;
function bar(): integer { return 3@alice; }`,
      aliceBobStrict);
    assert.equal(letType(typed, "a"), "integer@alice");
    assert.equal(formatLocatedType(fnNamed(typed, "bar").returnType), "integer@alice");
  });

  it("accepts dyn where it is written", () => {
    const typed = expectChecks(`let a: integer@dyn = 3@alice;`, aliceBobStrict);
    assert.equal(letType(typed, "a"), "integer@dyn");
  });
});

describe("where dyn is not allowed (spec §local-function-strict-location-rule)", () => {
  const LOCAL = "'dyn' cannot be used in a local function";

  it("rejects dyn anywhere in a local function", () => {
    for (const source of [
      `function f@alice(a: integer@dyn): void {}`,
      `function f@alice(): integer@dyn { return 1@alice; }`,
      `function f@alice(): void { let x: integer@dyn = 1@alice; }`,
      `function f@alice(): void { let x: integer@alice = 1@dyn; }`,
      `function f@alice(): void { [1]@dyn; }`,
      `function f@alice(): void { let x = 1@dyn; }`,
      `function f@alice(): void { let x: integer = 1@dyn; }`,
    ]) {
      expectCheckError(source, { message: LOCAL, spec: "dyn-in-a-local-function" });
    }
  });

  it("rejects dyn as a function location", () => {
    expectCheckError(`function f@dyn(): void {}`, { message: "'dyn' is not a function location", spec: "dyn-on-a-function-declaration" });
  });
});

describe("dynamic transfers (spec §dynamic-transfer, §communication-tags)", () => {
  function modes(source: string): (string | undefined)[][] {
    return topLevelStatements(tagSource(source)).flatMap((stmt) => {
      if (stmt.stmt.kind !== "LetTransferStatement") {
        return [];
      }
      const transfer = stmt as TypedLetTransferStatement;
      return [[transfer.stmt.name, transfer.transferMode, transfer.commTag]];
    });
  }

  it("makes any transfer with a dyn side dynamic, tagged with the static ones", () => {
    assert.deepEqual(
      modes(`
let d: integer@dyn = 1@dyn;
let a: integer@alice = 2@alice;
let t1: integer@dyn <- d;
let t2: integer@bob <- a;
let t3: integer@dyn <- 3@every;
let t4: integer@bob <- d;
let t5: integer@alice <- a;
`),
      [
        ["t1", "dynamic", "__top_0"],
        ["t2", "direct", "__top_1"],
        ["t3", "dynamic", "__top_2"],
        ["t4", "dynamic", "__top_3"],
        ["t5", "localCopy", undefined],
      ],
    );
  });
});

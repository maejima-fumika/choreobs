import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkSource, tagSource } from "../support/pipeline.js";
import { assertCites, describeDiags } from "../support/spec.js";
import { aliceBobStrict } from "../support/config.js";
import type { SpecId } from "../../src/spec/ref.js";
import type {
  LocatedType,
  TypedFunctionDeclaration,
  TypedLetStatement,
  TypedLetTransferStatement,
  TypedProgram,
  TypedTopLevelStatement,
} from "../../src/ast/typed.js";
import type { ChoreoBSConfig } from "../../src/config/types.js";
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

const alice = { kind: "individual" as const, name: "alice" };
const bob = { kind: "individual" as const, name: "bob" };
const every = { kind: "every" as const };
const dyn = { kind: "dyn" as const };

function accepted(source: string, config?: ChoreoBSConfig): TypedProgram {
  const { typed, errors } = checkSource(source, config);
  assert.equal(errors.length, 0, describeDiags(errors));
  assert.ok(typed);
  return typed;
}

function rejected(
  source: string,
  message: string,
  spec?: SpecId,
  config?: ChoreoBSConfig,
): void {
  const { typed, errors } = checkSource(source, config);
  assert.equal(typed, null);
  assert.ok(
    errors.some((e) => e.message.includes(message)),
    `expected an error containing ${JSON.stringify(message)}: ${describeDiags(errors)}`,
  );
  if (spec !== undefined) {
    assertCites(errors, spec);
  }
}

/** The type of the top-level `let` named `name`. */
function letType(typed: TypedProgram, name: string): string {
  for (const item of typed.items) {
    if ("decl" in item) {
      continue;
    }
    const stmt = (item as TypedTopLevelStatement).statement;
    if (stmt.stmt.kind === "LetStatement" && stmt.stmt.name === name) {
      return formatLocatedType((stmt as TypedLetStatement).choreoType);
    }
    if (stmt.stmt.kind === "LetTransferStatement" && stmt.stmt.name === name) {
      return formatLocatedType((stmt as TypedLetTransferStatement).choreoType);
    }
  }
  assert.fail(`no top-level let ${name}`);
}

function fn(typed: TypedProgram, name: string): TypedFunctionDeclaration {
  const hit = typed.items.find((item) => "decl" in item && item.decl.name === name);
  assert.ok(hit && "decl" in hit, `no function ${name}`);
  return hit;
}

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
    const typed = accepted(`${decls}
let x: integer@alice = d;
let y: integer@dyn = a;
let z: integer@every = d;
`);
    assert.equal(letType(typed, "x"), "integer@alice");
    assert.equal(letType(typed, "y"), "integer@dyn");
    assert.equal(letType(typed, "z"), "integer@every");
  });

  it("locates an operation with a dyn operand at dyn", () => {
    const typed = accepted(`${decls}
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
    accepted(`let c: boolean@dyn = true@dyn;
if (c) {}
while (c) {}
`);
  });

  it("accepts element operations that mix dyn with one concrete location", () => {
    accepted(`${decls}
arrAlice[d] = a;
arrDyn[a] = d;
arrAlice.push(d);
arrDyn.push(a);
let xs = [a, d];
`);
  });

  it("rejects two concrete locations in an element assignment, dyn or not", () => {
    rejected(
      `${decls}
let b: integer@bob = 3@bob;
arrDyn[a] = b;
`,
      "must not be at different locations",
      "element-assignment-across-locations",
    );
  });

  it("rejects two concrete locations among array elements", () => {
    rejected(
      `let xs = [1@alice, 2@bob]@dyn;`,
      "array literal elements must not be at different locations",
      "array-literal-elements-across-locations",
    );
  });

  it("still rejects two concrete locations in a binary operation", () => {
    rejected(`let x = 1@alice + 2@bob;`, "binary operands must be at the same location");
  });

  it("keeps base types static: integer and float stay unrelated", () => {
    rejected(`let x: float@dyn = 1@dyn;`, "cannot assign integer", "type-mismatch");
    rejected(`let x = 1@dyn + 1.5@dyn;`, "same numeric type");
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
`;

  it("completes the example of spec §omitted-locations", () => {
    const typed = accepted(example);
    assert.equal(letType(typed, "a"), "integer@dyn");
    assert.equal(letType(typed, "b"), "integer@dyn");
    assert.deepEqual(types(...fn(typed, "foo").params.map((p) => p.type)), ["integer@dyn"]);
    assert.equal(formatLocatedType(fn(typed, "foo").returnType), "void");
    assert.equal(formatLocatedType(fn(typed, "boo").returnType), "integer@dyn");
    assert.equal(formatLocatedType(fn(typed, "bar").returnType), "integer@alice");
  });

  it("makes an unannotated array literal dyn, with its bare elements", () => {
    const typed = accepted(`let xs = [1, 2]; let ys: float[] = [];`);
    assert.equal(letType(typed, "xs"), "integer[]@dyn");
    assert.equal(letType(typed, "ys"), "float[]@dyn");
  });

  it("gives an empty literal the annotation's element type (spec §array-literal-typing)", () => {
    const typed = accepted(`let e: float[]@alice = [];`);
    const item = typed.items[0] as TypedTopLevelStatement;
    const initializer = (item.statement as TypedLetStatement).initializer;
    assert.equal(formatLocatedType(initializer.choreoType), "float[]@dyn");
  });

  it("checks an empty literal's location against the annotation", () => {
    rejected(
      `let xs: integer[]@alice = []@bob;`,
      "invalid assignment across locations",
      "invalid-assignment-across-locations",
    );
  });

  it("joins returns with ⊔, so an explicit dyn stays dyn in strict mode too", () => {
    for (const config of [undefined, aliceBobStrict]) {
      const typed = accepted(
        `function f(c: boolean@every, x: integer@dyn) {
  if (c) { return x; } else { return 3@alice; }
}`,
        config,
      );
      assert.equal(formatLocatedType(fn(typed, "f").returnType), "integer@dyn");
    }
  });

  it("checks a partial return annotation's base like a written one", () => {
    rejected(
      `function f(): float { return 3@alice; }`,
      "is not compatible with float@alice",
    );
  });

  it("does not make a function dyn: an unlocated function is a choreography function", () => {
    const typed = accepted(`function f() { return 1@alice; }`);
    assert.equal(fn(typed, "f").context.kind, "choreography");
  });
});

describe("strict mode (spec §strict-mode)", () => {
  it("reports each omission of spec §omitted-locations instead", () => {
    rejected(`3;`, "location annotation required on literal", "location-annotation-omission", aliceBobStrict);
    rejected(`let xs = [1, 2];`, "array literal location annotation required", "array-literal-without-required-location", aliceBobStrict);
    rejected(`function foo(a: integer) {}`, "location annotation required on type", "location-annotation-omission", aliceBobStrict);
    rejected(
      `let b: integer <- 32@alice;`,
      "location annotation required on type",
      "transfer-let-does-not-infer-destination-type",
      aliceBobStrict,
    );
    rejected(
      `function boo(flag: boolean@every) {
    if (flag) { return 3@alice; }
    else { return 4@every; }
}`,
      "incompatible return locations",
      "incompatible-inferred-return-locations",
      aliceBobStrict,
    );
  });

  it("still infers: let from its initializer, a partial return type from its returns", () => {
    const typed = accepted(
      `let a: integer = 3@alice;
function bar(): integer { return 3@alice; }`,
      aliceBobStrict,
    );
    assert.equal(letType(typed, "a"), "integer@alice");
    assert.equal(formatLocatedType(fn(typed, "bar").returnType), "integer@alice");
  });

  it("accepts dyn where it is written", () => {
    const typed = accepted(`let a: integer@dyn = 3@alice;`, aliceBobStrict);
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
    ]) {
      rejected(source, LOCAL, "dyn-in-a-local-function");
    }
  });

  it("keeps omission an error in a local function", () => {
    rejected(`function f@alice(): void { let x: integer@alice = 1; }`, "location annotation required on literal");
    rejected(`function f@alice(a: integer): void {}`, "location annotation required on type");
    rejected(`function f@alice(): integer { return 1@alice; }`, "location annotation required on type");
  });

  it("rejects dyn as a function location", () => {
    rejected(`function f@dyn(): void {}`, "'dyn' is not a function location", "dyn-on-a-function-declaration");
  });
});

describe("dynamic transfers (spec §dynamic-transfer, §communication-tags)", () => {
  function modes(source: string): (string | undefined)[][] {
    const typed = tagSource(source);
    return typed.items.flatMap((item) => {
      if ("decl" in item) {
        return [];
      }
      const stmt = (item as TypedTopLevelStatement).statement;
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

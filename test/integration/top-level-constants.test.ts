import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bs, compile, expectSuccess } from "../support/compile.js";

/**
 * A top-level constant that a function uses (spec §top-level-let) is a global
 * of each endpoint's program, declared below the functions
 * (spec §top-level-projection). A function reads it only where the
 * declaration is kept.
 */
describe("top-level constants in the generated BlueScript (spec §top-level-projection)", () => {
  it("§top-level-projection reads the constant where it lives, below the functions", () => {
    const result = compile(`
const limit: integer@alice = 10@alice;

function report(x: integer@alice): void {
    let y: integer@bob <- x + limit;
}

report(1@alice);
`);
    expectSuccess(result);
    assert.equal(
      bs(result, "alice"),
      `function report(x: integer): void {
  sendInteger("bob", "report_0", x + limit);
}
const limit: integer = 10;
report(1);`,
    );
    assert.equal(
      bs(result, "bob"),
      `function report(x: null): void {
  let y: integer = receiveInteger("alice", "report_0");
}
report(null);`,
    );
  });

  it("keeps a local function and the constants it uses at its own endpoint only", () => {
    const result = compile(`
const xs: integer[]@alice = [1, 2]@alice;
const rounds: integer@every = 2@every;

function grow@alice(): integer {
    xs.push(3);
    return xs.length;
}

let n: integer@alice = grow();
`);
    expectSuccess(result);
    assert.equal(
      bs(result, "alice"),
      `function grow(): integer {
  xs.push(3);
  return xs.length;
}
const xs: any[] = new Array<any>([1, 2]);
const rounds: integer = 2;
let n: integer = grow();`,
    );
    assert.equal(bs(result, "bob"), "const rounds: integer = 2;");
  });

  it("reads a `dyn` constant at every endpoint (spec §dyn-lowering)", () => {
    const result = compile(`
const d = 3;

function bump(): void {
    let e: integer@dyn = d + 1@dyn;
    print(e);
}

bump();
`);
    expectSuccess(result);
    for (const endpoint of ["alice", "bob"]) {
      const program = bs(result, endpoint);
      assert.match(program, /^ {2}let e: __DynVal = __dynPlus\(d, __dynUnbound\(1\)\);$/m, endpoint);
      assert.match(program, /^const d: __DynVal = __dynUnbound\(3\);\nbump\(\);$/m, endpoint);
    }
  });
});

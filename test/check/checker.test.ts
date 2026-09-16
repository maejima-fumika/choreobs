import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse } from "../../src/parser/index.js";
import { typeCheck } from "../../src/check/index.js";
import type { ChoreoBSConfig } from "../../src/config/types.js";

const aliceBob: ChoreoBSConfig = { endpoints: ["alice", "bob"] };

function checkSource(source: string, config: ChoreoBSConfig = aliceBob) {
  const { program, errors: parseErrors } = parse(source);
  assert.equal(parseErrors.length, 0, "parse errors: " + JSON.stringify(parseErrors));
  assert.ok(program);
  return typeCheck(program, config);
}

describe("ChoreoBS type checker", () => {
  it("accepts direct communication (spec §15.1)", () => {
    const { typed, errors } = checkSource(`
let x: integer@alice = 1@alice;
let y: integer@bob <- x;
`);
    assert.equal(errors.length, 0);
    assert.equal(typed?.items.length, 2);
    const recv = typed?.items[1];
    if (recv && "statement" in recv && "commTag" in recv.statement) {
      assert.equal(recv.statement.commTag, "top_0");
    }
  });

  it("elaborates omitted locations in local functions (spec §8.1)", () => {
    const { typed, errors } = checkSource(`
function add@alice(a: integer, b: integer): integer {
  return a + b;
}
`);
    assert.equal(errors.length, 0);
    const fn = typed?.items[0];
    if (fn && "decl" in fn) {
      assert.equal(fn.params[0]?.type.location.kind, "individual");
      if (fn.params[0]?.type.location.kind === "individual") {
        assert.equal(fn.params[0].type.location.name, "alice");
      }
    }
  });

  it("rejects assignment across locations (spec §16.7)", () => {
    const { typed, errors } = checkSource(`
let x: integer@alice = 1@alice;
let y: integer@bob = x;
`);
    assert.equal(typed, null);
    assert.ok(errors.some((e) => e.message.includes("use a transfer instead")));
  });

  it("accepts a scalar local copy from @every (spec §7.8)", () => {
    const { typed, errors } = checkSource(`
let x: integer@every = 1@every;
let y: integer@alice <- x;
`);
    assert.equal(errors.length, 0);
    const recv = typed?.items[2];
    if (recv && "statement" in recv && "transferMode" in recv.statement) {
      assert.equal(recv.statement.transferMode, "localCopy");
      assert.equal(recv.statement.commTag, undefined);
    }
  });

  it("accepts a scalar local copy from @every literals with subtyping", () => {
    const { errors } = checkSource(`
let y: float@alice <- 1@every;
let b: boolean@bob <- true@every;
`);
    assert.equal(errors.length, 0);
  });

  it("accepts @every to @every transfer as a local copy (spec §7.8)", () => {
    const { typed, errors } = checkSource(`
let x: integer@every = 1@every;
let y: integer@every <- x;
`);
    assert.equal(errors.length, 0, JSON.stringify(errors));
    assert.ok(typed);
    const recv = typed?.items[1];
    assert.ok(recv && "statement" in recv && "transferMode" in recv.statement);
    if (recv && "statement" in recv && "transferMode" in recv.statement) {
      assert.equal(recv.statement.transferMode, "localCopy");
      assert.equal(recv.statement.commTag, undefined);
    }
  });

  it("accepts a transfer whose source and destination share a location (spec §7.8)", () => {
    const { typed, errors } = checkSource(`
let x: integer@alice = 1@alice;
let y: integer@alice <- x;
`);
    assert.equal(errors.length, 0, JSON.stringify(errors));
    assert.ok(typed);
    const recv = typed?.items[1];
    if (recv && "statement" in recv && "transferMode" in recv.statement) {
      assert.equal(recv.statement.transferMode, "localCopy");
      assert.equal(recv.statement.commTag, undefined);
    }
  });

  it("rejects references to top-level let from local functions (spec §6.5)", () => {
    const { typed, errors } = checkSource(`
let x: integer@alice = 1@alice;
function f@alice(): integer {
  return x;
}
`);
    assert.equal(typed, null);
    assert.ok(errors.some((e) => e.message.includes("undefined variable 'x'")));
  });

  it("rejects cross-node local function calls (spec §16.12)", () => {
    const { typed, errors } = checkSource(`
function f@bob(): integer { return 1; }
function g@alice(): integer { return f(); }
`);
    assert.equal(typed, null);
    assert.ok(errors.some((e) => e.message.includes("cannot call")));
  });

  it("rejects @every function calls from local context (spec §16.13)", () => {
    const { typed, errors } = checkSource(`
function h@every(): unit@every { return; }
function g@alice(): unit { h(); return; }
`);
    assert.equal(typed, null);
    assert.ok(errors.some((e) => e.message.includes("@every")));
  });

  it("rejects @every recursion (spec §16.14)", () => {
    const { typed, errors } = checkSource(`
function loop@every(): unit@every {
  loop();
  return;
}
`);
    assert.equal(typed, null);
    assert.ok(errors.some((e) => e.message.includes("recursive")));
  });

  it("rejects communication in local functions (spec §10.1)", () => {
    const { typed, errors } = checkSource(`
function f@alice(): unit {
  let y: integer@bob <- x;
  return;
}
`);
    assert.equal(typed, null);
    assert.ok(errors.some((e) => e.message.includes("transfer is not allowed")));
  });

  it("accepts a transfer widening integer to float (spec §7.8)", () => {
    const { errors } = checkSource(`
let y: integer@alice = 1@alice;
let x: float@bob <- y;
`);
    assert.equal(errors.length, 0, JSON.stringify(errors));
  });

  it("rejects a transfer narrowing float to integer (spec §16.8)", () => {
    const { typed, errors } = checkSource(`
let y: float@alice = 1.5@alice;
let x: integer@bob <- y;
`);
    assert.equal(typed, null);
    assert.ok(
      errors.some((e) => e.message.includes("transfer type mismatch")),
      JSON.stringify(errors),
    );
  });

  it("rejects a transfer between unrelated base types (spec §16.8)", () => {
    const { typed, errors } = checkSource(`
let y: float@alice = 1.5@alice;
let x: string@bob <- y;
`);
    assert.equal(typed, null);
    assert.ok(
      errors.some((e) => e.message.includes("transfer type mismatch")),
      JSON.stringify(errors),
    );
  });

  it("rejects unknown endpoint (spec §16.1)", () => {
    const { typed, errors } = checkSource(`let x: integer@carol = 1@carol;`);
    assert.equal(typed, null);
    assert.ok(errors.some((e) => e.message.includes("carol")));
  });

  it("rejects location omission at top level (spec §16.4)", () => {
    const { typed, errors } = checkSource(`let x: integer = 1@alice;`);
    assert.equal(typed, null);
    assert.ok(errors.some((e) => e.message.includes("location")));
  });

  it("rejects boolean@alice condition in @every context (spec §16.9)", () => {
    const { typed, errors } = checkSource(`
function f@every(c: boolean@alice): unit@every {
  if (c) { return; }
}
`);
    assert.equal(typed, null);
    assert.ok(errors.some((e) => e.message.includes("boolean@every")));
  });

  it("allows the same let name in separate if branches (spec §6.4)", () => {
    const { typed, errors } = checkSource(`
let ok: boolean@every = true@every;
if (ok) {
  let msg: string@bob = "ok"@bob;
} else {
  let msg: string@bob = "ng"@bob;
}
`);
    assert.equal(errors.length, 0);
    assert.ok(typed);
  });

  it("rejects indirect recursive local functions with omitted return types (spec §7.14.8)", () => {
    const { typed, errors } = checkSource(`
function f@alice(n: integer) {
  return g(n);
}
function g@alice(n: integer) {
  return f(n);
}
`);
    assert.equal(typed, null);
    const recursiveErrors = errors.filter((e) =>
      e.message.includes("omitted return type cannot be recursive"),
    );
    assert.ok(recursiveErrors.length >= 2);
  });

  describe("local function location discipline", () => {
    it("accepts omitted-location parameters and body at bob", () => {
      const { errors } = checkSource(`
function add@bob(a: integer, b: integer) {
  return a + b;
}
`);
      assert.equal(errors.length, 0);
    });

    it("accepts explicit bob-located parameters and body", () => {
      const { errors } = checkSource(`
function add@bob(a: integer@bob, b: integer@bob) {
  return a + b;
}
`);
      assert.equal(errors.length, 0);
    });

    it("accepts omitted-location return type", () => {
      const { errors } = checkSource(`
function f@bob(): integer {
  return 1;
}
`);
      assert.equal(errors.length, 0);
    });

    it("accepts explicit bob-located return type", () => {
      const { errors } = checkSource(`
function f@bob(): integer@bob {
  return 1@bob;
}
`);
      assert.equal(errors.length, 0);
    });

    it("rejects parameter at a different individual location", () => {
      const { typed, errors } = checkSource(`
function add@bob(a: integer@alice, b: integer@bob) {
  return a;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) => e.message.includes("parameter must be located at bob")),
      );
    });

    it("rejects parameter at @every", () => {
      const { typed, errors } = checkSource(`
function f@bob(x: integer@every) {
  return x;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) => e.message.includes("parameter must be located at bob")),
      );
    });

    it("rejects @every literal in body", () => {
      const { typed, errors } = checkSource(`
function f@bob() {
  let x = 1@every;
  return x;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("not usable in local function at bob"),
        ),
      );
    });

    it("rejects literal at a different individual location in body", () => {
      const { typed, errors } = checkSource(`
function f@bob() {
  let x = 1@alice;
  return x;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("not usable in local function at bob"),
        ),
      );
    });

    it("rejects binary operands at different individual locations (spec §8.1.1)", () => {
      const { typed, errors } = checkSource(`
function f@alice(): integer {
  return 1@bob + 2@alice;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("binary operands must be located at alice"),
        ),
      );
    });

    it("rejects explicit return type at a different individual location", () => {
      const { typed, errors } = checkSource(`
function f@bob(): integer@alice {
  return 1@alice;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) => e.message.includes("return type must be located at bob")),
      );
    });

    it("rejects explicit return type at @every", () => {
      const { typed, errors } = checkSource(`
function f@bob(): integer@every {
  return 1@every;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) => e.message.includes("return type must be located at bob")),
      );
    });

    it("rejects inferred return at @every", () => {
      const { typed, errors } = checkSource(`
function f@bob() {
  return 1@every;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) => e.message.includes("return type must be located at bob")),
      );
    });

    it("rejects inferred return at a different individual location", () => {
      const { typed, errors } = checkSource(`
function f@bob() {
  return 1@alice;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) => e.message.includes("return type must be located at bob")),
      );
    });
  });

  it("uses inferred return type at call sites (spec §7.14.4)", () => {
    const { typed, errors } = checkSource(`
function add@alice(a: integer, b: integer) {
  return a + b;
}
function caller@alice(): integer {
  return add(1, 2);
}
`);
    assert.equal(errors.length, 0, JSON.stringify(errors));
    const caller = typed?.items[1];
    if (caller && "body" in caller) {
      const ret = caller.body.statements[0];
      if (ret && "value" in ret && ret.value && "callee" in ret.value) {
        assert.equal(ret.value.choreoType.base, "integer");
        if (ret.value.choreoType.location.kind === "individual") {
          assert.equal(ret.value.choreoType.location.name, "alice");
        }
      }
    }
  });

  describe("call argument location matching", () => {
    it("rejects passing integer@every to integer@alice parameter (spec §16.28)", () => {
      const { typed, errors } = checkSource(`
function add@alice(a: integer) {
  return a;
}
add(10@every);
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("is not at parameter location integer@alice"),
        ),
        JSON.stringify(errors),
      );
    });

    it("rejects integer@every argument to float@alice parameter (spec §16.28)", () => {
      const { typed, errors } = checkSource(`
function add@alice(a: float) {
  return a;
}
add(10@every);
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("is not at parameter location float@alice"),
        ),
        JSON.stringify(errors),
      );
    });

    it("rejects argument at a different individual location", () => {
      const { typed, errors } = checkSource(`
function add@alice(a: integer) {
  return a;
}
add(10@bob);
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) => e.message.includes("is not at parameter location")),
      );
    });

    it("rejects local function parameter at @every", () => {
      const { typed, errors } = checkSource(`
function f@alice(x: integer@every) {
  return x;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) => e.message.includes("parameter must be located at alice")),
      );
    });

    it("rejects integer@every argument from inside a local function (spec §8.1.1)", () => {
      const { typed, errors } = checkSource(`
function add@alice(a: integer) {
  return a;
}
function g@alice(): integer {
  return add(10@every);
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("not usable in local function at alice"),
        ),
      );
    });
  });

  describe("local control-flow conditions (spec §7.9, §7.10)", () => {
    it("rejects while with boolean@every in local function", () => {
      const { typed, errors } = checkSource(`
function f@alice(): unit {
  while (true@every) {
    return;
  }
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some(
          (e) =>
            e.message.includes("not usable in local function at alice") ||
            e.message.includes("boolean@alice in local function"),
        ),
      );
    });

    it("rejects for condition with boolean@every in local function", () => {
      const { typed, errors } = checkSource(`
function f@alice(): unit {
  for (; true@every; ) {
    return;
  }
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some(
          (e) =>
            e.message.includes("not usable in local function at alice") ||
            e.message.includes("boolean@alice in local function"),
        ),
      );
    });

    it("rejects if with boolean@bob in local function at alice", () => {
      const { typed, errors } = checkSource(`
function f@alice(): unit {
  if (true@bob) {
    return;
  }
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) => e.message.includes("boolean@alice in local function")),
      );
    });
  });

  it("allows explicit float let from integer initializer (spec §7.5, §7.14.1)", () => {
    const { errors } = checkSource(`
let x: float@alice = 1@alice;
`);
    assert.equal(errors.length, 0);
  });

  describe("return typing (spec §7.13)", () => {
    it("allows integer return for float return type via subtyping", () => {
      const { errors } = checkSource(`
function f@alice(): float {
  return 1;
}
`);
      assert.equal(errors.length, 0);
    });

    it("rejects return at unavailable location", () => {
      const { typed, errors } = checkSource(`
function f@alice(): integer@bob {
  return 1;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("return type must be located at alice"),
        ),
      );
    });
  });

  describe("@every and individual locations are independent (spec §7.6)", () => {
    it("rejects assigning an @every value to an individual-location variable", () => {
      const { typed, errors } = checkSource(`
let c: boolean@every = true@every;
let d: boolean@alice = c;
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("invalid assignment across locations"),
        ),
        JSON.stringify(errors),
      );
    });

    it("accepts the same program when the copy is explicit", () => {
      const { typed, errors } = checkSource(`
let c: boolean@every = true@every;
let d: boolean@alice <- c;
`);
      assert.equal(errors.length, 0, JSON.stringify(errors));
      assert.ok(typed);
    });

    it("rejects returning an @every value from an individual-location return type", () => {
      const { typed, errors } = checkSource(`
function f@every(): integer@alice {
  return 1@every;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("is not at return type location integer@alice"),
        ),
        JSON.stringify(errors),
      );
    });

    it("rejects mixing an @every operand with an individual-location operand", () => {
      const { typed, errors } = checkSource(`
function f@every(a: integer@alice) {
  return a + 1@every;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("binary operands must be at the same location"),
        ),
        JSON.stringify(errors),
      );
    });

    it("rejects mixing in the other operand order too", () => {
      const { typed, errors } = checkSource(`
function f@every(a: integer@alice) {
  return 1@every + a;
}
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("binary operands must be at the same location"),
        ),
        JSON.stringify(errors),
      );
    });
  });

  describe("mutable arrays", () => {
    it("accepts array literal, index, assignment, push, and length", () => {
      const { typed, errors } = checkSource(`
let xs: integer[]@alice = [1, 2, 3]@alice;
let ys: float[]@alice = [1, 2.5]@alice;
let zs: boolean[]@bob = [true, false]@bob;
let empty: integer[]@alice = []@alice;
let x: integer@alice = xs[0@alice];
xs[1@alice] = 10@alice;
push(xs, 20@alice);
let n: integer@alice = length(xs);
`);
      assert.equal(errors.length, 0, JSON.stringify(errors));
      assert.ok(typed);
    });

    it("rejects unsupported array features and invalid uses", () => {
      const { typed, errors } = checkSource(`
let xs: integer[]@alice = [1, 2]@alice;
let ys: float[]@alice = xs;
`);
      assert.equal(typed, null);
      assert.ok(errors.some((e) => e.message.includes("cannot assign")));
    });

    it("accepts an array local copy from @every", () => {
      const { errors } = checkSource(`
let xs: float[]@every = [1.1, 2.2]@every;
let ys: float[]@alice <- xs;
`);
      assert.equal(errors.length, 0);
    });

    it("rejects array element type conversion in a transfer", () => {
      const { typed, errors } = checkSource(`
let xs: integer[]@every = [1, 2]@every;
let ys: float[]@alice <- xs;
`);
      assert.equal(typed, null);
      assert.ok(errors.some((e) => e.message.includes("transfer type mismatch")));
    });

    it("rejects passing @every array directly to individual-location array parameter", () => {
      const { typed, errors } = checkSource(`
function average@alice(arr: float[]): float {
  return 0.0;
}
let arr: float[]@every = [1.1, 2.2]@every;
average(arr);
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("is not at parameter location float[]@alice"),
        ),
        JSON.stringify(errors),
      );
    });

    it("rejects assigning @every array to individual-location array variable", () => {
      const { typed, errors } = checkSource(`
let arr: float[]@every = [1.1, 2.2]@every;
let arrAlice: float[]@alice = arr;
`);
      assert.equal(typed, null);
      assert.ok(
        errors.some((e) =>
          e.message.includes("invalid assignment across locations"),
        ),
        JSON.stringify(errors),
      );
    });
  });
});

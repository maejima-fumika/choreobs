import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse } from "../../src/parser/index.js";
import { typeCheck } from "../../src/check/index.js";
import type { ChoreoBSConfig } from "../../src/config/types.js";

const aliceBob: ChoreoBSConfig = { participants: ["alice", "bob"] };

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
let y: integer@bob <~ x;
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
      assert.equal(fn.params[0]?.type.location.kind, "concrete");
      if (fn.params[0]?.type.location.kind === "concrete") {
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
    assert.ok(errors.some((e) => e.message.includes("communication")));
  });

  it("rejects communication from @every (spec §16.8)", () => {
    const { typed, errors } = checkSource(`
let x: integer@every = 1@every;
let y: integer@alice <~ x;
`);
    assert.equal(typed, null);
    assert.ok(errors.some((e) => e.message.includes("@every")));
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
  let y: integer@bob <~ x;
  return;
}
`);
    assert.equal(typed, null);
    assert.ok(errors.some((e) => e.message.includes("communication")));
  });

  it("rejects unknown participant (spec §16.1)", () => {
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
        if (ret.value.choreoType.location.kind === "concrete") {
          assert.equal(ret.value.choreoType.location.name, "alice");
        }
      }
    }
  });
});

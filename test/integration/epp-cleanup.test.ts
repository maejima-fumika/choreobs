import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aliceBob, aliceBobCarol } from "../support/config.js";
import { compile, bs, expectSuccess } from "../support/compile.js";

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

    it("removes nested nothing statement at uninvolved endpoint", () => {
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

  describe("§15.4 choreography function — the call survives at bob", () => {
    const chooseSource = `
function choose(c: boolean@every): integer@alice {
  if (c) {
    return 1@alice;
  } else {
    return 0@alice;
  }
}
let c: boolean@every = true@every;
let x: integer@alice = choose(c);
`;

    it("keeps the call as a bare statement on bob (spec §12.3)", () => {
      const result = compile(chooseSource);
      expectSuccess(result);
      const bob = bs(result, "bob");
      // The binding is absent at bob, but `choose`'s body is emitted there, so
      // bob must still run it. A statement discards its value anyway, so no
      // `nothing(...)` wrapper is needed to stand in for the result.
      assert.match(bob, /^choose\(c\);$/m);
      assert.doesNotMatch(bob, /nothing/);
      assert.doesNotMatch(bob, /^null;$/m);
    });

    it("does not drop the call or fold it to null on bob", () => {
      const result = compile(chooseSource);
      expectSuccess(result);
      const bob = bs(result, "bob");
      assert.match(bob, /choose\(c\)/);
      assert.doesNotMatch(bob, /^null;$/m);
    });
  });

  describe("§15.2 broadcast — if branch cleanup at alice", () => {
    it("removes nothing from empty if branches on alice after cleanup", () => {
      const source = `
let localOk: boolean@alice = true@alice;
let ok: boolean@every <- localOk;

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
let ok: boolean@every <- localOk;

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

  describe("multi-endpoint broadcast (spec §11.3)", () => {
    it("emits broadcast on sender and receive on all other endpoints", () => {
      const source = `
let x: boolean@alice = true@alice;
let ok: boolean@every <- x;
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
  let x: integer@alice <- i;
  let y: integer@bob <- x;
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

  describe("§12.3 a call the endpoint still makes survives an absent result", () => {
    // `relay` is a choreography function: bob runs its body and answers alice's
    // send. Erasing the *call* at bob leaves alice blocked on the receive, and
    // the post-EPP consistency check does not see it because both ends of the
    // communication are inside `relay` itself.
    const RELAY = `
function relay(a: integer@alice): integer@alice {
  let b: integer@bob <- a;
  let c: integer@alice <- b;
  return c;
}
function zero(): integer@alice {
  let b: integer@bob = 7@bob;
  let c: integer@alice <- b;
  return c;
}
let x: integer@alice = 1@alice;
`;

    function bobBody(tail: string): string {
      const result = compile(`${RELAY}${tail}`);
      expectSuccess(result);
      return bs(result, "bob");
    }

    it("keeps a direct call", () => {
      assert.match(bobBody("let y: integer@alice = relay(x);"), /^relay\(null\);$/m);
    });

    it("keeps a call under a unary operator", () => {
      // The negation itself is not performed here — there is no value to
      // negate — but its operand is still evaluated (spec §12.7).
      assert.match(
        bobBody("let y: integer@alice = -relay(x);"),
        /^nothing\(relay\(null\)\);$/m,
      );
    });

    it("keeps a call inside parentheses", () => {
      assert.match(bobBody("let y: integer@alice = (relay(x));"), /^relay\(null\);$/m);
    });

    it("keeps a call under a binary operator", () => {
      // Both operands are evaluated, left to right, and the addition is not
      // performed (spec §12.7). The literal operand leaves a `null` behind.
      assert.match(
        bobBody("let y: integer@alice = relay(x) + 1@alice;"),
        /^nothing\(relay\(null\), null\);$/m,
      );
    });

    it("keeps a zero-argument call", () => {
      assert.match(bobBody("let y: integer@alice = zero();"), /^zero\(\);$/m);
    });

    it("keeps a call inside a loop body", () => {
      const bob = bobBody(`
let i: integer@every = 0@every;
while (i < 1@every) {
  let y: integer@alice = relay(x);
  i = i + 1@every;
}
`);
      assert.match(bob, /relay\(null\);/);
    });

    it("keeps a call in the source of a transfer that skips this endpoint", () => {
      const result = compile(
        `${RELAY}let y: integer@carol <- relay(x);`,
        aliceBobCarol,
      );
      expectSuccess(result);
      assert.match(bs(result, "bob"), /relay\(null\);/);
    });

    it("keeps a call nested in another call's argument", () => {
      // The argument's value is absent here, but `zero`'s body still has to run
      // at bob. Projecting the argument to a bare `null` dropped it, and alice
      // then blocked on the receive inside `zero`.
      // The projected `zero` returns `null` here, so the call stands in for the
      // absent argument value by itself — no wrapper is needed (spec §12.3).
      const bob = bobBody("let y: integer@alice = relay(zero());");
      assert.match(bob, /^relay\(zero\(\)\);$/m);
    });

    it("keeps a call nested in a return value", () => {
      const result = compile(`${RELAY}
function outer(): integer@alice {
  return zero();
}
let y: integer@alice = outer();
`);
      expectSuccess(result);
      assert.match(bs(result, "bob"), /return zero\(\);/);
    });

    it("still erases a call to a local function at another endpoint (spec §15.3)", () => {
      const result = compile(`
function add@alice(a: integer@alice, b: integer@alice): integer@alice {
  return a + b;
}
let x: integer@alice = add(1@alice, 2@alice);
`);
      expectSuccess(result);
      assert.doesNotMatch(bs(result, "bob"), /add/);
    });

    it("still erases `xs.length` on an array that is absent here", () => {
      const result = compile(`
let xs: integer[]@alice = [1, 2]@alice;
let n: integer@alice = xs.length;
`);
      expectSuccess(result);
      assert.doesNotMatch(bs(result, "bob"), /length/);
    });
  });

  describe("§5.11 for-header assignment clauses", () => {
    it("accepts an array element target in the init and update clauses", () => {
      const result = compile(`
let c: boolean@every = true@every;
let xs: integer[]@alice = [0, 0, 0]@alice;
for (xs[0@alice] = 0@alice; c; xs[1@alice] = xs[1@alice] + 1@alice) {
}
`);
      expectSuccess(result);
      assert.match(bs(result, "alice"), /for \(xs\[0\] = 0; c; xs\[1\] = xs\[1\] \+ 1\)/);
    });

    it("§12.14 omits a header clause whose target is absent here", () => {
      const result = compile(`
let c: boolean@every = true@every;
let i: integer@alice = 0@alice;
for (i = 0@alice; c; i = i + 1@alice) {
  let z: integer@alice = i;
}
`);
      expectSuccess(result);
      const bob = bs(result, "bob");
      // `i` is never declared at bob, so an `i = null` clause would be invalid.
      assert.match(bob, /for \(; c; \)/);
      assert.doesNotMatch(bob, /i = null/);
    });

    it("§12.14 omits an absent array element clause rather than emitting null[null]", () => {
      const result = compile(`
let c: boolean@every = true@every;
let xs: integer[]@alice = [0, 0]@alice;
for (xs[0@alice] = 0@alice; c; xs[1@alice] = 1@alice) {
}
`);
      expectSuccess(result);
      const bob = bs(result, "bob");
      assert.match(bob, /for \(; c; \)/);
      assert.doesNotMatch(bob, /null\[null\]/);
    });
  });


  // -------------------------------------------------------------------------
  // Structural projection (spec §12.3): the evaluation of the subexpressions
  // is preserved even where the result is not. Before this was structural, a
  // separate pass walked the tree picking out calls, and each of the first
  // three cases below was a place it looked in the wrong slot — every one of
  // them deadlocked, with one side sending and the other never receiving.
  // -------------------------------------------------------------------------
  describe("§12.3 structural projection of a discarded expression", () => {
    // `sends` communicates and returns at alice, so bob must call it even
    // though the result never lands there.
    const CALLS = `
function sends(): integer@alice {
  let b: integer@bob = 1@bob;
  let c: integer@alice <- b;
  return c;
}
function sends2(): integer@alice {
  let b: integer@bob = 2@bob;
  let c: integer@alice <- b;
  return c;
}
`;

    function bobOf(tail: string, config = aliceBob): string {
      const result = compile(`${CALLS}${tail}`, config);
      expectSuccess(result);
      return bs(result, "bob");
    }

    it("keeps operand order under nested strict operators (§11.1)", () => {
      // The nesting mirrors the source tree, and `nothing` evaluates its
      // arguments left to right, so the call order is the source's.
      assert.match(
        bobOf("let v: integer@alice = sends() + sends() * sends2();"),
        /^nothing\(sends\(\), nothing\(sends\(\), sends2\(\)\)\);$/m,
      );
    });

    it("keeps the arguments of a local call the endpoint does not make (§11.2)", () => {
      assert.match(
        bobOf(`
function add@alice(a: integer@alice, b: integer@alice): integer@alice {
  return a + b;
}
add(sends(), sends2());
`),
        /^nothing\(sends\(\), sends2\(\)\);$/m,
      );
    });

    it("removes a zero-argument local call, via nothing() (§11.3)", () => {
      // EPP leaves `nothing()`, which folds to `null` and then disappears
      // (spec §13.9); no CALLS prefix here, so bob's output is empty.
      const result = compile(`
function here@alice(): integer@alice {
  return 1@alice;
}
let v: integer@alice = here();
`);
      expectSuccess(result);
      assert.equal(bs(result, "bob"), "");
    });

    it("keeps a call in a let initializer whose binding is absent (§11.6)", () => {
      assert.match(bobOf("let v: integer@alice = sends();"), /^sends\(\);$/m);
    });

    it("keeps a call in an assignment whose target is absent (§11.7)", () => {
      assert.match(
        bobOf(`
let v: integer@alice = 0@alice;
v = sends();
`),
        /^sends\(\);$/m,
      );
    });

    it("keeps the index of an array element assignment, before the value (§11.8)", () => {
      // The index used to be dropped: only the right-hand side was scanned,
      // so alice sent from inside the index call and bob never received.
      const bob = bobOf(`
let xs: integer[]@alice = [0, 0]@alice;
xs[sends()] = sends2();
`);
      assert.match(bob, /^nothing\(sends\(\), sends2\(\)\);$/m);
    });

    it("keeps `.length` and index operands of an absent array", () => {
      assert.match(
        bobOf(`
let xs: integer[]@alice = [0, 0]@alice;
let v: integer@alice = xs[sends()];
`),
        /^nothing\(null, sends\(\)\);$/m,
      );
    });

    it("keeps a call in an array literal element", () => {
      assert.match(
        bobOf("let xs: integer[]@alice = [sends(), sends2()]@alice;"),
        /^nothing\(sends\(\), sends2\(\)\);$/m,
      );
    });

    it("keeps a call in a `.push` argument on an absent array", () => {
      assert.match(
        bobOf(`
let xs: integer[]@alice = [0]@alice;
xs.push(sends());
`),
        /^nothing\(sends\(\)\);$/m,
      );
    });
  });

  describe("§12.9 a transfer source is evaluated at every endpoint (§11.9)", () => {
    const G = `
function g(): integer@alice {
  let b: integer@bob = 7@bob;
  let c: integer@alice <- b;
  return c;
}
`;

    it("evaluates the source at the receiver, before the receive", () => {
      // The receiver used to skip the source expression entirely, so alice
      // sent from inside `g` and bob blocked forever on a receive that the
      // other side had already matched.
      const result = compile(`${G}let y: integer@bob <- g();`);
      expectSuccess(result);
      assert.match(bs(result, "bob"), /^g\(\);\nlet y: integer = receiveInteger/m);
    });

    it("evaluates the source at every broadcast receiver, before the receive", () => {
      const result = compile(`${G}let y: integer@every <- g();`, aliceBobCarol);
      expectSuccess(result);
      for (const endpoint of ["bob", "carol"]) {
        assert.match(
          bs(result, endpoint),
          /^g\(\);\nlet y: integer = receiveInteger/m,
          endpoint,
        );
      }
    });

    it("evaluates the source exactly once at the broadcast sender", () => {
      const result = compile(`${G}let y: integer@every <- g();`, aliceBobCarol);
      expectSuccess(result);
      // The source goes into a compiler temp so the payload and the sender's
      // own copy share one evaluation (spec §7.8, §11.3).
      const alice = bs(result, "alice");
      const body = alice
        .split("\n")
        .filter((line) => !line.startsWith("function "))
        .join("\n");
      assert.equal(body.match(/g\(\)/g)?.length, 1);
      assert.match(body, /^let __transfer_0: integer = g\(\);$/m);
      assert.match(body, /^broadcastInteger\("top_0", __transfer_0\);$/m);
    });

    it("evaluates the source at an endpoint the transfer skips", () => {
      const result = compile(
        `${G}let y: integer@carol <- g();`,
        aliceBobCarol,
      );
      expectSuccess(result);
      assert.match(bs(result, "bob"), /^g\(\);$/m);
    });

    it("keeps a local copy source out of endpoints that hold neither side", () => {
      const result = compile(
        `
let x: integer@every = 1@every;
let y: integer@alice <- x;
`,
        aliceBobCarol,
      );
      expectSuccess(result);
      // `x` resides at bob, but bob owes the transfer no computation, so
      // nothing is left behind (spec §12.9).
      assert.doesNotMatch(bs(result, "bob"), /^x;$/m);
    });
  });

  describe("§16.46 short-circuit operands (§11.10)", () => {
    const PING = `
function ping(): boolean@alice {
  let b: integer@bob = 1@bob;
  let c: integer@alice <- b;
  return true@alice;
}
`;

    it("rejects a choreography call in the right operand", () => {
      const result = compile(`${PING}
let c: boolean@alice = false@alice;
let d: boolean@alice = c && ping();
`);
      assert.equal(result.success, false);
      assert.ok(
        result.errors.some((e) =>
          e.message.includes("must not contain a call to choreography function"),
        ),
        JSON.stringify(result.errors),
      );
    });

    it("rejects a choreography call in the left operand", () => {
      const result = compile(`${PING}
let c: boolean@alice = false@alice;
let d: boolean@alice = ping() || c;
`);
      assert.equal(result.success, false);
      assert.ok(
        result.errors.some((e) =>
          e.message.includes("must not contain a call to choreography function"),
        ),
        JSON.stringify(result.errors),
      );
    });

    it("still allows a local call, which cannot communicate", () => {
      const result = compile(`
function yes@alice(): boolean@alice {
  return true@alice;
}
let c: boolean@alice = false@alice;
let d: boolean@alice = c && yes();
`);
      expectSuccess(result);
      assert.match(bs(result, "alice"), /let d: boolean = c && yes\(\);/);
    });
  });

  describe("§13.9 what cleanup may and may not remove (§11.11)", () => {
    it("keeps return, bindings, stores and ordinary calls that hold null", () => {
      // `relay` returns at alice, so at bob the parameter, the binding, the
      // store and the return value are all `null` — and every one of those
      // statements stays (spec §13.9.5).
      const result = compile(`
function relay(a: integer@alice): integer@alice {
  let b: integer@bob <- a;
  let c: integer@alice <- b;
  return c;
}
function outer(a: integer@alice): integer@alice {
  let keep: integer@alice = a;
  keep = relay(a);
  return keep;
}
let v: integer@alice = outer(1@alice);
`);
      expectSuccess(result);
      const bob = bs(result, "bob");
      // `return null;` stays — only a statement that is exactly `null;` goes.
      assert.match(bob, /^\s*return null;$/m);
      // The store to `keep` is dropped, but the call on its right-hand side is
      // not, and it keeps its `null` argument (spec §13.9.5).
      assert.match(bob, /^\s*relay\(null\);$/m);
      assert.match(bob, /^outer\(null\);$/m);
      assert.doesNotMatch(bob, /^\s*null;$/m);
      assert.doesNotMatch(bob, /nothing/);
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

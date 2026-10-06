import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Span } from "../../src/ast/span.js";
import type {
  ProjectedStatement,
  CommKind,
} from "../../src/ir/projected.js";
import { checkCommunicationConsistency } from "../../src/comm/consistency.js";
import { verifyCommunicationConsistency } from "../../src/comm/verify.js";
import { cleanupAll } from "../../src/cleanup/index.js";
import { finalizeAbsentAll } from "../../src/finalize/index.js";
import { emit } from "../../src/emit/index.js";
import { compileSource } from "../../src/driver/index.js";
import { assertCommConsistent } from "../support/comm.js";
import { aliceBob } from "../support/config.js";
import { projectSource } from "../support/pipeline.js";
import { span, ident, program, call, exprStmt } from "../support/ir.js";

function receive(
  comm: CommKind,
  sourceEndpoint: string,
  tag: string,
) {
  return {
    kind: "ReceiveExpression" as const,
    comm,
    sourceEndpoint,
    tag,
    span,
  };
}


function block(statements: ProjectedStatement[]) {
  return { kind: "ProjectedBlock" as const, statements, span };
}

function at(start: number): Span {
  return { start, end: start + 1 };
}

function send(destinationEndpoint: string, tag: string, comm: CommKind = "integer") {
  return {
    kind: "SendStatement" as const,
    comm,
    destinationEndpoint,
    tag,
    value: ident("x"),
    span,
  };
}

function receiveLet(sourceEndpoint: string, tag: string, name = "y") {
  return {
    kind: "LetStatement" as const,
    name,
    type: { kind: "PresentType" as const, base: "integer" as const },
    initializer: receive("integer", sourceEndpoint, tag),
    span,
  };
}


describe("communication consistency checker", () => {
  it("accepts paired direct communication", () => {
    const all = projectSource(`
let x: integer@alice = 1@alice;
let y: integer@bob <- x;
`);
    assertCommConsistent(all);
  });

  it("accepts broadcast with receives on other endpoints", () => {
    const all = projectSource(`
let localOk: boolean@alice = true@alice;
let ok: boolean@every <- localOk;
`);
    assertCommConsistent(all);
  });

  it("verifyCommunicationConsistency accepts cleaned projection and emit output", () => {
    const all = projectSource(`
let x: integer@alice = 1@alice;
let y: integer@bob <- x;
`);
    const cleaned = cleanupAll(finalizeAbsentAll(all));
    const emitted = cleaned.map((p) => ({
      endpoint: p.endpoint,
      source: emit(p),
    }));
    const result = verifyCommunicationConsistency(cleaned, emitted);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  it("compileSource enforces communication consistency in the driver", () => {
    const result = compileSource(
      `
let x: integer@alice = 1@alice;
let y: integer@bob <- x;
`,
      "index.cbs",
      aliceBob,
    );
    assert.equal(result.success, true, JSON.stringify(result.errors));
    assert.ok(
      !result.errors.some((e) =>
        e.message.includes("communication consistency"),
      ),
    );
  });

  it("reports missing receive for send", () => {
    const result = checkCommunicationConsistency([
      program([
        {
          kind: "SendStatement",
          comm: "integer",
          destinationEndpoint: "bob",
          tag: "top_0",
          value: ident("x"),
          span,
        },
      ], "alice"),
      program([], "bob"),
    ]);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.message.includes("missing receiveInteger")),
    );
  });

  it("reports missing send for receive", () => {
    const result = checkCommunicationConsistency([
      program([], "alice"),
      program([
        {
          kind: "LetStatement",
          name: "y",
          type: { kind: "PresentType", base: "integer" },
          initializer: receive("integer", "alice", "top_0"),
          span,
        },
      ], "bob"),
    ]);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.message.includes("missing sendInteger")));
  });

  it("reports send to self", () => {
    const result = checkCommunicationConsistency([
      program([
        {
          kind: "SendStatement",
          comm: "integer",
          destinationEndpoint: "alice",
          tag: "top_0",
          value: ident("x"),
          span,
        },
      ], "alice"),
      program([], "bob"),
    ]);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.message.includes("send to self")));
  });

  it("reports conflicting comm kinds for the same tag in a scope", () => {
    const result = checkCommunicationConsistency([
      program([
        {
          kind: "SendStatement",
          comm: "integer",
          destinationEndpoint: "bob",
          tag: "top_0",
          value: ident("x"),
          span,
        },
        {
          kind: "SendStatement",
          comm: "boolean",
          destinationEndpoint: "bob",
          tag: "top_0",
          value: ident("f"),
          span,
        },
      ], "alice"),
      program([
        {
          kind: "LetStatement",
          name: "y",
          type: { kind: "PresentType", base: "integer" },
          initializer: receive("integer", "alice", "top_0"),
          span,
        },
      ], "bob"),
    ]);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.message.includes("both integer and boolean")));
  });
});

describe("communication consistency — control path sensitivity", () => {
  it("accepts transfers inside matching branches of the same if", () => {
    const all = projectSource(`
let localOk: boolean@alice = true@alice;
let ok: boolean@every <- localOk;
if (ok) {
    let x: integer@alice = 1@alice;
    let y: integer@bob <- x;
} else {
    let p: integer@bob = 2@bob;
    let q: integer@alice <- p;
}
`);
    assertCommConsistent(all);
  });

  it("rejects a send in the then-branch paired with a receive in the else-branch", () => {
    const ifSpan = at(100);
    const result = checkCommunicationConsistency([
      program([
        {
          kind: "IfStatement",
          condition: ident("c"),
          then: block([send("bob", "top_0")]),
          else: block([]),
          span: ifSpan,
        },
      ], "alice"),
      program([
        {
          kind: "IfStatement",
          condition: ident("c"),
          then: block([]),
          else: block([receiveLet("alice", "top_0")]),
          span: ifSpan,
        },
      ], "bob"),
    ]);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.message.includes("different control paths")),
      JSON.stringify(result.errors),
    );
  });

  it("rejects a top-level send paired with a receive inside a loop", () => {
    const result = checkCommunicationConsistency([
      program([send("bob", "top_0")], "alice"),
      program([
        {
          kind: "WhileStatement",
          condition: ident("c"),
          body: block([receiveLet("alice", "top_0")]),
          span: at(200),
        },
      ], "bob"),
    ]);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.message.includes("different control paths")),
      JSON.stringify(result.errors),
    );
  });

  it("rejects one receive standing in for two sends of the same tag", () => {
    const result = checkCommunicationConsistency([
      program([send("bob", "top_0"), send("bob", "top_0")], "alice"),
      program([receiveLet("alice", "top_0")], "bob"),
    ]);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.message.includes("more than once at alice")),
      JSON.stringify(result.errors),
    );
  });

  it("rejects the same tag sent by two different endpoints", () => {
    const result = checkCommunicationConsistency([
      program([send("carol", "top_0")], "alice"),
      program([send("carol", "top_0")], "bob"),
      program([receiveLet("alice", "top_0")], "carol"),
    ]);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) =>
        e.message.includes("sent by more than one endpoint: alice, bob"),
      ),
      JSON.stringify(result.errors),
    );
  });

  it("finds a receive nested inside an expression", () => {
    const result = checkCommunicationConsistency([
      program([], "alice"),
      program([
        {
          kind: "LetStatement",
          name: "y",
          type: { kind: "PresentType", base: "integer" },
          initializer: {
            kind: "BinaryExpression",
            operator: "+",
            left: ident("a"),
            right: receive("integer", "alice", "top_9"),
            span,
          },
          span,
        },
      ], "bob"),
    ]);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.message.includes("missing sendInteger")),
      JSON.stringify(result.errors),
    );
  });
});

describe("communication consistency — broadcast sender binding", () => {
  it("rejects a broadcast sender that never binds its own copy", () => {
    const result = checkCommunicationConsistency([
      program([
        {
          kind: "BroadcastStatement",
          comm: "integer",
          tag: "top_0",
          value: ident("x"),
          span,
        },
        { kind: "ReturnStatement", span },
      ], "alice"),
      program([receiveLet("alice", "top_0")], "bob"),
    ]);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.message.includes("must bind its own copy")),
      JSON.stringify(result.errors),
    );
  });

  it("is not satisfied by an unrelated binding elsewhere in the scope", () => {
    const result = checkCommunicationConsistency([
      program([
        {
          kind: "LetStatement",
          name: "unrelated",
          type: { kind: "PresentType", base: "integer" },
          initializer: { kind: "IntegerLiteralExpression", value: 1, span },
          span,
        },
        {
          kind: "BroadcastStatement",
          comm: "integer",
          tag: "top_0",
          value: ident("x"),
          span,
        },
        { kind: "ReturnStatement", span },
      ], "alice"),
      program([receiveLet("alice", "top_0")], "bob"),
    ]);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.message.includes("must bind its own copy")),
      JSON.stringify(result.errors),
    );
  });

  it("rejects a broadcast sender that receives its own broadcast", () => {
    const result = checkCommunicationConsistency([
      program([
        {
          kind: "BroadcastStatement",
          comm: "integer",
          tag: "top_0",
          value: ident("x"),
          span,
        },
        receiveLet("alice", "top_0"),
      ], "alice"),
      program([receiveLet("alice", "top_0")], "bob"),
    ]);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) =>
        e.message.includes("receives its own broadcast"),
      ),
      JSON.stringify(result.errors),
    );
  });
});

describe("communication consistency — dynamic transfers (spec §dynamic-transfer)", () => {
  function str(value: string) {
    return { kind: "StringLiteralExpression" as const, value, span };
  }

  /** `__dynTransfer("tag", __kind_k, __loc_to, v)`, as lowering writes it (spec §location-and-kind-codes). */
  function dynTransfer(tag: string, kind = "integer", to = "dyn") {
    return exprStmt(call("__dynTransfer", str(tag), ident(`__kind_${kind}`), ident(`__loc_${to}`), ident("v")));
  }

  function messages(programs: Parameters<typeof checkCommunicationConsistency>[0]) {
    return checkCommunicationConsistency(programs).errors.map((e) => e.message);
  }

  it("accepts a compiled program with dynamic transfers", () => {
    const all = projectSource(`
let d: integer@dyn = 1@dyn;
let a: integer@alice = 2@alice;
let t: integer@bob <- d;
let u: integer@dyn <- a;
let w: integer@bob <- a;
`);
    assertCommConsistent(all);
    const cleaned = cleanupAll(finalizeAbsentAll(all));
    const emitted = cleaned.map((p) => ({ endpoint: p.endpoint, source: emit(p) }));
    const result = verifyCommunicationConsistency(cleaned, emitted);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  it("accepts the same call at every endpoint", () => {
    assert.deepEqual(
      messages([
        program([dynTransfer("__top_0")], "alice"),
        program([dynTransfer("__top_0")], "bob"),
      ]),
      [],
    );
  });

  it("reports an endpoint that does not make the call", () => {
    assert.deepEqual(
      messages([program([dynTransfer("__top_0")], "alice"), program([], "bob")]),
      [`missing __dynTransfer("__top_0", ...) at bob (scope __top)`],
    );
  });

  it("reports a call made twice at one endpoint", () => {
    const errors = messages([
      program([dynTransfer("__top_0"), dynTransfer("__top_0")], "alice"),
      program([dynTransfer("__top_0")], "bob"),
    ]);
    assert.ok(errors.some((m) => m.includes("is used more than once at alice")), JSON.stringify(errors));
  });

  it("reports endpoints that disagree on the destination or the kind", () => {
    const destination = messages([
      program([dynTransfer("__top_0", "integer", "bob")], "alice"),
      program([dynTransfer("__top_0", "integer", "dyn")], "bob"),
    ]);
    assert.ok(destination.some((m) => m.includes("transfers to bob at alice but to dyn at bob")), JSON.stringify(destination));
    const kind = messages([
      program([dynTransfer("__top_0", "integer")], "alice"),
      program([dynTransfer("__top_0", "float")], "bob"),
    ]);
    assert.ok(kind.some((m) => m.includes("used for both integer and float")), JSON.stringify(kind));
  });

  it("reports a tag shared with a static communication", () => {
    const errors = messages([
      program([dynTransfer("__top_0")], "alice"),
      program([dynTransfer("__top_0"), receiveLet("alice", "__top_0")], "bob"),
    ]);
    assert.ok(
      errors.some((m) => m.includes("used for both a dynamic transfer and a static receive")),
      JSON.stringify(errors),
    );
  });

  it("reports a destination no endpoint has", () => {
    const errors = messages([
      program([dynTransfer("__top_0", "integer", "carol")], "alice"),
      program([dynTransfer("__top_0", "integer", "carol")], "bob"),
    ]);
    assert.ok(errors.some((m) => m.includes("unknown location constant '__loc_carol'")), JSON.stringify(errors));
  });

  it("reports a kind or a location passed as anything but a constant", () => {
    for (const args of [
      [str("__top_0"), str("integer"), ident("__loc_dyn")],
      [str("__top_0"), ident("__kind_integer"), str("dyn")],
      [ident("__top_0"), ident("__kind_integer"), ident("__loc_dyn")],
    ]) {
      const stmt = exprStmt(call("__dynTransfer", ...args, ident("v")));
      const errors = messages([program([stmt], "alice"), program([stmt], "bob")]);
      assert.ok(errors.some((m) => m.includes("malformed __dynTransfer call")), JSON.stringify(errors));
    }
  });

  it("reports a kind constant the runtime does not have", () => {
    const errors = messages([
      program([dynTransfer("__top_0", "complex")], "alice"),
      program([dynTransfer("__top_0", "complex")], "bob"),
    ]);
    assert.ok(errors.some((m) => m.includes("names unknown kind constant '__kind_complex'")), JSON.stringify(errors));
  });

  it("reports a location slot holding something other than a location constant", () => {
    const stmt = exprStmt(call("__dynTransfer", str("__top_0"), ident("__kind_integer"), ident("__kind_float"), ident("v")));
    const errors = messages([program([stmt], "alice"), program([stmt], "bob")]);
    assert.ok(errors.some((m) => m.includes("unknown location constant '__kind_float'")), JSON.stringify(errors));
  });

  it("checks the emitted text as well", () => {
    const line = `__dynTransfer("__top_0", __kind_integer, __loc_dyn, v);\n`;
    const result = verifyCommunicationConsistency(
      [program([dynTransfer("__top_0")], "alice"), program([dynTransfer("__top_0")], "bob")],
      [
        { endpoint: "alice", source: line },
        { endpoint: "bob", source: "" },
      ],
    );
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.message.includes(`missing __dynTransfer("__top_0", ...) at bob`)),
      JSON.stringify(result.errors),
    );
  });
});

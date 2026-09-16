import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Span } from "../../src/ast/span.js";
import type {
  ProjectedProgram,
  ProjectedStatement,
  CommKind,
} from "../../src/ir/projected.js";
import { checkCommunicationConsistency } from "../../src/comm/consistency.js";
import { verifyCommunicationConsistency } from "../../src/comm/verify.js";
import { parse } from "../../src/parser/index.js";
import { typeCheck } from "../../src/check/index.js";
import { projectAll } from "../../src/epp/index.js";
import { cleanupAll } from "../../src/cleanup/index.js";
import { emit } from "../../src/emit/index.js";
import { compileSource } from "../../src/driver/index.js";
import { assertCommConsistent } from "./assert-consistent.js";

const span: Span = { start: 0, end: 1 };
const config = { endpoints: ["alice", "bob"] };

function ident(name: string) {
  return { kind: "IdentifierExpression" as const, name, span };
}

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

function program(
  endpoint: string,
  body: ProjectedStatement[],
  functions: ProjectedProgram["functions"] = [],
): ProjectedProgram {
  return {
    kind: "ProjectedProgram",
    endpoint,
    functions,
    body,
    span,
  };
}

function projectSource(source: string): ProjectedProgram[] {
  const { program: parsed, errors: pe } = parse(source);
  assert.equal(pe.length, 0);
  const { typed, errors: te } = typeCheck(parsed!, config);
  assert.equal(te.length, 0);
  return [...projectAll(typed!, config.endpoints)];
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
    const cleaned = cleanupAll(all);
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
      config,
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
      program("alice", [
        {
          kind: "SendStatement",
          comm: "integer",
          destinationEndpoint: "bob",
          tag: "top_0",
          value: ident("x"),
          span,
        },
      ]),
      program("bob", []),
    ]);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.message.includes("missing receiveInteger")),
    );
  });

  it("reports missing send for receive", () => {
    const result = checkCommunicationConsistency([
      program("alice", []),
      program("bob", [
        {
          kind: "LetStatement",
          name: "y",
          type: { kind: "PresentType", base: "integer" },
          initializer: receive("integer", "alice", "top_0"),
          span,
        },
      ]),
    ]);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.message.includes("missing sendInteger")));
  });

  it("reports send to self", () => {
    const result = checkCommunicationConsistency([
      program("alice", [
        {
          kind: "SendStatement",
          comm: "integer",
          destinationEndpoint: "alice",
          tag: "top_0",
          value: ident("x"),
          span,
        },
      ]),
      program("bob", []),
    ]);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.message.includes("send to self")));
  });

  it("reports conflicting comm kinds for the same tag in a scope", () => {
    const result = checkCommunicationConsistency([
      program("alice", [
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
      ]),
      program("bob", [
        {
          kind: "LetStatement",
          name: "y",
          type: { kind: "PresentType", base: "integer" },
          initializer: receive("integer", "alice", "top_0"),
          span,
        },
      ]),
    ]);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.message.includes("both integer and boolean")));
  });
});

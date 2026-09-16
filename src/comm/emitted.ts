import type { CommKind } from "../ir/projected.js";
import type { CommConsistencyResult } from "./consistency.js";
import { checkCommunicationConsistency } from "./consistency.js";
import type { ProjectedProgram, ProjectedStatement } from "../ir/projected.js";

export interface EmittedEndpointOutput {
  readonly endpoint: string;
  readonly source: string;
}

const COMM_TYPES = [
  "Integer",
  "Float",
  "Boolean",
  "String",
  "IntegerArray",
  "FloatArray",
  "BooleanArray",
] as const;
type CommSuffix = (typeof COMM_TYPES)[number];

const SEND_RE = new RegExp(
  `send(${COMM_TYPES.join("|")})\\("([^"]+)", "([^"]+)",`,
  "g",
);
const RECEIVE_RE = new RegExp(
  `receive(${COMM_TYPES.join("|")})\\("([^"]+)", "([^"]+)"\\)`,
  "g",
);
const BROADCAST_RE = new RegExp(
  `broadcast(${COMM_TYPES.join("|")})\\("([^"]+)",`,
  "g",
);

/**
 * Checks generated BlueScript for send/receive/broadcast pairing by
 * reconstructing a projected view from emitted API calls.
 */
export function checkEmittedCommunicationConsistency(
  outputs: readonly EmittedEndpointOutput[],
): CommConsistencyResult {
  const programs = outputs.map(emittedToProjectedProgram);
  return checkCommunicationConsistency(programs);
}

function emittedToProjectedProgram(
  output: EmittedEndpointOutput,
): ProjectedProgram {
  const span = { start: 0, end: 1 };
  const body: ProjectedStatement[] = [];
  const source = output.source;

  for (const match of source.matchAll(SEND_RE)) {
    const comm = suffixToComm(match[1] as CommSuffix);
    body.push({
      kind: "SendStatement",
      comm,
      destinationEndpoint: match[2]!,
      tag: match[3]!,
      value: { kind: "IdentifierExpression", name: "_", span },
      span,
    });
  }

  for (const match of source.matchAll(BROADCAST_RE)) {
    const comm = suffixToComm(match[1] as CommSuffix);
    body.push({
      kind: "BroadcastStatement",
      comm,
      tag: match[2]!,
      value: { kind: "IdentifierExpression", name: "_", span },
      span,
    });
    body.push({
      kind: "LetStatement",
      name: "_broadcast_local",
      type: { kind: "PresentType", base: commToProjectedBase(comm) },
      initializer: { kind: "IdentifierExpression", name: "_", span },
      span,
    });
  }

  for (const match of source.matchAll(RECEIVE_RE)) {
    const comm = suffixToComm(match[1] as CommSuffix);
    body.push({
      kind: "LetStatement",
      name: `_recv_${match[3]}`,
      type: { kind: "PresentType", base: commToProjectedBase(comm) },
      initializer: {
        kind: "ReceiveExpression",
        comm,
        sourceEndpoint: match[2]!,
        tag: match[3]!,
        span,
      },
      span,
    });
  }

  return {
    kind: "ProjectedProgram",
    endpoint: output.endpoint,
    functions: [],
    body,
    span,
  };
}

function commToProjectedBase(
  comm: CommKind,
): import("../ir/projected.js").ProjectedBaseType {
  switch (comm) {
    case "integer":
    case "float":
    case "boolean":
    case "string":
      return comm;
    case "integerArray":
      return "integer[]";
    case "floatArray":
      return "float[]";
    case "booleanArray":
      return "boolean[]";
  }
}

function suffixToComm(suffix: CommSuffix): CommKind {
  switch (suffix) {
    case "Integer":
      return "integer";
    case "Float":
      return "float";
    case "Boolean":
      return "boolean";
    case "String":
      return "string";
    case "IntegerArray":
      return "integerArray";
    case "FloatArray":
      return "floatArray";
    case "BooleanArray":
      return "booleanArray";
  }
}

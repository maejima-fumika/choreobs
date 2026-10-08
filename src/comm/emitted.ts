import type { CommKind } from "../ir/projected.js";
import type { CommConsistencyResult } from "./consistency.js";
import { DYN_TRANSFER } from "../runtime/dyn.js";
import { ALL_COMM_KINDS } from "../runtime/names.js";
import { PROFILE_PREFIX } from "../runtime/profile.js";
import { broadcastFunction, receiveFunction, sendFunction } from "../emit/comm.js";
import { checkCommunicationConsistency } from "./consistency.js";
import type { ProjectedProgram, ProjectedStatement } from "../ir/projected.js";

export interface EmittedEndpointOutput {
  readonly endpoint: string;
  readonly source: string;
}

/**
 * The kind each function of one role of the communication API carries, by the
 * function's name (spec §communication-api). Built from the emitter's own name
 * functions, so that it cannot fall behind the kinds.
 */
function byName(name: (comm: CommKind) => string): ReadonlyMap<string, CommKind> {
  return new Map(ALL_COMM_KINDS.map((comm) => [name(comm), comm]));
}

const SEND = byName(sendFunction);
const RECEIVE = byName(receiveFunction);
const BROADCAST = byName(broadcastFunction);

/** A group matching any one of the names in `names`. */
function anyOf(names: ReadonlyMap<string, CommKind>): string {
  return `(${[...names.keys()].join("|")})`;
}

/** The kind of the function `name`, one of those `anyOf(names)` matched. */
function kindOf(names: ReadonlyMap<string, CommKind>, name: string): CommKind {
  const comm = names.get(name);
  if (comm === undefined) {
    throw new Error(`internal error: '${name}' is not a communication API function`);
  }
  return comm;
}

/**
 * A call of one of `names`, or of its wrapper in a profiling build, which
 * stands for the call it wraps (spec §profiling-build). The name must start
 * where an identifier does, so that no longer name ending in it is read as one.
 */
function callee(names: ReadonlyMap<string, CommKind>): string {
  return `(?<![A-Za-z0-9_])(?:${PROFILE_PREFIX})?${anyOf(names)}`;
}

const SEND_RE = new RegExp(`${callee(SEND)}\\("([^"]+)", "([^"]+)",`, "g");
const RECEIVE_RE = new RegExp(`${callee(RECEIVE)}\\("([^"]+)", "([^"]+)"\\)`, "g");
const BROADCAST_RE = new RegExp(`${callee(BROADCAST)}\\("([^"]+)",`, "g");
/**
 * `__dynTransfer("tag", __kind_k, __loc_L, …)` (spec §dynamic-transfer): the
 * kind and the destination are constants of the runtime file
 * (spec §location-and-kind-codes).
 */
const DYN_TRANSFER_RE = new RegExp(
  `${DYN_TRANSFER}\\("([^"]+)", ([A-Za-z_][A-Za-z0-9_]*), ([A-Za-z_][A-Za-z0-9_]*),`,
  "g",
);

/**
 * The type of a `let` rebuilt from emitted text. The consistency check reads a
 * binding's initializer, never its type, and the emitted text no longer says
 * an array's element type (spec §type-mapping), so every rebuilt binding gets
 * this placeholder.
 */
const RECONSTRUCTED_TYPE = { kind: "AbsentType" } as const;

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
    const comm = kindOf(SEND, match[1]!);
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
    const comm = kindOf(BROADCAST, match[1]!);
    body.push({
      kind: "BroadcastStatement",
      comm,
      tag: match[2]!,
      value: { kind: "IdentifierExpression", name: "_", span },
      span,
    });
    body.push({
      kind: "LetStatement",
      keyword: "let",
      name: "_broadcast_local",
      type: RECONSTRUCTED_TYPE,
      initializer: { kind: "IdentifierExpression", name: "_", span },
      span,
    });
  }

  for (const match of source.matchAll(RECEIVE_RE)) {
    const comm = kindOf(RECEIVE, match[1]!);
    body.push({
      kind: "LetStatement",
      keyword: "let",
      name: `_recv_${match[3]}`,
      type: RECONSTRUCTED_TYPE,
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

  for (const match of source.matchAll(DYN_TRANSFER_RE)) {
    const constant = (name: string) => ({ kind: "IdentifierExpression", name, span }) as const;
    body.push({
      kind: "ExpressionStatement",
      expression: {
        kind: "CallExpression",
        callee: DYN_TRANSFER,
        args: [
          { kind: "StringLiteralExpression", value: match[1]!, span },
          constant(match[2]!),
          constant(match[3]!),
          { kind: "IdentifierExpression", name: "_", span },
        ],
        span,
      },
      span,
    });
  }

  return {
    kind: "ProjectedProgram",
    endpoint: output.endpoint,
    imports: [],
    functions: [],
    body,
    span,
  };
}

import type { CommKind } from "../ir/projected.js";
import { broadcastFunction, receiveFunction, sendFunction } from "../emit/comm.js";
import { ALL_COMM_KINDS } from "./names.js";

/**
 * The profiling build (spec §profiling-build): the names and tables it adds,
 * shared by the emitter, the runtime file and the benchmark scripts that read
 * its report. The BlueScript text itself is in `source.ts`.
 *
 * Every name carries the compiler's `__` prefix, which the source language
 * reserves (spec §identifiers), and none starts with `__loc_` or `__kind_`, so
 * none is taken for a runtime constant.
 */

/** How a build is made. Absent fields mean an ordinary build. */
export interface BuildOptions {
  /** Instrument the output (spec §profiling-build). */
  readonly profile?: boolean;
}

/** The first line of a report, which marks the start of the block. */
export const PROFILE_MARKER = "__choreobs_profile";

/** The second line of a report. Raised whenever {@link PROFILE_COUNTERS} changes. */
export const PROFILE_FORMAT_VERSION = 1;

/** Prefix of the communication wrappers and of the counters. */
export const PROFILE_PREFIX = "__prof_";

/** The function every endpoint's program calls last, which prints the report. */
export const PROFILE_REPORT = "__profReport";

/** The runtime function that records where a dynamic operation ran. */
export const PROFILE_OP = "__profOp";

/** The wrapper of a communication API function, e.g. `__prof_sendInteger`. */
export function profiledFunction(api: string): string {
  return `${PROFILE_PREFIX}${api}`;
}

/** The variable that holds counter `key`, e.g. `__prof_send_n`. */
export function profileVariable(key: CounterKey): string {
  return `${PROFILE_PREFIX}${key}`;
}

/** The BlueScript type of a value of each kind, as the communication API takes it. */
export const COMM_VALUE_TYPE: Readonly<Record<CommKind, string>> = {
  integer: "integer",
  float: "float",
  boolean: "boolean",
  string: "string",
  null: "null",
  array: "any[]",
};

/** The run-time mechanisms of `dyn` the counters are grouped by (benchmarks/README.md). */
export type Mechanism = "comm" | "K1" | "K2" | "K3" | "K4" | "K5" | "K6";

export interface ProfileCounter {
  readonly key: string;
  readonly type: "integer" | "float";
  readonly mechanism: Mechanism;
  /** What one unit is. */
  readonly what: string;
}

/** Every counter, in the order the report prints them (spec §profiling-build). */
export const PROFILE_COUNTERS = [
  { key: "send_n", type: "integer", mechanism: "comm", what: "calls of a send function" },
  { key: "send_ms", type: "float", mechanism: "comm", what: "milliseconds spent in send functions" },
  { key: "receive_n", type: "integer", mechanism: "comm", what: "calls of a receive function" },
  { key: "receive_ms", type: "float", mechanism: "comm", what: "milliseconds spent in receive functions, waiting included" },
  { key: "broadcast_n", type: "integer", mechanism: "comm", what: "calls of a broadcast function" },
  { key: "broadcast_ms", type: "float", mechanism: "comm", what: "milliseconds spent in broadcast functions" },
  { key: "dynval_new", type: "integer", mechanism: "K1", what: "__DynVal objects made" },
  { key: "locvar_new", type: "integer", mechanism: "K2", what: "__LocVar objects made" },
  { key: "find", type: "integer", mechanism: "K2", what: "calls of __find" },
  { key: "unify", type: "integer", mechanism: "K2", what: "calls of __unify" },
  { key: "bind", type: "integer", mechanism: "K2", what: "calls of __bind" },
  { key: "root_steps", type: "integer", mechanism: "K2", what: "parent links followed by __root" },
  { key: "holds", type: "integer", mechanism: "K3", what: "calls of __holdsPayload" },
  { key: "is_here", type: "integer", mechanism: "K3", what: "calls of __isHere" },
  { key: "is_every", type: "integer", mechanism: "K3", what: "calls of __isEvery" },
  { key: "kind_dispatch", type: "integer", mechanism: "K3", what: "dispatches on a kind code" },
  { key: "unbound", type: "integer", mechanism: "K4", what: "calls of __dynUnbound" },
  { key: "inject", type: "integer", mechanism: "K4", what: "calls of __inject" },
  { key: "cast", type: "integer", mechanism: "K4", what: "calls of __cast" },
  { key: "transfer", type: "integer", mechanism: "K5", what: "calls of __dynTransfer" },
  { key: "transfer_broadcast", type: "integer", mechanism: "K5", what: "dynamic transfers this endpoint broadcast" },
  { key: "transfer_send", type: "integer", mechanism: "K5", what: "dynamic transfers this endpoint sent" },
  { key: "transfer_none", type: "integer", mechanism: "K5", what: "dynamic transfers whose result this endpoint does not hold" },
  { key: "transfer_copy", type: "integer", mechanism: "K5", what: "dynamic transfers this endpoint copied locally" },
  { key: "transfer_receive", type: "integer", mechanism: "K5", what: "dynamic transfers this endpoint received" },
  { key: "copy_array", type: "integer", mechanism: "K5", what: "calls of __copyArray, static copies included" },
  { key: "op_arith", type: "integer", mechanism: "K6", what: "dynamic operator and conversion calls" },
  { key: "op_array", type: "integer", mechanism: "K6", what: "dynamic array get, set, push and length calls" },
  { key: "op_print", type: "integer", mechanism: "K6", what: "calls of __dynPrint" },
  { key: "op_here", type: "integer", mechanism: "K6", what: "dynamic operations at this endpoint's own location" },
  { key: "op_every", type: "integer", mechanism: "K6", what: "dynamic operations at every" },
  { key: "op_unbound", type: "integer", mechanism: "K6", what: "dynamic operations on an unbound location" },
  { key: "op_skip", type: "integer", mechanism: "K6", what: "dynamic operations at another endpoint, payload not computed" },
] as const satisfies readonly ProfileCounter[];

export type CounterKey = (typeof PROFILE_COUNTERS)[number]["key"];

/** The kinds of dynamic operation `__profOp` is told about. */
export type OpCategory = "arith" | "array" | "print";

/**
 * Everything a profiled program may import from the profiling part, in import
 * order: each kind's send and receive wrappers, then the broadcasts, then the
 * report (spec §profiling-build). They follow the ordinary imports.
 */
export const PROFILE_EXPORTS: readonly string[] = [
  ...ALL_COMM_KINDS.flatMap((kind) => [
    profiledFunction(sendFunction(kind)),
    profiledFunction(receiveFunction(kind)),
  ]),
  ...ALL_COMM_KINDS.map((kind) => profiledFunction(broadcastFunction(kind))),
  PROFILE_REPORT,
];

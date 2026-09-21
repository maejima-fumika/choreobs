import type { CommKind } from "../ir/projected.js";
import {
  broadcastFunction,
  cloneFunction,
  receiveFunction,
  sendFunction,
} from "../emit/comm.js";

/**
 * Names the generated BlueScript relies on, and the sentinels EPP uses
 * internally.
 *
 * BlueScript output keeps the original ChoreoBS function names (spec §13.3), so
 * a user-defined `nothing` or `sendInteger` would be emitted right next to — and
 * capture — the compiler's own call to it. These are therefore reserved
 * (spec §6.2).
 */

/** Every payload kind the communication API supports (spec §13.8). */
export const ALL_COMM_KINDS: readonly CommKind[] = [
  "integer",
  "float",
  "boolean",
  "string",
  "null",
  "integerArray",
  "floatArray",
  "booleanArray",
];

/** The compiler-generated placeholder helper (spec §14.1). */
export const NOTHING_HELPER = "nothing";

/**
 * Internal callee sentinels. They never reach the output as calls — the emitter
 * turns them back into an array literal and a `.push(...)` (spec §13.2.1) — but
 * a user function of the same name would be rewritten the same way, so they are
 * reserved too.
 */
export const ARRAY_SENTINEL = "__array";
export const PUSH_SENTINEL = "__push";

/**
 * Every compiler-introduced name starts with this, and the source language
 * reserves the prefix (spec §4.3, §6.2). That is what lets EPP mint temporaries
 * — `__transfer_0` and the like — without checking them against the program.
 */
export const COMPILER_NAME_PREFIX = "__";

/** Temporaries that keep a transfer source to a single evaluation (spec §7.8). */
export const TRANSFER_TEMP_PREFIX = "__transfer_";

// The array operation names `length` and `push` are *not* here, and are not
// reserved: they mean something only after a `.`, so a program may still use
// them as ordinary identifiers (spec §6.2). They are grammar, and live with
// the parser that reads them.

/**
 * Names no user-introduced identifier may take — function, variable or
 * parameter alike, since any of the three is emitted verbatim into the same
 * BlueScript scope as the runtime support functions.
 *
 * Derived from the emitter's own name functions so that adding a `CommKind`
 * cannot leave this list behind.
 */
export const RESERVED_RUNTIME_NAMES: ReadonlySet<string> = new Set<string>([
  NOTHING_HELPER,
  ARRAY_SENTINEL,
  PUSH_SENTINEL,
  ...ALL_COMM_KINDS.flatMap((comm) => [
    sendFunction(comm),
    receiveFunction(comm),
    broadcastFunction(comm),
    cloneFunction(comm),
  ]),
]);

export function isReservedRuntimeName(name: string): boolean {
  return RESERVED_RUNTIME_NAMES.has(name) || name.startsWith(COMPILER_NAME_PREFIX);
}

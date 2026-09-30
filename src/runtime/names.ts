import type { CommKind } from "../ir/projected.js";
import { isArrayCommKind } from "../comm/kind.js";
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
 * BlueScript output keeps the original ChoreoBS function names (spec §codegen-function-names), so
 * a user-defined `sendInteger` would be emitted right next to — and capture —
 * the compiler's own call to it. These are therefore reserved
 * (spec §function-names).
 */

/** Every payload kind the communication API supports (spec §communication-api). */
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

/** The array kinds, in the order of {@link ALL_COMM_KINDS} (spec §communication-api). */
export const ARRAY_COMM_KINDS: readonly CommKind[] = ALL_COMM_KINDS.filter(isArrayCommKind);

/**
 * Internal callee sentinels. They never reach the output as calls — the emitter
 * turns them back into an array literal and a `.push(...)` (spec §array-operation-code-generation) — but
 * a user function of the same name would be rewritten the same way, so they are
 * reserved too.
 */
export const ARRAY_SENTINEL = "__array";
export const PUSH_SENTINEL = "__push";

/**
 * Every compiler-introduced name starts with this, and the source language
 * reserves the prefix (spec §identifiers, §function-names). That is what lets EPP mint temporaries
 * — `__transfer_0` and the like — without checking them against the program.
 */
export const COMPILER_NAME_PREFIX = "__";

/** Temporaries that keep a transfer source to a single evaluation (spec §transfer-typing). */
export const TRANSFER_TEMP_PREFIX = "__transfer_";

// The array operation names `length` and `push` are *not* here, and are not
// reserved: they mean something only after a `.`, so a program may still use
// them as ordinary identifiers (spec §function-names). They are grammar, and live with
// the parser that reads them.

/**
 * Names no user-introduced identifier may take — function, variable or
 * parameter alike, since any of the three is emitted verbatim into the same
 * BlueScript scope as the runtime support functions. The names of the runtime
 * file are not listed: they all begin with {@link COMPILER_NAME_PREFIX}.
 *
 * Derived from the emitter's own name functions so that adding a `CommKind`
 * cannot leave this list behind.
 */
export const RESERVED_RUNTIME_NAMES: ReadonlySet<string> = new Set<string>([
  ARRAY_SENTINEL,
  PUSH_SENTINEL,
  ...ALL_COMM_KINDS.flatMap((comm) => [
    sendFunction(comm),
    receiveFunction(comm),
    broadcastFunction(comm),
  ]),
  // Only arrays are ever cloned (spec §communication-api): there is no
  // `cloneInteger`, so that name is left to the program (spec §reserved-runtime-names).
  ...ARRAY_COMM_KINDS.map(cloneFunction),
]);

export function isReservedRuntimeName(name: string): boolean {
  return RESERVED_RUNTIME_NAMES.has(name) || name.startsWith(COMPILER_NAME_PREFIX);
}

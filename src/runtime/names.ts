import type { CommKind } from "../ir/projected.js";
import { broadcastFunction, receiveFunction, sendFunction } from "../emit/comm.js";

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
  "array",
];

/**
 * Internal callee sentinels. They never reach the output as calls — the emitter
 * turns them back into an array literal and a `.push(...)` (spec §array-operation-code-generation) — but
 * a user function of the same name would be rewritten the same way, so they are
 * reserved too.
 */
export const ARRAY_SENTINEL = "__array";
export const PUSH_SENTINEL = "__push";

/**
 * BlueScript's output function, supplied from outside like the communication
 * API. `print(e)` is emitted as a call of it (spec §print-projection), so it is
 * reserved: a user `print` would capture that call (spec §reserved-runtime-names).
 * Unlike `length` and `push`, it is a name in the value namespace, not grammar
 * after a `.`.
 */
export const PRINT_FUNCTION = "print";

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
 * The communication API functions (spec §communication-api). Besides being
 * reserved here, they may not be named in an imported BlueScript file, whose
 * messages would have no partner in any endpoint's program
 * (spec §imported-signatures).
 */
export const COMM_API_NAMES: ReadonlySet<string> = new Set<string>(
  ALL_COMM_KINDS.flatMap((comm) => [
    sendFunction(comm),
    receiveFunction(comm),
    broadcastFunction(comm),
  ]),
);

/**
 * Names no user-introduced identifier may take — function, variable or
 * parameter alike, since any of the three is emitted verbatim into the same
 * BlueScript scope as the runtime support functions. The names of the runtime
 * file are not listed: they all begin with {@link COMPILER_NAME_PREFIX}.
 *
 * Derived from the emitter's own name functions (through {@link COMM_API_NAMES})
 * so that adding a `CommKind` cannot leave this list behind.
 */
export const RESERVED_RUNTIME_NAMES: ReadonlySet<string> = new Set<string>([
  ARRAY_SENTINEL,
  PUSH_SENTINEL,
  PRINT_FUNCTION,
  ...COMM_API_NAMES,
  // The copy helper is the runtime file's `__copyArray`, under the prefix
  // below, so `copyArray` is left to the program (spec §reserved-runtime-names).
]);

export function isReservedRuntimeName(name: string): boolean {
  return RESERVED_RUNTIME_NAMES.has(name) || name.startsWith(COMPILER_NAME_PREFIX);
}

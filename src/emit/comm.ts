import type { CommKind } from "../ir/projected.js";

export function sendFunction(comm: CommKind): string {
  return `send${capitalize(comm)}`;
}

export function receiveFunction(comm: CommKind): string {
  return `receive${capitalize(comm)}`;
}

export function broadcastFunction(comm: CommKind): string {
  return `broadcast${capitalize(comm)}`;
}

function capitalize(comm: CommKind): string {
  return comm.charAt(0).toUpperCase() + comm.slice(1);
}

/**
 * The copy helper for `comm`. It lives in the runtime file, not in BlueScript,
 * so it takes the compiler's `__` prefix (spec §copy-array-helper). Only arrays
 * are ever copied: this names `__copyArray` alone in practice.
 */
export function copyFunction(comm: CommKind): string {
  return `__copy${capitalize(comm)}`;
}

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
  if (comm.endsWith("Array")) {
    const head = comm.slice(0, -5);
    return `${head.charAt(0).toUpperCase()}${head.slice(1)}Array`;
  }
  return comm.charAt(0).toUpperCase() + comm.slice(1);
}

export function cloneFunction(comm: CommKind): string {
  return `clone${capitalize(comm)}`;
}

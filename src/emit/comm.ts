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

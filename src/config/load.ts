import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ChoreoBSConfig } from "./types.js";

export function loadConfig(path: string): ChoreoBSConfig {
  const raw = readFileSync(path, "utf8");
  const data: unknown = JSON.parse(raw);
  if (typeof data !== "object" || data === null) {
    throw new Error(`${path}: config must be a JSON object`);
  }
  const participants = (data as { participants?: unknown }).participants;
  if (!Array.isArray(participants)) {
    throw new Error(`${path}: "participants" must be an array of strings`);
  }
  const names: string[] = [];
  for (const entry of participants) {
    if (typeof entry !== "string") {
      throw new Error(`${path}: each participant must be a string`);
    }
    names.push(entry);
  }
  return { participants: names };
}

export function defaultConfigPath(cbsPath: string): string {
  return join(dirname(cbsPath), "choreobs.json");
}

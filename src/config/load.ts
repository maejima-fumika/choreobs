import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ChoreoBSConfig } from "./types.js";

export function loadConfig(path: string): ChoreoBSConfig {
  const raw = readFileSync(path, "utf8");
  const data: unknown = JSON.parse(raw);
  if (typeof data !== "object" || data === null) {
    throw new Error(`${path}: config must be a JSON object`);
  }
  const endpoints = (data as { endpoints?: unknown }).endpoints;
  if (!Array.isArray(endpoints)) {
    throw new Error(`${path}: "endpoints" must be an array of strings`);
  }
  const names: string[] = [];
  for (const entry of endpoints) {
    if (typeof entry !== "string") {
      throw new Error(`${path}: each endpoint must be a string`);
    }
    names.push(entry);
  }
  return { endpoints: names };
}

export function defaultConfigPath(cbsPath: string): string {
  return join(dirname(cbsPath), "choreobs.json");
}

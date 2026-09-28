import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SpecRefs } from "../spec/ref.js";
import type { ChoreoBSConfig } from "./types.js";
import { validateEndpoints } from "./validate.js";

/**
 * A `choreobs.json` the compiler cannot use. Carries the rules it breaks, so
 * that prefixing the path does not flatten the citation into prose.
 */
export class ConfigError extends Error {
  constructor(
    message: string,
    readonly spec: SpecRefs = [],
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadConfig(path: string): ChoreoBSConfig {
  const raw = readFileSync(path, "utf8");
  const data: unknown = JSON.parse(raw);
  if (typeof data !== "object" || data === null) {
    throw new ConfigError(`${path}: config must be a JSON object`, ["choreobs-json"]);
  }
  const endpoints = (data as { endpoints?: unknown }).endpoints;
  if (!Array.isArray(endpoints)) {
    throw new ConfigError(`${path}: "endpoints" must be an array of strings`, ["choreobs-json"]);
  }
  const names: string[] = [];
  for (const entry of endpoints) {
    if (typeof entry !== "string") {
      throw new ConfigError(`${path}: each endpoint must be a string`, ["choreobs-json"]);
    }
    names.push(entry);
  }
  const invalid = validateEndpoints(names);
  if (invalid !== undefined) {
    throw new ConfigError(`${path}: ${invalid.message}`, invalid.spec);
  }
  const implicitDyn = (data as { implicitDyn?: unknown }).implicitDyn;
  if (implicitDyn === undefined) {
    return { endpoints: names };
  }
  if (typeof implicitDyn !== "boolean") {
    throw new ConfigError(`${path}: "implicitDyn" must be a boolean`, [
      "choreobs-json",
      "invalid-implicit-dyn",
    ]);
  }
  return { endpoints: names, implicitDyn };
}

export function defaultConfigPath(cbsPath: string): string {
  return join(dirname(cbsPath), "choreobs.json");
}

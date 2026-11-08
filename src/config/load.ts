import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { SpecRefs } from "../spec/ref.js";
import { CONFIG_FILE } from "../workspace/layout.js";
import {
  BOARD_NAMES,
  isBoardName,
  type EndpointConfig,
  type ProjectConfig,
} from "./types.js";
import { validateProject } from "./validate.js";

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

export function loadConfig(path: string): ProjectConfig {
  const raw = readFileSync(path, "utf8");
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    // Malformed JSON breaks no spec rule of its own.
    throw new ConfigError(`${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return parseConfig(data, path);
}

/**
 * `data` as a `choreobs.json`, or a {@link ConfigError} naming `path` for the
 * first rule of spec §choreobs-json it breaks.
 */
export function parseConfig(data: unknown, path: string): ProjectConfig {
  const fail = (message: string, spec: SpecRefs = ["choreobs-json"]): never => {
    throw new ConfigError(`${path}: ${message}`, spec);
  };
  if (!isObject(data)) {
    return fail("config must be a JSON object");
  }
  const name = data.name;
  if (typeof name !== "string" || name === "") {
    return fail(`"name" must be a non-empty string`);
  }
  if (!Array.isArray(data.endpoints)) {
    return fail(`"endpoints" must be an array of endpoint objects`);
  }
  const endpoints = data.endpoints.map((entry) => parseEndpoint(entry, fail));

  const config: ProjectConfig = { name, endpoints };
  const invalid = validateProject(config);
  if (invalid !== undefined) {
    return fail(invalid.message, invalid.spec);
  }

  const implicitDyn = data.implicitDyn;
  if (implicitDyn === undefined) {
    return config;
  }
  if (typeof implicitDyn !== "boolean") {
    return fail(`"implicitDyn" must be a boolean`, ["choreobs-json", "invalid-implicit-dyn"]);
  }
  return { ...config, implicitDyn };
}

function parseEndpoint(
  entry: unknown,
  fail: (message: string) => never,
): EndpointConfig {
  if (typeof entry === "string") {
    // Earlier versions listed endpoints as bare names.
    return fail(
      `endpoint ${JSON.stringify(entry)} is a bare string, the format of earlier versions; ` +
        `write it as { "name": ${JSON.stringify(entry)}, "board": "host" } (or "esp32")`,
    );
  }
  if (!isObject(entry)) {
    return fail(`each endpoint must be an object with a "name" and a "board"`);
  }
  const name = entry.name;
  if (typeof name !== "string") {
    return fail(`each endpoint's "name" must be a string`);
  }
  const board = entry.board;
  if (typeof board !== "string" || !isBoardName(board)) {
    return fail(
      `endpoint ${JSON.stringify(name)}: "board" must be ${BOARD_NAMES.map((b) => JSON.stringify(b)).join(" or ")}`,
    );
  }
  const deviceName = entry.deviceName;
  let endpoint: EndpointConfig = { name, board };
  if (deviceName !== undefined) {
    if (board !== "esp32") {
      return fail(`endpoint ${JSON.stringify(name)}: "deviceName" is only for an "esp32" endpoint`);
    }
    if (typeof deviceName !== "string" || deviceName === "") {
      return fail(`endpoint ${JSON.stringify(name)}: "deviceName" must be a non-empty string`);
    }
    endpoint = { ...endpoint, deviceName };
  }
  if (entry.dependencies === undefined) {
    return endpoint;
  }
  const dependencies = parseDependencies(entry.dependencies, (message) =>
    fail(`endpoint ${JSON.stringify(name)}: ${message}`),
  );
  return { ...endpoint, dependencies };
}

/**
 * A package's name: it is written as the start of a BlueScript import, where
 * a leading `.` would make it a relative path and `/` ends it, and it names
 * the package's directory in `packages/` (spec §choreobs-json).
 */
const PACKAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

function parseDependencies(
  data: unknown,
  fail: (message: string) => never,
): Readonly<Record<string, string>> {
  if (!isObject(data)) {
    return fail(`"dependencies" must be an object from package names to git URLs`);
  }
  const byFolded = new Map<string, string>();
  const entries: [string, string][] = [];
  for (const [name, source] of Object.entries(data)) {
    if (!PACKAGE_NAME.test(name)) {
      return fail(
        `package name ${JSON.stringify(name)} must begin with a letter, a digit or '_' and go on with letters, digits, '_', '.' and '-'`,
      );
    }
    // A file system that ignores case would give the two one directory.
    const other = byFolded.get(name.toLowerCase());
    if (other !== undefined) {
      return fail(`packages '${other}' and '${name}' differ only in case`);
    }
    byFolded.set(name.toLowerCase(), name);
    if (typeof source !== "string" || source === "") {
      return fail(`package '${name}' must be a non-empty string, "<git-url>" or "<git-url>#<tag>"`);
    }
    const parts = source.split("#");
    if (parts.length > 2 || parts.some((part) => part === "")) {
      return fail(
        `package '${name}': ${JSON.stringify(source)} must be "<git-url>" or "<git-url>#<tag>", with one '#' at most and something on each side of it`,
      );
    }
    entries.push([name, source]);
  }
  // `fromEntries` defines each key, so that even `__proto__` is a package of its own.
  return Object.fromEntries(entries);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The root of the project `from` is in: the first directory, from `from` up,
 * that holds a `choreobs.json` (spec §input-files).
 */
export function findProjectRoot(from: string): string {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, CONFIG_FILE))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new ConfigError(
        `cannot find ${CONFIG_FILE} in ${resolve(from)} or any of its parent directories`,
        ["input-files"],
      );
    }
    dir = parent;
  }
}

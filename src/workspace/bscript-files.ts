import { readFileSync } from "node:fs";

/**
 * The two files `bscript` keeps, read with no more of their schema than the
 * compiler needs (spec §output-files). The compiler never writes them.
 */

/** One project registered in `bsworkspace.json`, as `bscript workspace add` stores it. */
export interface WorkspaceEntry {
  /** Relative to the workspace, such as `./alice`. */
  readonly path: string;
  readonly deviceName?: string;
}

/** `bsworkspace.json`. */
export interface WorkspaceFile {
  readonly projects: readonly WorkspaceEntry[];
}

/** `bsconfig.json`. */
export interface BlueScriptProjectConfig {
  readonly projectName: string;
  readonly boardName: string;
  readonly srcDir?: string;
  readonly entryFile?: string;
}

/**
 * Why a file could not be used, phrased to follow its path. Thrown by the
 * readers below, and turned into an error or a warning by their callers.
 */
export class BscriptFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BscriptFileError";
  }
}

export function readWorkspaceFile(path: string): WorkspaceFile {
  const data = readJson(path);
  // `bscript` treats a missing `projects` as an empty one.
  const projects = data.projects ?? [];
  if (!Array.isArray(projects)) {
    throw new BscriptFileError(`${path}: "projects" must be an array`);
  }
  return {
    projects: projects.map((entry): WorkspaceEntry => {
      if (!isObject(entry) || typeof entry.path !== "string") {
        throw new BscriptFileError(`${path}: each project must have a string "path"`);
      }
      if (entry.deviceName === undefined) {
        return { path: entry.path };
      }
      if (typeof entry.deviceName !== "string") {
        throw new BscriptFileError(`${path}: "deviceName" must be a string`);
      }
      return { path: entry.path, deviceName: entry.deviceName };
    }),
  };
}

export function readProjectConfigFile(path: string): BlueScriptProjectConfig {
  const data = readJson(path);
  const { projectName, boardName, srcDir, entryFile } = data;
  if (typeof projectName !== "string" || typeof boardName !== "string") {
    throw new BscriptFileError(`${path}: "projectName" and "boardName" must be strings`);
  }
  for (const [key, value] of [["srcDir", srcDir], ["entryFile", entryFile]] as const) {
    if (value !== undefined && typeof value !== "string") {
      throw new BscriptFileError(`${path}: "${key}" must be a string`);
    }
  }
  return {
    projectName,
    boardName,
    ...(srcDir === undefined ? {} : { srcDir: srcDir as string }),
    ...(entryFile === undefined ? {} : { entryFile: entryFile as string }),
  };
}

function readJson(path: string): Record<string, unknown> {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new BscriptFileError(`${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!isObject(data)) {
    throw new BscriptFileError(`${path}: must be a JSON object`);
  }
  return data;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

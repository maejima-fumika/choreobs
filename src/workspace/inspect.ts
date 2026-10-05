import { existsSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  DEFAULT_DEVICE_NAME,
  effectiveDeviceName,
  type EndpointConfig,
} from "../config/index.js";
import {
  BscriptFileError,
  readProjectConfigFile,
  readWorkspaceFile,
  type BlueScriptProjectConfig,
  type WorkspaceEntry,
  type WorkspaceFile,
} from "./bscript-files.js";
import { CommandError } from "./errors.js";
import {
  PROJECT_CONFIG_FILE,
  WORKSPACE_CONFIG_FILE,
  WORKSPACE_DIR,
  endpointProjectDir,
  workspaceDir,
} from "./layout.js";

/**
 * What a project's workspace holds, measured against `choreobs.json`
 * (spec §output-files, §commands). `choreobs compile` and
 * `choreobs add-endpoint` both read it: what one reports as missing, the other
 * makes.
 *
 * Nothing here writes, and nothing here runs `bscript`.
 */

/** The workspace's own file: absent, or read. */
export type WorkspaceState =
  | { readonly kind: "missing" }
  | { readonly kind: "present"; readonly file: WorkspaceFile };

/**
 * `workspace/`, or a {@link CommandError} for one that cannot be used: a
 * `workspace/` without `bsworkspace.json`, which `bscript workspace create`
 * would refuse to make over, or one that cannot be read.
 */
export function inspectWorkspace(root: string): WorkspaceState {
  const dir = workspaceDir(root);
  if (!existsSync(dir)) {
    return { kind: "missing" };
  }
  const file = join(dir, WORKSPACE_CONFIG_FILE);
  if (!existsSync(file)) {
    throw new CommandError(
      `${WORKSPACE_DIR}/ exists but has no ${WORKSPACE_CONFIG_FILE}, so it is not a BlueScript workspace; ` +
        `move it aside and run \`choreobs add-endpoint\` again`,
      ["output-files"],
    );
  }
  try {
    return { kind: "present", file: readWorkspaceFile(file) };
  } catch (e) {
    throw asCommandError(e, root);
  }
}

/** One endpoint's project, as far as it agrees with the endpoint. */
export interface EndpointProject {
  readonly endpoint: EndpointConfig;
  readonly dir: string;
  /** Its `bsconfig.json`, or `undefined` when there is none to read. */
  readonly config: BlueScriptProjectConfig | undefined;
  /** Whether the workspace registers it, with the endpoint's device name. */
  readonly registered: boolean;
  /** Where it disagrees with `choreobs.json`. Nothing repairs these. */
  readonly problems: readonly string[];
}

export function inspectEndpointProject(
  root: string,
  workspace: WorkspaceState,
  endpoint: EndpointConfig,
): EndpointProject {
  const dir = resolve(endpointProjectDir(root, endpoint.name));
  const shown = show(root, dir);
  const problems: string[] = [];
  let config: BlueScriptProjectConfig | undefined;
  if (existsSync(dir)) {
    const file = join(dir, PROJECT_CONFIG_FILE);
    if (!statSync(dir).isDirectory() || !existsSync(file)) {
      problems.push(`${shown} exists but is not a BlueScript project: it has no ${PROJECT_CONFIG_FILE}`);
    } else {
      try {
        config = readProjectConfigFile(file);
      } catch (e) {
        problems.push(asCommandError(e, root).message);
      }
    }
  }
  if (config !== undefined) {
    // `bscript` delivers a message by project name (spec §output-files).
    if (config.projectName !== endpoint.name) {
      problems.push(
        `${show(root, join(dir, PROJECT_CONFIG_FILE))} names the project '${config.projectName}', ` +
          `but it is endpoint '${endpoint.name}'s project, and messages for '${endpoint.name}' are delivered by that name`,
      );
    }
    if (config.boardName !== endpoint.board) {
      problems.push(
        `${shown} is a project for board '${config.boardName}', but ${configPhrase(endpoint)} says '${endpoint.board}'`,
      );
    }
  }

  let registered = false;
  const entry = workspace.kind === "present" ? findEntry(root, workspace.file, dir) : undefined;
  if (entry !== undefined) {
    const expected = effectiveDeviceName(endpoint);
    const actual = endpoint.board === "esp32" ? entry.deviceName ?? DEFAULT_DEVICE_NAME : entry.deviceName;
    if (actual === expected) {
      registered = true;
    } else {
      problems.push(
        `${WORKSPACE_DIR}/${WORKSPACE_CONFIG_FILE} registers ${shown} ` +
          `${actual === undefined ? "without a device name" : `with device name '${actual}'`}, ` +
          `but ${configPhrase(endpoint)} ${expected === undefined ? "gives none" : `says '${expected}'`}`,
      );
    }
  }
  return { endpoint, dir, config, registered, problems };
}

/** A project the workspace registers that is not one of the given endpoints'. */
export interface OtherProject {
  readonly dir: string;
  readonly config: BlueScriptProjectConfig | undefined;
  readonly deviceName: string | undefined;
  /** Why its `bsconfig.json` could not be read, if it could not. */
  readonly unreadable: string | undefined;
}

export function otherProjects(
  root: string,
  workspace: WorkspaceState,
  endpoints: readonly EndpointConfig[],
): OtherProject[] {
  if (workspace.kind === "missing") {
    return [];
  }
  const ours = new Set(endpoints.map((endpoint) => resolve(endpointProjectDir(root, endpoint.name))));
  return workspace.file.projects
    .map((entry) => ({ entry, dir: resolve(workspaceDir(root), entry.path) }))
    .filter(({ dir }) => !ours.has(dir))
    .map(({ entry, dir }) => {
      try {
        const config = readProjectConfigFile(join(dir, PROJECT_CONFIG_FILE));
        const deviceName = config.boardName === "esp32" ? entry.deviceName ?? DEFAULT_DEVICE_NAME : undefined;
        return { dir, config, deviceName, unreadable: undefined };
      } catch (e) {
        return { dir, config: undefined, deviceName: undefined, unreadable: asCommandError(e, root).message };
      }
    });
}

/**
 * Where another registered project would take `endpoint`'s place: by its
 * project name, which messages are delivered by, or by its device name, which
 * `bscript` connects by.
 */
export function clashes(root: string, endpoint: EndpointConfig, other: OtherProject): string[] {
  const problems: string[] = [];
  if (other.config?.projectName === endpoint.name) {
    problems.push(
      `${show(root, other.dir)} is registered in the workspace under the project name '${endpoint.name}', ` +
        `so messages for endpoint '${endpoint.name}' could reach it`,
    );
  }
  const deviceName = effectiveDeviceName(endpoint);
  if (deviceName !== undefined && other.deviceName === deviceName) {
    problems.push(
      `${show(root, other.dir)} is registered in the workspace with device name '${deviceName}', ` +
        `the one endpoint '${endpoint.name}' goes by`,
    );
  }
  return problems;
}

/** The entry that registers the project in `dir`, compared as `bscript` does, by resolved path. */
function findEntry(root: string, file: WorkspaceFile, dir: string): WorkspaceEntry | undefined {
  return file.projects.find((entry) => resolve(workspaceDir(root), entry.path) === dir);
}

function configPhrase(endpoint: EndpointConfig): string {
  return `choreobs.json's endpoint '${endpoint.name}'`;
}

/** `path` relative to the project root, for messages. */
export function show(root: string, path: string): string {
  const shown = relative(root, path);
  return shown === "" ? "." : shown;
}

function asCommandError(e: unknown, root: string): CommandError {
  if (e instanceof CommandError) {
    return e;
  }
  const message = e instanceof Error ? e.message : String(e);
  // The readers name absolute paths; the project root is implied.
  return new CommandError(
    e instanceof BscriptFileError ? message.replace(`${root}/`, "") : message,
    ["output-files"],
  );
}

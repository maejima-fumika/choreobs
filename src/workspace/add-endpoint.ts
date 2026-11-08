import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  ConfigError,
  effectiveDeviceName,
  endpointDependencies,
  loadConfig,
  parseConfig,
  validateEndpoints,
  type BoardName,
  type EndpointConfig,
} from "../config/index.js";
import { BscriptFileError, readProjectConfigFile, type BlueScriptProjectConfig } from "./bscript-files.js";
import { formatConfig } from "./create.js";
import { CommandError } from "./errors.js";
import {
  clashes,
  inspectEndpointProject,
  inspectWorkspace,
  otherProjects,
  show,
} from "./inspect.js";
import { syncPackages } from "./install.js";
import { configPath, PROJECT_CONFIG_FILE, workspaceDir, WORKSPACE_DIR } from "./layout.js";
import { inspectDependencies } from "./packages.js";
import { requireBscript, type BscriptRunner } from "./runner.js";

export interface AddEndpointOptions {
  readonly name: string;
  /** `-b`; asked for when an endpoint is new and this is left out. */
  readonly board?: string;
  /** `-d`. */
  readonly deviceName?: string;
}

/** Asks which board a new endpoint runs on. */
export type BoardPrompt = (endpoint: string) => Promise<BoardName>;

export interface AddEndpointResult {
  readonly endpoint: EndpointConfig;
  /** Whether the endpoint was new to `choreobs.json`, and has been added to it. */
  readonly added: boolean;
  /** What was done, one line each, in order. Empty when everything was already there. */
  readonly done: readonly string[];
}

/**
 * `choreobs add-endpoint` (spec §commands): adds an endpoint to the project at
 * `projectRoot` and makes whatever of its BlueScript project is missing — the
 * workspace, the project, its registration, the packages `choreobs.json` lists
 * for it (spec §bluescript-packages). For an endpoint `choreobs.json` already
 * lists, it only makes what is missing. A package the project has that
 * `choreobs.json` does not list is left for `choreobs install`.
 *
 * Everything is checked before `bscript` runs, and `choreobs.json` is written
 * last, once every step has succeeded.
 */
export async function addEndpoint(
  projectRoot: string,
  options: AddEndpointOptions,
  runner: BscriptRunner,
  promptBoard: BoardPrompt,
): Promise<AddEndpointResult> {
  const root = resolve(projectRoot);
  const path = configPath(root);
  const config = loadConfig(path);
  const listed = config.endpoints.find((endpoint) => endpoint.name === options.name);

  let endpoint: EndpointConfig;
  let rawConfig: Record<string, unknown> | undefined;
  if (listed !== undefined) {
    checkAgreement(listed, options);
    endpoint = listed;
  } else {
    // The name first, so that a bad one is reported before anything is asked.
    const invalidName = validateEndpoints([...config.endpoints.map((e) => e.name), options.name]);
    if (invalidName !== undefined) {
      throw new ConfigError(invalidName.message, invalidName.spec);
    }
    const board = options.board ?? (await promptBoard(options.name));
    const entry: Record<string, unknown> = { name: options.name, board };
    if (options.deviceName !== undefined) {
      entry.deviceName = options.deviceName;
    }
    rawConfig = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const next = { ...rawConfig, endpoints: [...(rawConfig.endpoints as unknown[]), entry] };
    // Every rule `choreobs.json` must keep, on the file as it will be written.
    const parsed = parseConfig(next, path);
    endpoint = parsed.endpoints[parsed.endpoints.length - 1]!;
    rawConfig = next;
  }

  const workspace = inspectWorkspace(root);
  const project = inspectEndpointProject(root, workspace, endpoint);
  const problems = [...project.problems];
  // A project still to be made has none of the packages yet.
  const dependencies =
    project.config === undefined ? undefined : inspectDependencies(root, endpoint, project.dir, project.config);
  problems.push(...(dependencies?.problems ?? []));
  const others = otherProjects(root, workspace, [endpoint]);
  for (const other of others) {
    problems.push(...clashes(root, endpoint, other));
  }
  const needsWorkspace = workspace.kind === "missing";
  const needsProject = project.config === undefined;
  const needsRegistration = !project.registered;
  const needsPackages =
    dependencies === undefined
      ? Object.keys(endpointDependencies(endpoint)).length > 0
      : dependencies.missing.length > 0;
  if (needsRegistration) {
    // `bscript workspace add` checks every registered project before it saves.
    for (const other of others) {
      if (other.unreadable !== undefined) {
        problems.push(`${other.unreadable}, and \`bscript workspace add\` checks every registered project`);
      }
    }
  }
  if (problems.length > 0) {
    throw new CommandError(problems.join("\n"), ["commands"]);
  }

  const done: string[] = [];
  if (needsWorkspace || needsProject || needsRegistration || needsPackages) {
    requireBscript(runner);
  }
  const shown = show(root, project.dir);
  if (needsWorkspace) {
    runner.run(["workspace", "create", WORKSPACE_DIR], root);
    done.push(`made the workspace ${WORKSPACE_DIR}/`);
  }
  if (needsProject) {
    runner.run(["project", "create", endpoint.name, "-b", endpoint.board], workspaceDir(root));
    done.push(`made the BlueScript project ${shown} (${endpoint.board})`);
  } else if (listed === undefined) {
    done.push(`took over the existing BlueScript project ${shown}`);
  }
  if (needsRegistration) {
    const args = ["workspace", "add", endpoint.name];
    if (endpoint.deviceName !== undefined) {
      args.push("-d", endpoint.deviceName);
    }
    runner.run(args, workspaceDir(root));
    const deviceName = effectiveDeviceName(endpoint);
    done.push(
      `registered ${shown} in the workspace${deviceName === undefined ? "" : ` with device name '${deviceName}'`}`,
    );
  }
  if (needsPackages) {
    // Read again: the project may have been made just now.
    const config = readCreatedProject(root, project.dir);
    const state = inspectDependencies(root, endpoint, project.dir, config);
    if (state.problems.length > 0) {
      throw new CommandError(state.problems.join("\n"), ["commands", "bluescript-packages"]);
    }
    done.push(...syncPackages(root, endpoint, project.dir, state, runner, { uninstall: false }));
  }
  if (rawConfig !== undefined) {
    writeFileSync(path, formatConfig(rawConfig), "utf8");
    done.push(`added endpoint '${endpoint.name}' to choreobs.json`);
  }
  return { endpoint, added: listed === undefined, done };
}

function readCreatedProject(root: string, dir: string): BlueScriptProjectConfig {
  try {
    return readProjectConfigFile(join(dir, PROJECT_CONFIG_FILE));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new CommandError(e instanceof BscriptFileError ? message.replace(`${root}/`, "") : message, ["commands"]);
  }
}

/** For a listed endpoint, a `-b` or `-d` must say what `choreobs.json` says. */
function checkAgreement(listed: EndpointConfig, options: AddEndpointOptions): void {
  if (options.board !== undefined && options.board !== listed.board) {
    throw new CommandError(
      `endpoint '${listed.name}' is already in choreobs.json with board '${listed.board}', not '${options.board}'`,
      ["commands"],
    );
  }
  if (options.deviceName !== undefined) {
    const deviceName = effectiveDeviceName(listed);
    if (deviceName === undefined) {
      throw new CommandError(
        `endpoint '${listed.name}' is a '${listed.board}' endpoint, which has no device name`,
        ["commands", "choreobs-json"],
      );
    }
    if (options.deviceName !== deviceName) {
      throw new CommandError(
        `endpoint '${listed.name}' is already in choreobs.json with device name '${deviceName}', not '${options.deviceName}'`,
        ["commands"],
      );
    }
  }
}

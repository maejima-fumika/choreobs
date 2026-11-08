import { join, resolve } from "node:path";
import { loadConfig, splitPackageSource, type EndpointConfig } from "../config/index.js";
import { BscriptFileError, readProjectConfigFile, type BlueScriptProjectConfig } from "./bscript-files.js";
import { CommandError } from "./errors.js";
import { inspectEndpointProject, inspectWorkspace, show } from "./inspect.js";
import { configPath, PROJECT_CONFIG_FILE, WORKSPACE_CONFIG_FILE, WORKSPACE_DIR } from "./layout.js";
import { inspectDependencies, type DependencyState, type MissingPackage } from "./packages.js";
import { requireBscript, type BscriptRunner } from "./runner.js";

export interface InstallResult {
  /** What was done, one line each, in order. Empty when every package was already there. */
  readonly done: readonly string[];
}

/**
 * `choreobs install` (spec §commands): gives each endpoint's project the
 * packages `choreobs.json` lists for it, and no others
 * (spec §bluescript-packages). A package `bsconfig.json` lists that
 * `choreobs.json` does not is uninstalled; one `choreobs.json` lists that is
 * not installed as listed is installed.
 *
 * Everything is checked before `bscript` runs: each endpoint must have its
 * project, agreeing with `choreobs.json`, and no package installed as listed
 * may be for another board.
 */
export function installPackages(projectRoot: string, runner: BscriptRunner): InstallResult {
  const root = resolve(projectRoot);
  const config = loadConfig(configPath(root));
  const workspace = inspectWorkspace(root);
  if (workspace.kind === "missing") {
    throw new CommandError(
      `there is no workspace: ${WORKSPACE_DIR}/${WORKSPACE_CONFIG_FILE} does not exist; ` +
        `run \`choreobs add-endpoint <name>\` for each endpoint to make it`,
      ["commands"],
    );
  }

  const problems: string[] = [];
  const plans: { endpoint: EndpointConfig; dir: string; state: DependencyState }[] = [];
  for (const endpoint of config.endpoints) {
    const project = inspectEndpointProject(root, workspace, endpoint);
    problems.push(...project.problems);
    if (project.config === undefined) {
      if (project.problems.length === 0) {
        problems.push(
          `endpoint '${endpoint.name}' has no BlueScript project: ${show(root, join(project.dir, PROJECT_CONFIG_FILE))} ` +
            `does not exist; run \`choreobs add-endpoint ${endpoint.name}\``,
        );
      }
      continue;
    }
    const state = inspectDependencies(root, endpoint, project.dir, project.config);
    problems.push(...state.problems);
    plans.push({ endpoint, dir: project.dir, state });
  }
  if (problems.length > 0) {
    throw new CommandError(problems.join("\n"), ["commands", "bluescript-packages"]);
  }

  if (plans.some(({ state }) => state.missing.length > 0 || state.extra.length > 0)) {
    requireBscript(runner);
  }
  const done: string[] = [];
  for (const { endpoint, dir, state } of plans) {
    done.push(...syncPackages(root, endpoint, dir, state, runner, { uninstall: true }));
  }
  return { done };
}

/**
 * Runs `bscript` in the project at `dir` to install each missing package and,
 * with `uninstall`, to uninstall each extra one (spec §bluescript-packages).
 * Returns what was done, one line each. Throws a {@link CommandError} when an
 * installed package turns out not to be the one `choreobs.json` names.
 */
export function syncPackages(
  root: string,
  endpoint: EndpointConfig,
  dir: string,
  state: DependencyState,
  runner: BscriptRunner,
  options: { readonly uninstall: boolean },
): string[] {
  const shown = show(root, dir);
  const done: string[] = [];
  if (options.uninstall) {
    for (const name of state.extra) {
      runner.run(["project", "uninstall", name], dir);
      done.push(`uninstalled package '${name}' from ${shown}`);
    }
  }
  for (const pkg of state.missing) {
    const { url, tag } = splitPackageSource(pkg.source);
    runner.run(["project", "install", url, ...(tag === undefined ? [] : ["-t", tag])], dir);
    checkInstalled(root, endpoint, dir, pkg);
    done.push(`installed package '${pkg.name}' (${pkg.source}) in ${shown}`);
  }
  return done;
}

/**
 * After `bscript project install`: the package must be in `bsconfig.json` under
 * the name `choreobs.json` gives it. `bscript` names a package after its own
 * `projectName`, whatever key `choreobs.json` uses.
 */
function checkInstalled(root: string, endpoint: EndpointConfig, dir: string, pkg: MissingPackage): void {
  const spec = ["commands", "bluescript-packages"] as const;
  const file = join(dir, PROJECT_CONFIG_FILE);
  let config: BlueScriptProjectConfig;
  try {
    config = readProjectConfigFile(file);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new CommandError(e instanceof BscriptFileError ? message.replace(`${root}/`, "") : message, [...spec]);
  }
  if (config.dependencies[pkg.name] !== pkg.source) {
    const actual = Object.keys(config.dependencies).find((name) => config.dependencies[name] === pkg.source);
    throw new CommandError(
      actual === undefined
        ? `\`bscript project install\` did not add ${JSON.stringify(pkg.source)} to ${show(root, file)}`
        : `the package at ${JSON.stringify(pkg.source)} is named '${actual}', not '${pkg.name}': ` +
            `\`bscript\` names a package after its projectName; write '${actual}' as its name in ` +
            `choreobs.json's endpoint '${endpoint.name}', and run \`choreobs install\` again`,
      [...spec],
    );
  }
  const state = inspectDependencies(root, { ...endpoint, dependencies: { [pkg.name]: pkg.source } }, dir, config);
  const problem = state.problems[0] ?? state.missing.map((p) => `package '${p.name}' is not installed: ${p.why}`)[0];
  if (problem !== undefined) {
    throw new CommandError(problem, [...spec]);
  }
}

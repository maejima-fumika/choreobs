import { existsSync } from "node:fs";
import { join } from "node:path";
import { endpointDependencies, type EndpointConfig } from "../config/index.js";
import { readProjectConfigFile, type BlueScriptProjectConfig } from "./bscript-files.js";
import { show } from "./inspect.js";
import { PACKAGES_DIR, PROJECT_CONFIG_FILE } from "./layout.js";

/**
 * An endpoint's packages, measured against `choreobs.json`
 * (spec §bluescript-packages). `choreobs compile` reports what is out of step,
 * and `choreobs install` and `choreobs add-endpoint` put it right.
 *
 * Nothing here writes, and nothing here runs `bscript`.
 */

/** A package `choreobs.json` lists that the project does not have as listed. */
export interface MissingPackage {
  readonly name: string;
  /** Its `<git-url>` or `<git-url>#<tag>`, as `choreobs.json` writes it. */
  readonly source: string;
  /** Why it counts as missing, phrased to follow the package's name. */
  readonly why: string;
}

export interface DependencyState {
  /** Listed in `choreobs.json`, and to be installed. */
  readonly missing: readonly MissingPackage[];
  /** In the project's `bsconfig.json` but not in `choreobs.json`, and to be uninstalled. */
  readonly extra: readonly string[];
  /** Installed as listed, but for another board. Installing again cannot repair these. */
  readonly problems: readonly string[];
}

/**
 * Compares the packages `choreobs.json` lists for `endpoint` with those of its
 * project in `dir`, whose `bsconfig.json` is `config`. A listed package is
 * installed when `bsconfig.json` lists it with the same source and
 * `packages/<name>/` holds a package of that name.
 */
export function inspectDependencies(
  root: string,
  endpoint: EndpointConfig,
  dir: string,
  config: BlueScriptProjectConfig,
): DependencyState {
  const listed = endpointDependencies(endpoint);
  const missing: MissingPackage[] = [];
  const problems: string[] = [];
  for (const [name, source] of Object.entries(listed)) {
    const recorded = Object.hasOwn(config.dependencies, name) ? config.dependencies[name] : undefined;
    const why = (because: string): void => {
      missing.push({ name, source, why: because });
    };
    if (recorded === undefined) {
      why(`${PROJECT_CONFIG_FILE} does not list it`);
      continue;
    }
    if (recorded !== source) {
      why(`${PROJECT_CONFIG_FILE} lists it as ${JSON.stringify(recorded)}`);
      continue;
    }
    const packageDir = join(dir, PACKAGES_DIR, name);
    const file = join(packageDir, PROJECT_CONFIG_FILE);
    if (!existsSync(file)) {
      why(`${show(root, packageDir)} does not exist`);
      continue;
    }
    let installed: BlueScriptProjectConfig;
    try {
      installed = readProjectConfigFile(file);
    } catch (e) {
      why((e instanceof Error ? e.message : String(e)).replace(`${root}/`, ""));
      continue;
    }
    // `bscript` finds a package by the directory its name gives.
    if (installed.projectName !== name) {
      why(`${show(root, file)} names the package '${installed.projectName}'`);
      continue;
    }
    if (installed.boardName !== endpoint.board) {
      problems.push(
        `${show(root, packageDir)} is a package for board '${installed.boardName}', ` +
          `but endpoint '${endpoint.name}' runs on '${endpoint.board}'; list a package for '${endpoint.board}' in choreobs.json`,
      );
    }
  }
  const extra = Object.keys(config.dependencies).filter((name) => !Object.hasOwn(listed, name));
  return { missing, extra, problems };
}

/** What is out of step, for an error that ends by telling how to put it right. */
export function describeDependencies(state: DependencyState): string {
  return [
    ...state.missing.map((p) => `'${p.name}' is not installed as listed (${p.why})`),
    ...state.extra.map((name) => `'${name}' is installed but not listed in choreobs.json`),
  ].join("; ");
}

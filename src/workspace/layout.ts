import { join } from "node:path";
import { RUNTIME_MODULE } from "../runtime/dyn.js";

/**
 * Where everything sits in a ChoreoBS project (spec §input-files,
 * §output-files). Every path the compiler and its commands use is built here.
 */

/** The configuration file, at the root of a project (spec §choreobs-json). */
export const CONFIG_FILE = "choreobs.json";

/** The program, relative to the project root (spec §input-files). */
export const SOURCE_FILE = join("src", "index.cbs");

/** The BlueScript workspace, relative to the project root (spec §output-files). */
export const WORKSPACE_DIR = "workspace";

/** What `bscript` names a workspace's configuration file. */
export const WORKSPACE_CONFIG_FILE = "bsworkspace.json";

/** What `bscript` names a project's configuration file. */
export const PROJECT_CONFIG_FILE = "bsconfig.json";

/** Where `bscript project install` puts a project's packages, relative to the project (spec §bluescript-packages). */
export const PACKAGES_DIR = "packages";

/** Each endpoint's runtime file, next to its program (spec §runtime-files). */
export const RUNTIME_FILE = `${RUNTIME_MODULE}.bs`;

export function configPath(root: string): string {
  return join(root, CONFIG_FILE);
}

export function sourcePath(root: string): string {
  return join(root, SOURCE_FILE);
}

export function workspaceDir(root: string): string {
  return join(root, WORKSPACE_DIR);
}

/** An endpoint's BlueScript project is named after it (spec §output-files). */
export function endpointProjectDir(root: string, endpoint: string): string {
  return join(workspaceDir(root), endpoint);
}

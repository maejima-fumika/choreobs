import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ProjectConfig } from "../config/index.js";
import { CommandError } from "./errors.js";
import { configPath, sourcePath, WORKSPACE_DIR } from "./layout.js";
import { requireBscript, type BscriptRunner } from "./runner.js";

/** `choreobs.json` as the commands write it: two-space indent, a final newline. */
export function formatConfig(config: unknown): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * `choreobs create <name>`: a new project in a new directory `<name>` under
 * `cwd`, with no endpoints, an empty program, and a workspace made by `bscript`
 * (spec §commands). Returns the project root.
 */
export function createProject(cwd: string, name: string, runner: BscriptRunner): string {
  if (name === "" || name === "." || name === ".." || /[/\\]/.test(name)) {
    throw new CommandError(
      `project name ${JSON.stringify(name)} must name one directory: not empty, not '.' or '..', and without '/' or '\\'`,
      ["commands"],
    );
  }
  const root = resolve(cwd, name);
  if (existsSync(root)) {
    throw new CommandError(`${root} already exists`, ["commands"]);
  }
  // Before anything is made, so that a missing `bscript` leaves nothing behind.
  requireBscript(runner);

  const config: ProjectConfig = { name, endpoints: [] };
  mkdirSync(dirname(sourcePath(root)), { recursive: true });
  writeFileSync(configPath(root), formatConfig(config), "utf8");
  writeFileSync(sourcePath(root), "", "utf8");
  try {
    runner.run(["workspace", "create", WORKSPACE_DIR], root);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new CommandError(
      `${message}\nThe project was made without its workspace: \`choreobs add-endpoint\` makes it, ` +
        `once ${join(root, WORKSPACE_DIR)} can be created`,
      ["commands"],
    );
  }
  return root;
}

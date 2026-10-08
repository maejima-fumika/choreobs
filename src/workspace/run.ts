import { resolve } from "node:path";
import { writeProject, type WriteResult } from "./compile.js";
import { CommandError } from "./errors.js";
import { workspaceDir } from "./layout.js";
import { requireBscript, type BscriptRunner } from "./runner.js";

/** The options of `choreobs run`. */
export interface RunOptions {
  /** Passes `--stats` to `bscript workspace run`. */
  stats?: boolean;
}

/**
 * `choreobs run` (spec §commands): writes the project as `choreobs compile`
 * does, then runs every endpoint's program together with
 * `bscript workspace run`, naming the endpoints so that a registered project
 * that is no endpoint's stays out.
 *
 * With `stats`, `bscript` is given `--stats`, and prints the execution time
 * and the memory statistics of each endpoint when it finishes.
 *
 * `written` sees the result of writing before anything runs, so that its
 * warnings come first. When writing fails nothing is run, and the result is
 * returned. Throws a {@link CommandError} when `bscript` is missing — checked
 * before anything is written — when there is no endpoint to run, or when
 * `bscript` fails.
 */
export function runProject(
  projectRoot: string,
  runner: BscriptRunner,
  written: (result: WriteResult) => void = () => {},
  options: RunOptions = {},
): WriteResult {
  const root = resolve(projectRoot);
  requireBscript(runner);
  const result = writeProject(root);
  written(result);
  if (result.errors.length > 0) {
    return result;
  }
  const endpoints = result.compilation.config!.endpoints.map((endpoint) => endpoint.name);
  if (endpoints.length === 0) {
    throw new CommandError(
      "there is no endpoint to run; add one with `choreobs add-endpoint <name>`",
      ["commands"],
    );
  }
  runner.run(["workspace", "run", ...(options.stats ? ["--stats"] : []), ...endpoints], workspaceDir(root));
  return result;
}

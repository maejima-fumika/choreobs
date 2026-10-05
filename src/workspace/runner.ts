import { spawnSync } from "node:child_process";
import { CommandError } from "./errors.js";

/**
 * How the commands run BlueScript's `bscript` (spec §commands). The tests put
 * a fake in its place that makes the files `bscript` would.
 */
export interface BscriptRunner {
  /** Whether `bscript` can be run at all. */
  available(): boolean;
  /** Runs `bscript …args` in `cwd`, and throws a {@link CommandError} if it fails. */
  run(args: readonly string[], cwd: string): void;
}

const NOT_FOUND = "bscript, BlueScript's command-line tool, is not on PATH; install it first";

/** The `bscript` on PATH. Its output goes straight to the terminal. */
export const systemBscript: BscriptRunner = {
  available(): boolean {
    const result = spawnSync("bscript", ["--version"], { stdio: "ignore" });
    return result.error === undefined && result.status === 0;
  },

  run(args: readonly string[], cwd: string): void {
    const command = `bscript ${args.join(" ")}`;
    const result = spawnSync("bscript", args, { cwd, stdio: "inherit" });
    if (result.error !== undefined) {
      const code = (result.error as NodeJS.ErrnoException).code;
      throw new CommandError(code === "ENOENT" ? NOT_FOUND : `${command}: ${result.error.message}`);
    }
    if (result.status !== 0) {
      const how = result.status === null ? `was killed by ${result.signal}` : `exited with ${result.status}`;
      throw new CommandError(`\`${command}\` (in ${cwd}) ${how}`);
    }
  },
};

/** Throws unless `runner` can run `bscript`. */
export function requireBscript(runner: BscriptRunner): void {
  if (!runner.available()) {
    throw new CommandError(NOT_FOUND);
  }
}

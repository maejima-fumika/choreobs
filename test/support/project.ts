import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { BscriptRunner } from "../../src/workspace/runner.js";
import { CommandError } from "../../src/workspace/errors.js";

/** A temporary directory, removed once `run` is done. */
export function withTempDir<T>(run: (dir: string) => T): T {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "choreobs-project-")));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function withTempDirAsync<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "choreobs-project-")));
  try {
    return await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Writes `files` (path relative to `root` → contents; objects as JSON) under `root`. */
export function writeFiles(root: string, files: Readonly<Record<string, string | object>>): void {
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, typeof contents === "string" ? contents : JSON.stringify(contents, null, 2), "utf8");
  }
}

export function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** A `choreobs.json` with these endpoints, each a host endpoint unless written out. */
export function projectConfig(endpoints: readonly (string | object)[], extra: object = {}): object {
  return {
    name: "test",
    ...extra,
    endpoints: endpoints.map((e) => (typeof e === "string" ? { name: e, board: "host" } : e)),
  };
}

/**
 * Stands in for `bscript`: makes the files the three commands the compiler
 * runs would make, as `~/…/bluescript/cli` writes them, and records each call.
 * Like `bscript`, it fails on a directory that already exists and on a project
 * already registered.
 */
export class FakeBscript implements BscriptRunner {
  readonly calls: { args: readonly string[]; cwd: string }[] = [];
  installed = true;
  /** Makes the next call with this first argument pair fail, as `bscript` would by exiting 1. */
  failOn: string | undefined;

  available(): boolean {
    return this.installed;
  }

  run(args: readonly string[], cwd: string): void {
    this.calls.push({ args, cwd });
    const [group, command, name] = args;
    if (this.failOn === `${group} ${command}`) {
      throw new CommandError(`\`bscript ${args.join(" ")}\` (in ${cwd}) exited with 1`);
    }
    if (group === "workspace" && command === "create") {
      const root = join(cwd, name!);
      if (existsSync(root)) throw new CommandError(`${root} already exists`);
      mkdirSync(root);
      writeFileSync(join(root, "bsworkspace.json"), JSON.stringify({ name, projects: [] }, null, 2));
      return;
    }
    if (group === "project" && command === "create") {
      const root = join(cwd, name!);
      if (existsSync(root)) throw new CommandError(`${root} already exists`);
      const board = args[args.indexOf("-b") + 1]!;
      writeFiles(root, {
        ".gitignore": "**/dist/\n**/packages/\n",
        "src/index.bs": `console.log("Hello world!");\n`,
        "bsconfig.json": {
          projectName: name,
          version: "1.0.0",
          vmVersion: "2.1.0",
          srcDir: "./src",
          entryFile: "./src/index.bs",
          dependencies: {},
          boardName: board,
          ...(board === "esp32" ? { espIdfComponents: [] } : {}),
        },
      });
      return;
    }
    if (group === "workspace" && command === "add") {
      const file = join(cwd, "bsworkspace.json");
      const workspace = readJson(file);
      const path = `./${name}`;
      if (workspace.projects.some((p: { path: string }) => resolve(cwd, p.path) === resolve(cwd, path))) {
        throw new CommandError(`${resolve(cwd, path)} is already in the workspace.`);
      }
      const entry: Record<string, string> = { path };
      const d = args.indexOf("-d");
      if (d >= 0) entry.deviceName = args[d + 1]!;
      workspace.projects.push(entry);
      writeFileSync(file, JSON.stringify(workspace, null, 2));
      return;
    }
    if (group === "workspace" && command === "run") {
      // Running is recorded and nothing more.
      return;
    }
    throw new Error(`FakeBscript: unexpected bscript ${args.join(" ")}`);
  }

  /** The calls, as `bscript …` lines with the directory they ran in relative to `root`. */
  commands(root: string): string[] {
    return this.calls.map(({ args, cwd }) => `${cwd === root ? "." : cwd.slice(root.length + 1)}$ bscript ${args.join(" ")}`);
  }
}

/** A project at `root` with `workspace/` made by `bscript` for each endpoint, all registered. */
export function scaffold(
  root: string,
  endpoints: readonly { name: string; board: string; deviceName?: string }[],
  source = "",
): FakeBscript {
  writeFiles(root, { "choreobs.json": projectConfig(endpoints), "src/index.cbs": source });
  const bscript = new FakeBscript();
  bscript.run(["workspace", "create", "workspace"], root);
  for (const endpoint of endpoints) {
    bscript.run(["project", "create", endpoint.name, "-b", endpoint.board], join(root, "workspace"));
    bscript.run(
      ["workspace", "add", endpoint.name, ...(endpoint.deviceName === undefined ? [] : ["-d", endpoint.deviceName])],
      join(root, "workspace"),
    );
  }
  return bscript;
}

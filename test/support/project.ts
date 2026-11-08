import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { BscriptRunner } from "../../src/workspace/runner.js";
import { CommandError } from "../../src/workspace/errors.js";

/** The repository's root directory. */
export const REPO_ROOT = join(import.meta.dirname, "..", "..");

const PROGRAM_DIRS = ["examples", "benchmarks/micro", "benchmarks/macro"];

/** The example and benchmark projects, as paths relative to {@link REPO_ROOT}, in a fixed order. */
export function projectRoots(): string[] {
  return PROGRAM_DIRS.flatMap((dir) =>
    readdirSync(join(REPO_ROOT, dir))
      .filter((name) => statSync(join(REPO_ROOT, dir, name)).isDirectory())
      .sort()
      .map((name) => join(dir, name)),
  );
}

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

/** A package {@link FakeBscript} can install, as its repository holds it. */
export interface FakePackage {
  readonly projectName: string;
  readonly boardName: string;
  /** Its files besides `bsconfig.json`, by path below its root. */
  readonly files?: Readonly<Record<string, string>>;
  /** The packages it depends on: name to URL, each one {@link FakeBscript.packages} has. */
  readonly dependencies?: Readonly<Record<string, string>>;
}

/**
 * Stands in for `bscript`: makes the files the commands the compiler runs
 * would make, as `~/…/bluescript/cli` writes them, and records each call.
 * Like `bscript`, it fails on a directory that already exists and on a project
 * already registered.
 */
export class FakeBscript implements BscriptRunner {
  readonly calls: { args: readonly string[]; cwd: string }[] = [];
  installed = true;
  /** Makes the next call with this first argument pair fail, as `bscript` would by exiting 1. */
  failOn: string | undefined;
  /** The packages `project install` can download, by URL; any tag fetches the same one. */
  readonly packages = new Map<string, FakePackage>();

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
    if (group === "project" && command === "install") {
      // As `bscript`: the package and what it depends on go into `packages/`,
      // named after their projectName, and only the package into bsconfig.json.
      const url = name!;
      const t = args.indexOf("-t");
      const tag = t >= 0 ? args[t + 1]! : undefined;
      const pkg = this.download(cwd, url);
      const queue = Object.values(pkg.dependencies ?? {});
      const seen = new Set<string>();
      while (queue.length > 0) {
        const dep = queue.shift()!;
        if (seen.has(dep)) continue;
        seen.add(dep);
        queue.push(...Object.values(this.download(cwd, dep).dependencies ?? {}));
      }
      const file = join(cwd, "bsconfig.json");
      const config = readJson(file);
      config.dependencies = { ...config.dependencies, [pkg.projectName]: tag === undefined ? url : `${url}#${tag}` };
      writeFileSync(file, JSON.stringify(config, null, 2));
      return;
    }
    if (group === "project" && command === "uninstall") {
      const file = join(cwd, "bsconfig.json");
      const config = readJson(file);
      if (!Object.hasOwn(config.dependencies ?? {}, name!)) {
        throw new CommandError(`Package ${name} is not listed in bsconfig.json dependencies.`);
      }
      rmSync(join(cwd, "packages", name!), { recursive: true, force: true });
      delete config.dependencies[name!];
      writeFileSync(file, JSON.stringify(config, null, 2));
      return;
    }
    throw new Error(`FakeBscript: unexpected bscript ${args.join(" ")}`);
  }

  /** Writes the package at `url` into `<project>/packages/<projectName>/`, replacing what is there. */
  private download(project: string, url: string): FakePackage {
    const pkg = this.packages.get(url);
    if (pkg === undefined) {
      throw new CommandError(`\`bscript project install ${url}\` (in ${project}) exited with 1`);
    }
    const dir = join(project, "packages", pkg.projectName);
    rmSync(dir, { recursive: true, force: true });
    writeFiles(dir, {
      ...pkg.files,
      "bsconfig.json": {
        projectName: pkg.projectName,
        version: "1.0.0",
        vmVersion: "2.1.0",
        dependencies: pkg.dependencies ?? {},
        boardName: pkg.boardName,
      },
    });
    return pkg;
  }

  /** The calls, as `bscript …` lines with the directory they ran in relative to `root`. */
  commands(root: string): string[] {
    return this.calls.map(({ args, cwd }) => `${cwd === root ? "." : cwd.slice(root.length + 1)}$ bscript ${args.join(" ")}`);
  }
}

/** A project at `root` with `workspace/` made by `bscript` for each endpoint, all registered. */
export function scaffold(
  root: string,
  endpoints: readonly { name: string; board: string; deviceName?: string; dependencies?: Record<string, string> }[],
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

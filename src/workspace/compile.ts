import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  compileProject,
  type CompileDiagnostic,
  type ProjectCompileResult,
} from "../driver/index.js";
import { COMPILER_NAME_PREFIX } from "../runtime/names.js";
import type { BlueScriptProjectConfig } from "./bscript-files.js";
import { CommandError } from "./errors.js";
import {
  clashes,
  inspectEndpointProject,
  inspectWorkspace,
  otherProjects,
  show,
  type WorkspaceState,
} from "./inspect.js";
import { PROJECT_CONFIG_FILE, RUNTIME_FILE, WORKSPACE_CONFIG_FILE, WORKSPACE_DIR } from "./layout.js";

/** BlueScript's own defaults, for a `bsconfig.json` that leaves them out. */
const DEFAULT_ENTRY_FILE = "./index.bs";
const DEFAULT_SRC_DIR = ".";

export interface WriteResult {
  readonly compilation: ProjectCompileResult;
  /** Empty exactly when the files were written. */
  readonly errors: readonly CompileDiagnostic[];
  /** Registered projects that are no endpoint's (spec §output-files). */
  readonly warnings: readonly string[];
  /**
   * Every file written: for each endpoint, its program, its runtime file and
   * the copies of its BlueScript source files (spec §bluescript-source-file-copies).
   */
  readonly written: readonly string[];
}

/**
 * `choreobs compile`: compiles the project at `root` and writes each
 * endpoint's program, runtime file and copies of the BlueScript source files
 * into its BlueScript project (spec §output-files). Nothing is written unless the program compiles and the
 * workspace agrees with `choreobs.json` throughout. `bscript` is never run.
 */
export function writeProject(projectRoot: string): WriteResult {
  const root = resolve(projectRoot);
  const compilation = compileProject(root);
  const failed = (errors: readonly CompileDiagnostic[], warnings: readonly string[] = []): WriteResult =>
    ({ compilation, errors, warnings, written: [] });
  if (!compilation.success || compilation.config === undefined) {
    return failed(compilation.errors);
  }
  const { endpoints } = compilation.config;

  let workspace: WorkspaceState;
  try {
    workspace = inspectWorkspace(root);
  } catch (e) {
    return failed([diagnostic(e)]);
  }
  if (workspace.kind === "missing") {
    return failed([{
      message:
        `there is no workspace: ${WORKSPACE_DIR}/${WORKSPACE_CONFIG_FILE} does not exist; ` +
        `run \`choreobs add-endpoint <name>\` for each endpoint to make it`,
      spec: ["output-files", "commands"],
    }]);
  }

  const errors: CompileDiagnostic[] = [];
  const report = (message: string): void => {
    errors.push({ message, spec: ["output-files"] });
  };
  const targets: {
    endpoint: string;
    entry: string;
    runtime: string;
    copies: { path: string; source: string }[];
  }[] = [];
  const others = otherProjects(root, workspace, endpoints);
  for (const endpoint of endpoints) {
    const project = inspectEndpointProject(root, workspace, endpoint);
    project.problems.forEach(report);
    for (const other of others) {
      clashes(root, endpoint, other).forEach(report);
    }
    if (project.config === undefined) {
      if (project.problems.length === 0) {
        errors.push({
          message:
            `endpoint '${endpoint.name}' has no BlueScript project: ${show(root, join(project.dir, PROJECT_CONFIG_FILE))} ` +
            `does not exist; run \`choreobs add-endpoint ${endpoint.name}\``,
          spec: ["output-files", "commands"],
        });
      }
      continue;
    }
    if (!project.registered && project.problems.length === 0) {
      errors.push({
        message:
          `endpoint '${endpoint.name}'s project ${show(root, project.dir)} is not registered in ` +
          `${WORKSPACE_DIR}/${WORKSPACE_CONFIG_FILE}; run \`choreobs add-endpoint ${endpoint.name}\``,
        spec: ["output-files", "commands"],
      });
    }
    const entry = entryFile(root, project.dir, project.config);
    if (typeof entry !== "string") {
      report(entry.problem);
      continue;
    }
    // A copy goes below the program's directory as its source file is below
    // `src/`, so that the import's module name finds it there
    // (spec §bluescript-source-file-copies). None may land on the program.
    const copies = compilation.sourceFiles
      .filter((file) => file.endpoint === endpoint.name)
      .map((file) => ({ path: join(dirname(entry), ...file.path.split("/")), source: file.source }));
    for (const copy of copies) {
      if (copy.path.toLowerCase() === entry.toLowerCase()) {
        report(
          `the copy of src/${relative(dirname(entry), copy.path).split(sep).join("/")} would overwrite ` +
            `endpoint '${endpoint.name}'s entry file ${show(root, entry)}`,
        );
      }
    }
    targets.push({ endpoint: endpoint.name, entry, runtime: join(dirname(entry), RUNTIME_FILE), copies });
  }

  const warnings = others.map((other) =>
    other.unreadable !== undefined
      ? `${show(root, other.dir)} is registered in the workspace but cannot be read (${other.unreadable}); ` +
        `\`bscript workspace run\` will fail on it`
      : `${show(root, other.dir)} is registered in the workspace but is no endpoint's; ` +
        `\`choreobs run\` leaves it out, but \`bscript workspace run\` on its own runs it`,
  );
  if (errors.length > 0) {
    return failed(errors, warnings);
  }

  const written: string[] = [];
  for (const target of targets) {
    const program = compilation.outputs.find((o) => o.endpoint === target.endpoint)!;
    const runtime = compilation.runtimeOutputs.find((o) => o.endpoint === target.endpoint)!;
    mkdirSync(dirname(target.entry), { recursive: true });
    writeFileSync(target.entry, program.source, "utf8");
    writeFileSync(target.runtime, runtime.source, "utf8");
    written.push(target.entry, target.runtime);
    for (const copy of target.copies) {
      mkdirSync(dirname(copy.path), { recursive: true });
      writeFileSync(copy.path, copy.source, "utf8");
      written.push(copy.path);
    }
  }
  return { compilation, errors: [], warnings, written };
}

/**
 * Where the project's program goes: its `entryFile`, joined onto the project
 * as BlueScript joins it (spec §output-files). The name must keep clear of the
 * compiler's `__` prefix, so that the runtime file beside it cannot be it, and
 * the file must lie under `srcDir`, as BlueScript requires of every source.
 */
function entryFile(
  root: string,
  dir: string,
  config: BlueScriptProjectConfig,
): string | { problem: string } {
  const entry = join(dir, config.entryFile ?? DEFAULT_ENTRY_FILE);
  const where = `${show(root, join(dir, PROJECT_CONFIG_FILE))}: entry file ${show(root, entry)}`;
  if (basename(entry).startsWith(COMPILER_NAME_PREFIX)) {
    return { problem: `${where} begins with '${COMPILER_NAME_PREFIX}', which the compiler's own files use` };
  }
  const srcDir = join(dir, config.srcDir ?? DEFAULT_SRC_DIR);
  const inside = relative(srcDir, entry);
  if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    return { problem: `${where} is not under the project's source directory ${show(root, srcDir)}` };
  }
  return entry;
}

function diagnostic(e: unknown): CompileDiagnostic {
  if (e instanceof CommandError) {
    return { message: e.message, spec: e.spec };
  }
  return { message: e instanceof Error ? e.message : String(e), spec: [] };
}

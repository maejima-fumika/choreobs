import { basename, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { parse, type ParseError } from "../parser/index.js";
import { typeCheck, type TypeCheckError } from "../check/index.js";
import { projectAll } from "../epp/index.js";
import { finalizeAbsentAll } from "../finalize/index.js";
import { cleanupAll } from "../cleanup/index.js";
import { emit } from "../emit/index.js";
import { lowerProgram } from "../lower/index.js";
import { importsDynRuntime, runtimeImports } from "../runtime/imports.js";
import { runtimeSource } from "../runtime/source.js";
import { COMPILER_NAME_PREFIX } from "../runtime/names.js";
import {
  assignCommTags,
  commConsistencyDiagnostics,
  verifyCommunicationConsistency,
  type CommConsistencyDiagnostic,
} from "../comm/index.js";
import type { SpecCited } from "../spec/ref.js";
import {
  compilerConfig,
  loadConfig,
  validateEndpoints,
  ConfigError,
  type ChoreoBSConfig,
  type ProjectConfig,
} from "../config/index.js";
import { configPath, sourcePath } from "../workspace/layout.js";
import type { LexicalError } from "../lexer/index.js";
import {
  NO_SOURCE_FILES,
  readSourceFiles,
  resolveImports,
  sourceFilesFor,
  validateSourceFiles,
  type ImportDiagnostic,
  type SourceFiles,
} from "../local-imports/index.js";

/**
 * A failure the driver reports itself: an unreadable or invalid config, a
 * missing source file, or a workspace that does not match the config.
 */
export interface DriverDiagnostic extends SpecCited {
  readonly message: string;
  readonly span?: { start: number; end: number };
}

export type CompileDiagnostic =
  | LexicalError
  | ParseError
  | TypeCheckError
  | CommConsistencyDiagnostic
  | ImportDiagnostic
  | DriverDiagnostic;

/**
 * One file's text for one endpoint. Where it goes is the workspace's business
 * (spec §output-files), not the compiler's.
 */
export interface CompileOutput {
  readonly endpoint: string;
  readonly source: string;
}

export interface CompileResult {
  readonly success: boolean;
  /** One program per endpoint, in the order `endpoints` lists them. */
  readonly outputs: readonly CompileOutput[];
  /**
   * The runtime file for each endpoint, in the same order, whether or not its
   * program imports from it (spec §runtime-files). Empty only for a failed
   * compilation. Kept apart from `outputs`, which hold the endpoint programs
   * alone.
   */
  readonly runtimeOutputs: readonly CompileOutput[];
  /**
   * The BlueScript source files each endpoint gets a copy of
   * (spec §bluescript-source-file-copies): for each endpoint in the order
   * `endpoints` lists them, its files in path order. Empty for a failed
   * compilation.
   */
  readonly sourceFiles: readonly SourceFileOutput[];
  readonly errors: readonly CompileDiagnostic[];
}

/** A BlueScript source file for one endpoint, at its path below `src/` (with `/`). */
export interface SourceFileOutput {
  readonly endpoint: string;
  readonly path: string;
  readonly source: string;
}

/** A compilation that stopped at `errors`, with nothing to write. */
function failed(errors: readonly CompileDiagnostic[]): CompileResult {
  return { success: false, outputs: [], runtimeOutputs: [], sourceFiles: [], errors };
}

/** {@link CompileResult}, for a project read from disk. */
export interface ProjectCompileResult extends CompileResult {
  /** The configuration, when `choreobs.json` could be read. */
  readonly config?: ProjectConfig;
  /** `src/index.cbs`, when it could be read: diagnostics point into it. */
  readonly source?: string;
  readonly sourcePath: string;
  /** The BlueScript source files under `src/`, when they could be read (spec §bluescript-source-files). */
  readonly files?: SourceFiles;
}

/**
 * Compiles the project at `root`: its `choreobs.json` and its `src/index.cbs`
 * (spec §input-files). Nothing is written; see `writeProject`.
 */
export function compileProject(root: string): ProjectCompileResult {
  const path = sourcePath(root);
  let config: ProjectConfig;
  try {
    config = loadConfig(configPath(root));
  } catch (e) {
    // This also catches a missing file, which breaks no spec rule.
    const message = e instanceof Error ? e.message : String(e);
    const spec = e instanceof ConfigError ? e.spec : [];
    return { ...failed([{ message, spec }]), sourcePath: path };
  }
  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch (e) {
    const message = `cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`;
    return { ...failed([{ message, spec: ["input-files"] }]), config, sourcePath: path };
  }
  let files: SourceFiles;
  try {
    files = readSourceFiles(dirname(path));
  } catch (e) {
    const message = `cannot read the BlueScript source files under ${dirname(path)}: ${e instanceof Error ? e.message : String(e)}`;
    return { ...failed([{ message, spec: ["input-files", "bluescript-source-files"] }]), config, source, sourcePath: path };
  }
  return {
    ...compileSource(source, path, compilerConfig(config), files),
    config,
    source,
    sourcePath: path,
    files,
  };
}

/**
 * `files` are the BlueScript source files next to the program
 * (spec §bluescript-source-files), which its imports name. A caller with only
 * a program to compile passes none, and an import then names no file.
 */
export function compileSource(
  source: string,
  cbsPath: string,
  config: ChoreoBSConfig,
  files: SourceFiles = NO_SOURCE_FILES,
): CompileResult {
  // `compileSource` is the single funnel for every compilation path, and it
  // takes a `ChoreoBSConfig` that need not have come from `loadConfig`
  // (the fuzz scripts build one from a raw `--endpoints` string). The endpoint
  // set is validated here so that no caller can slip past it (spec §choreobs-json).
  const invalidConfig = validateEndpoints(config.endpoints);
  if (invalidConfig !== undefined) {
    return failed([{ message: invalidConfig.message, spec: invalidConfig.spec }]);
  }

  // The compiler names the files it writes with the reserved `__` prefix, as it
  // does the identifiers it introduces, and keeps it out of the files it is
  // given (spec §input-files, §identifiers).
  if (basename(cbsPath).startsWith(COMPILER_NAME_PREFIX)) {
    return failed([{
      message: `input file name '${basename(cbsPath)}' must not begin with '${COMPILER_NAME_PREFIX}', which is reserved for the compiler`,
      spec: ["input-files", "reserved-input-file-name"],
    }]);
  }

  // Every source file is copied, so every one is held to the naming rules,
  // whether or not the program imports from it (spec §bluescript-source-file-names).
  const badFile = validateSourceFiles(files, config.endpoints);
  if (badFile !== undefined) {
    return failed([badFile]);
  }

  const parsed = parse(source);
  const errors: CompileDiagnostic[] = [...parsed.errors];

  if (parsed.program === null || parsed.errors.length > 0) {
    return failed(errors);
  }

  const resolved = resolveImports(parsed.program.imports, files, config.endpoints);
  if (resolved.imports === null) {
    return failed([...errors, ...resolved.errors]);
  }

  const checked = typeCheck(parsed.program, config, resolved.imports);
  errors.push(...checked.errors);

  if (checked.typed === null || checked.errors.length > 0) {
    return failed(errors);
  }

  // Tagging -> dyn lowering -> EPP -> absent finalization -> cleanup -> emission
  // (spec §communication-tags, §dyn-lowering, §absent-finalization,
  // §projected-ast-cleanup). Lowering comes after tagging so that a dynamic
  // transfer is numbered with the static ones, in source order (spec §communication-tags).
  const lowered = lowerProgram(assignCommTags(checked.typed));
  const projected = projectAll(lowered, config.endpoints);
  const finalized = finalizeAbsentAll(projected);
  const cleaned = cleanupAll(finalized);

  const imports = cleaned.map(runtimeImports);
  const outputs: CompileOutput[] = cleaned.map((program, i) => ({
    endpoint: program.endpoint,
    source: emit(program, imports[i]),
  }));

  const commCheck = verifyCommunicationConsistency(
    cleaned,
    outputs.map((o) => ({ endpoint: o.endpoint, source: o.source })),
  );
  if (!commCheck.ok) {
    return failed([...errors, ...commConsistencyDiagnostics(commCheck.errors)]);
  }

  // The runtime file is written for every endpoint, each with the same parts:
  // the dynamic-location runtime is there for all of them or none, since a
  // `dyn` value lives at all of them (spec §runtime-files). Its location
  // constants number the endpoints, so every file is made from the one list
  // (spec §location-and-kind-codes).
  const usesDyn = imports.some(importsDynRuntime);
  const runtimeOutputs: CompileOutput[] = config.endpoints.map((endpoint) => ({
    endpoint,
    source: runtimeSource(endpoint, config.endpoints, usesDyn),
  }));

  const sourceFiles: SourceFileOutput[] = config.endpoints.flatMap((endpoint) =>
    sourceFilesFor(endpoint, files).map((path) => ({ endpoint, path, source: files.get(path)! })),
  );

  return { success: true, outputs, runtimeOutputs, sourceFiles, errors };
}

import { basename, dirname, extname, join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { parse, type ParseError } from "../parser/index.js";
import { typeCheck, type TypeCheckError } from "../check/index.js";
import { projectAll } from "../epp/index.js";
import { finalizeAbsentAll } from "../finalize/index.js";
import { cleanupAll } from "../cleanup/index.js";
import { emit } from "../emit/index.js";
import { lowerProgram } from "../lower/index.js";
import { importsDynRuntime, runtimeImports } from "../runtime/imports.js";
import { runtimeSource } from "../runtime/source.js";
import { runtimeModuleName } from "../runtime/dyn.js";
import { COMPILER_NAME_PREFIX } from "../runtime/names.js";
import {
  assignCommTags,
  commConsistencyDiagnostics,
  verifyCommunicationConsistency,
  type CommConsistencyDiagnostic,
} from "../comm/index.js";
import type { SpecCited } from "../spec/ref.js";
import {
  loadConfig,
  defaultConfigPath,
  validateEndpoints,
  ConfigError,
} from "../config/index.js";
import type { ChoreoBSConfig } from "../config/types.js";
import type { LexicalError } from "../lexer/index.js";

/** A failure the driver reports itself: an unreadable or invalid config. */
export interface DriverDiagnostic extends SpecCited {
  readonly message: string;
  readonly span?: { start: number; end: number };
}

export type CompileDiagnostic =
  | LexicalError
  | ParseError
  | TypeCheckError
  | CommConsistencyDiagnostic
  | DriverDiagnostic;

export interface CompileOutput {
  readonly endpoint: string;
  readonly path: string;
  readonly source: string;
}

export interface CompileResult {
  readonly success: boolean;
  /** One program per endpoint, in the order `endpoints` lists them. */
  readonly outputs: readonly CompileOutput[];
  /**
   * `__runtime_<endpoint>.bs` for each endpoint, for a program whose endpoint
   * programs import from it; empty otherwise (spec §output-files, §runtime-files).
   * Kept apart from `outputs`, which hold the endpoint programs alone.
   */
  readonly runtimeOutputs: readonly CompileOutput[];
  readonly errors: readonly CompileDiagnostic[];
}

export interface CompileOptions {
  readonly configPath?: string;
}

/** A compilation that stopped at `errors`, with nothing to write. */
function failed(errors: readonly CompileDiagnostic[]): CompileResult {
  return { success: false, outputs: [], runtimeOutputs: [], errors };
}

export function compileFile(
  cbsPath: string,
  options: CompileOptions = {},
): CompileResult {
  const source = readFileSync(cbsPath, "utf8");
  const configPath = options.configPath ?? defaultConfigPath(cbsPath);
  let config: ChoreoBSConfig;
  try {
    config = loadConfig(configPath);
  } catch (e) {
    // This also catches a missing file and a malformed JSON document, neither
    // of which breaks a spec rule.
    const message = e instanceof Error ? e.message : String(e);
    const spec = e instanceof ConfigError ? e.spec : [];
    return failed([{ message, spec }]);
  }
  return compileSource(source, cbsPath, config);
}

export function compileSource(
  source: string,
  cbsPath: string,
  config: ChoreoBSConfig,
): CompileResult {
  // `compileSource` is the single funnel for every compilation path, and it
  // takes a `ChoreoBSConfig` that need not have come from `loadConfig`
  // (the fuzz scripts build one from a raw `--endpoints` string). The endpoint
  // set is validated here so that no caller can slip past it (spec §choreobs-json).
  const invalidConfig = validateEndpoints(config.endpoints);
  if (invalidConfig !== undefined) {
    return failed([{ message: invalidConfig.message, spec: invalidConfig.spec }]);
  }

  // The compiler writes `__runtime_<endpoint>.bs` next to the outputs
  // (spec §output-files), so an input whose name took the reserved `__`
  // prefix could have its own output overwritten by it (spec §input-files,
  // §identifiers).
  if (basename(cbsPath).startsWith(COMPILER_NAME_PREFIX)) {
    return failed([{
      message: `input file name '${basename(cbsPath)}' must not begin with '${COMPILER_NAME_PREFIX}', which is reserved for the compiler`,
      spec: ["input-files", "reserved-input-file-name"],
    }]);
  }

  const parsed = parse(source);
  const errors: CompileDiagnostic[] = [...parsed.errors];

  if (parsed.program === null || parsed.errors.length > 0) {
    return failed(errors);
  }

  const checked = typeCheck(parsed.program, config);
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
  const stem = basename(cbsPath, extname(cbsPath));
  const outDir = dirname(cbsPath);

  const imports = cleaned.map(runtimeImports);
  const outputs: CompileOutput[] = cleaned.map((program, i) => ({
    endpoint: program.endpoint,
    path: join(outDir, `${stem}_${program.endpoint}.bs`),
    source: emit(program, imports[i]),
  }));

  const commCheck = verifyCommunicationConsistency(
    cleaned,
    outputs.map((o) => ({ endpoint: o.endpoint, source: o.source })),
  );
  if (!commCheck.ok) {
    return failed([...errors, ...commConsistencyDiagnostics(commCheck.errors)]);
  }

  // The runtime file is written only for a program that imports from it, and
  // then for every endpoint, each with the same parts: the dynamic-location
  // runtime is there for all of them or none, since a `dyn` value lives at all
  // of them (spec §runtime-files).
  const usesRuntime = imports.some((names) => names.length > 0);
  const usesDyn = imports.some(importsDynRuntime);
  const runtimeOutputs: CompileOutput[] = usesRuntime
    ? config.endpoints.map((endpoint) => ({
        endpoint,
        path: join(outDir, `${runtimeModuleName(endpoint)}.bs`),
        source: runtimeSource(endpoint, usesDyn),
      }))
    : [];

  return { success: true, outputs, runtimeOutputs, errors };
}

export function writeOutputs(outputs: readonly CompileOutput[]): void {
  for (const file of outputs) {
    writeFileSync(file.path, file.source, "utf8");
  }
}

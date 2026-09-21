import { basename, dirname, extname, join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { parse, type ParseError } from "../parser/index.js";
import { typeCheck, type TypeCheckError } from "../check/index.js";
import { projectAll } from "../epp/index.js";
import { finalizeAbsentAll } from "../finalize/index.js";
import { cleanupAll } from "../cleanup/index.js";
import { emit } from "../emit/index.js";
import {
  assignCommTags,
  commConsistencyDiagnostics,
  verifyCommunicationConsistency,
} from "../comm/index.js";
import {
  loadConfig,
  defaultConfigPath,
  validateEndpoints,
} from "../config/index.js";
import type { ChoreoBSConfig } from "../config/types.js";
import type { LexicalError } from "../lexer/index.js";

export type CompileDiagnostic =
  | LexicalError
  | ParseError
  | TypeCheckError
  | { readonly message: string; readonly span?: { start: number; end: number } };

export interface CompileOutput {
  readonly endpoint: string;
  readonly path: string;
  readonly source: string;
}

export interface CompileResult {
  readonly success: boolean;
  readonly outputs: readonly CompileOutput[];
  readonly errors: readonly CompileDiagnostic[];
}

export interface CompileOptions {
  readonly configPath?: string;
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
    const message = e instanceof Error ? e.message : String(e);
    return { success: false, outputs: [], errors: [{ message }] };
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
  // set is validated here so that no caller can slip past it (spec §2.2).
  const invalidConfig = validateEndpoints(config.endpoints);
  if (invalidConfig !== undefined) {
    return { success: false, outputs: [], errors: [{ message: invalidConfig }] };
  }

  const parsed = parse(source);
  const errors: CompileDiagnostic[] = [...parsed.errors];

  if (parsed.program === null || parsed.errors.length > 0) {
    return { success: false, outputs: [], errors };
  }

  const checked = typeCheck(parsed.program, config);
  errors.push(...checked.errors);

  if (checked.typed === null || checked.errors.length > 0) {
    return { success: false, outputs: [], errors };
  }

  // Tagging -> EPP -> absent finalization -> cleanup -> emission
  // (spec §11.5, §13.7, §13.9).
  const tagged = assignCommTags(checked.typed);
  const projected = projectAll(tagged, config.endpoints);
  const finalized = finalizeAbsentAll(projected);
  const cleaned = cleanupAll(finalized);
  const stem = basename(cbsPath, extname(cbsPath));
  const outDir = dirname(cbsPath);

  const outputs: CompileOutput[] = cleaned.map((program) => {
    const path = join(outDir, `${stem}_${program.endpoint}.bs`);
    const emitted = emit(program);
    return {
      endpoint: program.endpoint,
      path,
      source: emitted,
    };
  });

  const commCheck = verifyCommunicationConsistency(
    cleaned,
    outputs.map((o) => ({ endpoint: o.endpoint, source: o.source })),
  );
  if (!commCheck.ok) {
    return {
      success: false,
      outputs: [],
      errors: [...errors, ...commConsistencyDiagnostics(commCheck.errors)],
    };
  }

  return { success: true, outputs, errors };
}

export function writeOutputs(outputs: readonly CompileOutput[]): void {
  for (const file of outputs) {
    writeFileSync(file.path, file.source, "utf8");
  }
}

import { basename, dirname, extname, join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { parse, type ParseError } from "../parser/index.js";
import { typeCheck, type TypeCheckError } from "../check/index.js";
import { projectAll } from "../epp/index.js";
import { emit } from "../emit/index.js";
import { loadConfig, defaultConfigPath } from "../config/index.js";
import type { ChoreoBSConfig } from "../config/types.js";
import type { LexicalError } from "../lexer/index.js";

export type CompileDiagnostic =
  | LexicalError
  | ParseError
  | TypeCheckError
  | { readonly message: string; readonly span?: { start: number; end: number } };

export interface CompileOutput {
  readonly participant: string;
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

  const projected = projectAll(checked.typed, config.participants);
  const stem = basename(cbsPath, extname(cbsPath));
  const outDir = dirname(cbsPath);

  const outputs: CompileOutput[] = projected.map((program) => {
    const path = join(outDir, `${stem}_${program.participant}.bs`);
    const emitted = emit(program);
    return {
      participant: program.participant,
      path,
      source: emitted,
    };
  });

  return { success: true, outputs, errors };
}

export function writeOutputs(outputs: readonly CompileOutput[]): void {
  for (const file of outputs) {
    writeFileSync(file.path, file.source, "utf8");
  }
}

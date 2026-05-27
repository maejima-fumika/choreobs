import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileFile, writeOutputs } from "../driver/index.js";
import type { CompileDiagnostic } from "../driver/compile.js";

function usage(): void {
  console.error(`Usage: choreobs compile <file.cbs> [--config path/to/choreobs.json]`);
}

function buildLineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function offsetToLineColumn(offset: number, lineStarts: readonly number[]): {
  readonly line: number;
  readonly column: number;
} {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = lineStarts[mid]!;
    const next =
      mid + 1 < lineStarts.length ? lineStarts[mid + 1]! : Number.POSITIVE_INFINITY;
    if (offset < start) {
      high = mid - 1;
      continue;
    }
    if (offset >= next) {
      low = mid + 1;
      continue;
    }
    return { line: mid + 1, column: offset - start + 1 };
  }
  return { line: 1, column: offset + 1 };
}

function formatDiagnostic(
  error: CompileDiagnostic,
  lineStarts?: readonly number[],
): string {
  if ("span" in error && error.span !== undefined) {
    const { start, end } = error.span;
    if (
      typeof start === "number" &&
      typeof end === "number" &&
      lineStarts !== undefined
    ) {
      const startPos = offsetToLineColumn(start, lineStarts);
      const endPos = offsetToLineColumn(Math.max(start, end - 1), lineStarts);
      return `${error.message} [line ${startPos.line}:${startPos.column}-${endPos.line}:${endPos.column}] [${start}, ${end})`;
    }
    if (
      typeof start === "number" &&
      typeof end === "number"
    ) {
      return `${error.message} [${start}, ${end})`;
    }
    if (typeof start === "object" && typeof end === "object") {
      return `${error.message} [line ${start.line}:${start.column}-${end.line}:${end.column}] [${start.offset}, ${end.offset})`;
    }
  }
  return error.message;
}

function runCompile(args: string[]): number {
  let configPath: string | undefined;
  let cbsPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--config") {
      const next = args[++i];
      if (next === undefined) {
        console.error("error: --config requires a path");
        return 1;
      }
      configPath = resolve(next);
      continue;
    }
    if (arg.startsWith("-")) {
      console.error(`error: unknown option '${arg}'`);
      return 1;
    }
    if (cbsPath !== undefined) {
      console.error(`error: unexpected argument '${arg}'`);
      return 1;
    }
    cbsPath = resolve(arg);
  }

  if (cbsPath === undefined) {
    usage();
    return 1;
  }

  let lineStarts: number[] | undefined;
  try {
    const source = readFileSync(cbsPath, "utf8");
    lineStarts = buildLineStarts(source);
  } catch {
    lineStarts = undefined;
  }

  const result = compileFile(cbsPath, { configPath });
  if (!result.success) {
    for (const error of result.errors) {
      console.error(formatDiagnostic(error, lineStarts));
    }
    return 1;
  }

  writeOutputs(result.outputs);
  for (const output of result.outputs) {
    console.log(output.path);
  }
  return 0;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    usage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const command = args[0];
  const rest = args.slice(1);

  if (command === "compile") {
    process.exit(runCompile(rest));
  }

  console.error(`error: unknown command '${command}'`);
  usage();
  process.exit(1);
}

main();

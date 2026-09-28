import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileFile, writeOutputs } from "../driver/index.js";
import { buildLineStarts, formatDiagnostic } from "./format.js";

function usage(): void {
  console.error(`Usage: choreobs compile <file.cbs> [--config path/to/choreobs.json]`);
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

  const written = [...result.outputs, ...result.runtimeOutputs];
  writeOutputs(written);
  for (const output of written) {
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

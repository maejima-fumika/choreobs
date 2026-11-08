#!/usr/bin/env node
import { BOARD_NAMES, ConfigError, findProjectRoot, type BoardName } from "../config/index.js";
import type { CompileDiagnostic } from "../driver/index.js";
import {
  addEndpoint,
  CommandError,
  createProject,
  installPackages,
  runProject,
  systemBscript,
  writeProject,
  type WriteResult,
} from "../workspace/index.js";
import { buildLineStarts, formatDiagnostic } from "./format.js";

const USAGE = `Usage:
  choreobs create <name>
  choreobs add-endpoint <name> [-b|--board <${BOARD_NAMES.join("|")}>] [-d|--device-name <device-name>]
  choreobs install
  choreobs compile [--profile]
  choreobs run [--stats] [--profile]`;

function usage(): void {
  console.error(USAGE);
}

/** A failure the commands report as they do a diagnostic: message, then its spec sections. */
function report(e: unknown): number {
  if (e instanceof CommandError || e instanceof ConfigError) {
    console.error(formatDiagnostic({ message: e.message, spec: e.spec }));
    return 1;
  }
  throw e;
}

function runCreate(args: readonly string[]): number {
  if (args.length !== 1 || args[0]!.startsWith("-")) {
    usage();
    return 1;
  }
  try {
    const root = createProject(process.cwd(), args[0]!, systemBscript);
    console.log(`created ${root}`);
    console.log("next: add endpoints with `choreobs add-endpoint <name> -b <board>`");
    return 0;
  } catch (e) {
    return report(e);
  }
}

async function runAddEndpoint(args: readonly string[]): Promise<number> {
  let name: string | undefined;
  let board: string | undefined;
  let deviceName: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "-b" || arg === "--board" || arg === "-d" || arg === "--device-name") {
      const value = args[++i];
      if (value === undefined) {
        console.error(`error: ${arg} requires a value`);
        return 1;
      }
      if (arg === "-b" || arg === "--board") {
        board = value;
      } else {
        deviceName = value;
      }
      continue;
    }
    if (arg.startsWith("-")) {
      console.error(`error: unknown option '${arg}'`);
      return 1;
    }
    if (name !== undefined) {
      console.error(`error: unexpected argument '${arg}'`);
      return 1;
    }
    name = arg;
  }
  if (name === undefined) {
    usage();
    return 1;
  }
  try {
    const root = findProjectRoot(process.cwd());
    const result = await addEndpoint(root, { name, board, deviceName }, systemBscript, promptBoard);
    if (result.done.length === 0) {
      console.log(`endpoint '${name}' already has its BlueScript project; nothing to do`);
    }
    for (const line of result.done) {
      console.log(line);
    }
    return 0;
  } catch (e) {
    return report(e);
  }
}

/** Asks for a board on the terminal, or fails when there is none to ask on. */
async function promptBoard(endpoint: string): Promise<BoardName> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CommandError(
      `no board given for endpoint '${endpoint}', and no terminal to ask on; pass -b <${BOARD_NAMES.join("|")}>`,
      ["commands"],
    );
  }
  // Loaded only here: nothing else needs it.
  const { default: inquirer } = await import("inquirer");
  const { board } = await inquirer.prompt<{ board: BoardName }>([
    {
      type: "select",
      name: "board",
      message: `Which board does endpoint '${endpoint}' run on?`,
      choices: [...BOARD_NAMES],
    },
  ]);
  return board;
}

/** The project the command was run in, for the commands that take no argument. */
function projectRoot(command: string, args: readonly string[]): string | number {
  if (args.length > 0) {
    console.error(`error: ${command} takes no argument, but got '${args[0]}'`);
    usage();
    return 1;
  }
  try {
    return findProjectRoot(process.cwd());
  } catch (e) {
    return report(e);
  }
}

function runInstall(args: readonly string[]): number {
  const root = projectRoot("install", args);
  if (typeof root === "number") {
    return root;
  }
  try {
    const result = installPackages(root, systemBscript);
    if (result.done.length === 0) {
      console.log("every endpoint has the packages choreobs.json lists; nothing to do");
    }
    for (const line of result.done) {
      console.log(line);
    }
    return 0;
  } catch (e) {
    return report(e);
  }
}

/** Prints the warnings and errors of writing the project; true when it was written. */
function reportWrite(result: WriteResult): boolean {
  for (const warning of result.warnings) {
    console.error(`warning: ${warning}`);
  }
  const source = result.compilation.source;
  const lineStarts = source === undefined ? undefined : buildLineStarts(source);
  for (const error of result.errors as readonly CompileDiagnostic[]) {
    console.error(formatDiagnostic(error, lineStarts));
  }
  return result.errors.length === 0;
}

function runCompile(args: readonly string[]): number {
  let profile = false;
  const rest: string[] = [];
  for (const arg of args) {
    if (arg === "--profile") {
      profile = true;
    } else if (arg.startsWith("-")) {
      console.error(`error: unknown option '${arg}'`);
      return 1;
    } else {
      rest.push(arg);
    }
  }
  const root = projectRoot("compile", rest);
  if (typeof root === "number") {
    return root;
  }
  const result = writeProject(root, { profile });
  if (!reportWrite(result)) {
    return 1;
  }
  for (const path of result.written) {
    console.log(path);
  }
  return 0;
}

function runRun(args: readonly string[]): number {
  let stats = false;
  let profile = false;
  const rest: string[] = [];
  for (const arg of args) {
    if (arg === "--stats") {
      stats = true;
    } else if (arg === "--profile") {
      profile = true;
    } else if (arg.startsWith("-")) {
      console.error(`error: unknown option '${arg}'`);
      return 1;
    } else {
      rest.push(arg);
    }
  }
  const root = projectRoot("run", rest);
  if (typeof root === "number") {
    return root;
  }
  try {
    const result = runProject(root, systemBscript, reportWrite, { stats, profile });
    return result.errors.length === 0 ? 0 : 1;
  } catch (e) {
    return report(e);
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    usage();
    return args.length === 0 ? 1 : 0;
  }
  const [command, ...rest] = args;
  switch (command) {
    case "create":
      return runCreate(rest);
    case "add-endpoint":
      return runAddEndpoint(rest);
    case "install":
      return runInstall(rest);
    case "compile":
      return runCompile(rest);
    case "run":
      return runRun(rest);
    default:
      console.error(`error: unknown command '${command}'`);
      usage();
      return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e);
    process.exit(1);
  },
);

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { COMPILER_NAME_PREFIX } from "../runtime/names.js";
import type { ImportDiagnostic } from "./errors.js";

/**
 * The project's BlueScript source files (spec §bluescript-source-files): each
 * file's path below `src/`, with `/` between names, to its text. Ordered by
 * path, so that every list made from it is.
 */
export type SourceFiles = ReadonlyMap<string, string>;

export const NO_SOURCE_FILES: SourceFiles = new Map();

export const SOURCE_FILE_EXTENSION = ".bs";

/** The directory the source files are under, as messages show it. */
const SOURCE_DIR = "src";

/** A directory's name, or a file's name before `@` and `.bs` (spec §bluescript-source-file-names). */
const NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** `path`, a key of {@link SourceFiles}, as messages show it: `src/clock.bs`. */
export function shownSourcePath(path: string): string {
  return `${SOURCE_DIR}/${path}`;
}

/**
 * Every source file under `srcDir`, read (spec §bluescript-source-files). A
 * symbolic link is not followed: it is not a source file. Throws what the file
 * system throws.
 */
export function readSourceFiles(srcDir: string): SourceFiles {
  const paths: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), path);
      } else if (entry.isFile() && entry.name.endsWith(SOURCE_FILE_EXTENSION)) {
        paths.push(path);
      }
    }
  };
  walk(srcDir, "");
  paths.sort();
  return new Map(paths.map((path) => [path, readFileSync(join(srcDir, ...path.split("/")), "utf8")]));
}

/**
 * Where a source file goes (spec §bluescript-source-file-names): to the
 * endpoint its name ends in, or, without one, to every endpoint.
 * Meaningful only for a name {@link validateSourceFiles} accepts.
 */
export type SourceFileOwner =
  | { readonly kind: "shared" }
  | { readonly kind: "endpoint"; readonly endpoint: string };

export function sourceFileOwner(path: string): SourceFileOwner {
  const stem = fileStem(path);
  const at = stem.indexOf("@");
  return at < 0 ? { kind: "shared" } : { kind: "endpoint", endpoint: stem.slice(at + 1) };
}

/** The source files that go to `endpoint`, in path order (spec §bluescript-source-file-copies). */
export function sourceFilesFor(endpoint: string, files: SourceFiles): string[] {
  return [...files.keys()].filter((path) => {
    const owner = sourceFileOwner(path);
    return owner.kind === "shared" || owner.endpoint === endpoint;
  });
}

/**
 * The first source file whose path breaks the naming rules
 * (spec §bluescript-source-file-names), if any. Every file is held to them,
 * imported or not, since every one is copied.
 */
export function validateSourceFiles(
  files: SourceFiles,
  endpoints: readonly string[],
): ImportDiagnostic | undefined {
  const byFoldedPath = new Map<string, string>();
  for (const path of files.keys()) {
    const problem = namingProblem(path, endpoints);
    if (problem !== undefined) {
      return problem;
    }
    const folded = path.toLowerCase();
    const other = byFoldedPath.get(folded);
    if (other !== undefined) {
      return invalidName(
        `'${shownSourcePath(other)}' and '${shownSourcePath(path)}' differ only in case, and a file system that ignores case would make them one file`,
      );
    }
    byFoldedPath.set(folded, path);
  }
  return undefined;
}

function namingProblem(path: string, endpoints: readonly string[]): ImportDiagnostic | undefined {
  const shown = shownSourcePath(path);
  const names = path.split("/");
  for (const dir of names.slice(0, -1)) {
    if (dir.startsWith(COMPILER_NAME_PREFIX)) {
      return reservedName(shown, dir);
    }
    if (dir.includes("@")) {
      return invalidName(`'${shown}': a directory's name may not contain '@'; only a file's name ends in '@<endpoint>'`);
    }
    if (!NAME.test(dir)) {
      return invalidName(`'${shown}': the directory name '${dir}' ${NAME_RULE}`);
    }
  }
  const stem = fileStem(path);
  const parts = stem.split("@");
  if (parts.length > 2) {
    return invalidName(`'${shown}' has more than one '@'; a file's name ends in at most one '@<endpoint>'`);
  }
  const [name, endpoint] = parts as [string, string | undefined];
  if (name.startsWith(COMPILER_NAME_PREFIX)) {
    return reservedName(shown, name);
  }
  if (name === "") {
    return invalidName(`'${shown}' has no name before '@'`);
  }
  if (!NAME.test(name)) {
    return invalidName(`'${shown}': the file name '${name}' ${NAME_RULE}`);
  }
  if (endpoint === undefined) {
    return undefined;
  }
  if (endpoint === "every" || endpoint === "dyn") {
    return invalidName(`'${shown}': '${endpoint}' is not an individual location, so no endpoint can be named after '@'`);
  }
  if (!endpoints.includes(endpoint)) {
    return invalidName(`'${shown}': '${endpoint}' is not an endpoint listed in choreobs.json`);
  }
  return undefined;
}

const NAME_RULE = "must begin with a letter or '_' and go on with letters, digits, '_' and '-'";

/** The file's name without its directories and without `.bs`. */
function fileStem(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  return file.slice(0, file.length - SOURCE_FILE_EXTENSION.length);
}

function invalidName(message: string): ImportDiagnostic {
  return { message, spec: ["bluescript-source-files", "invalid-bluescript-file-name"] };
}

function reservedName(shown: string, name: string): ImportDiagnostic {
  return {
    message: `'${shown}': the name '${name}' must not begin with '${COMPILER_NAME_PREFIX}', which is reserved for the compiler`,
    spec: ["bluescript-source-files", "reserved-input-file-name"],
  };
}

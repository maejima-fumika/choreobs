/**
 * Checks on a successful compilation that hold for every program, shared by
 * `run.ts` and the fixed corpus in `test/integration/fuzz.test.ts`, so that the
 * wider search and the corpus cannot drift apart.
 */
import type { CompileResult } from "../../src/driver/index.js";
import { importsDynRuntime } from "../../src/runtime/imports.js";
import { RUNTIME_MODULE } from "../../src/runtime/dyn.js";

/** An import line of an endpoint program (spec §import-code-generation). */
const IMPORT_LINE = /^import \{[^}\n]*\} from "[^"\n]*";$/gm;

/** The runtime import line, with the names it imports (spec §runtime-import). */
const RUNTIME_IMPORT_LINE = new RegExp(`^import \\{ ([^}]*) \\} from "\\./${RUNTIME_MODULE}";$`, "m");

/**
 * What choreographic residue `source` carries, if any: a location annotation,
 * a transfer operator or an `absent` artifact (spec §location-annotation-removal,
 * §absent-finalization).
 */
export function choreoResidue(source: string): string | undefined {
  // A module name may hold an endpoint after `@`, naming an endpoint-specific
  // file (spec §bluescript-source-file-names); that is no location annotation.
  const code = source.replace(IMPORT_LINE, "");
  if (/@/.test(code)) {
    return "location annotation survived projection";
  }
  if (/<-/.test(source)) {
    return "transfer operator survived projection";
  }
  if (/\babsent\b/.test(source)) {
    return "'absent' survived projection";
  }
  return undefined;
}

/** The names `source` imports from the runtime file, in the order it lists them (spec §runtime-import). */
export function importsOf(source: string): string[] {
  return RUNTIME_IMPORT_LINE.exec(source)?.[1]?.split(", ") ?? [];
}

/** Whether `source` declares `name` as an export of its own. */
export function exportsName(source: string, name: string): boolean {
  return new RegExp(`^export (?:class|function|const) ${name}\\b`, "m").test(source);
}

/** What is wrong with the files a compilation produced for `endpoints`, if anything. */
export function inspectOutputs(
  result: CompileResult,
  endpoints: readonly string[],
): string | undefined {
  if (result.outputs.length !== endpoints.length) {
    return `expected ${endpoints.length} outputs, got ${result.outputs.length}`;
  }
  // The runtime comes for every endpoint, whether or not its program imports
  // from it (spec §runtime-files).
  if (result.runtimeOutputs.length !== endpoints.length) {
    return `expected ${endpoints.length} runtime files, got ${result.runtimeOutputs.length}`;
  }
  // Each holds the dynamic-location runtime exactly when some program imports
  // a name of it (spec §runtime-files).
  const importsDyn = result.outputs.some((o) => importsDynRuntime(importsOf(o.source)));
  for (const out of result.runtimeOutputs) {
    if (exportsName(out.source, "__DynVal") !== importsDyn) {
      return `${out.endpoint}: the runtime file ${importsDyn ? "lacks" : "holds"} the dynamic-location runtime`;
    }
  }
  // Every name a program imports is one its own runtime file exports: a
  // location constant names an endpoint of this compilation
  // (spec §runtime-import, §location-and-kind-codes).
  for (const out of result.outputs) {
    const runtime = result.runtimeOutputs.find((r) => r.endpoint === out.endpoint)?.source ?? "";
    const missing = importsOf(out.source).find((name) => !exportsName(runtime, name));
    if (missing !== undefined) {
      return `${out.endpoint}: imports ${missing}, which its runtime file does not export`;
    }
  }
  for (const out of [...result.outputs, ...result.runtimeOutputs]) {
    const residue = choreoResidue(out.source);
    if (residue !== undefined) {
      return `${out.endpoint}: ${residue}`;
    }
    let depth = 0;
    for (const ch of out.source) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      if (depth < 0) return `${out.endpoint}: unbalanced braces`;
    }
    if (depth !== 0) return `${out.endpoint}: unbalanced braces`;
  }
  return undefined;
}

/** Everything a compilation wrote, endpoint programs and runtime files alike, as one comparable key. */
export function outputsKey(result: CompileResult): string {
  return JSON.stringify([
    result.outputs.map((o) => [o.endpoint, o.source]),
    result.runtimeOutputs.map((o) => [o.endpoint, o.source]),
  ]);
}

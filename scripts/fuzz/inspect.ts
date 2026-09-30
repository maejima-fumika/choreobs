/**
 * Checks on a successful compilation that hold for every program, shared by
 * `run.ts` and the fixed corpus in `test/integration/fuzz.test.ts`, so that the
 * wider search and the corpus cannot drift apart.
 */
import type { CompileResult } from "../../src/driver/index.js";
import { DYN_RUNTIME_EXPORTS } from "../../src/runtime/dyn.js";

/**
 * What choreographic residue `source` carries, if any: a location annotation,
 * a transfer operator or an `absent` artifact (spec §location-annotation-removal,
 * §absent-finalization).
 */
export function choreoResidue(source: string): string | undefined {
  if (/@/.test(source)) {
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

/** What is wrong with the files a compilation produced for `endpoints`, if anything. */
export function inspectOutputs(
  result: CompileResult,
  endpoints: readonly string[],
): string | undefined {
  if (result.outputs.length !== endpoints.length) {
    return `expected ${endpoints.length} outputs, got ${result.outputs.length}`;
  }
  // The runtime comes for every endpoint or for none, and exactly when some
  // endpoint's program imports from it (spec §runtime-files, §runtime-import).
  const imports = result.outputs.some((o) => o.source.startsWith("import "));
  const expectedRuntime = imports ? endpoints.length : 0;
  if (result.runtimeOutputs.length !== expectedRuntime) {
    return `expected ${expectedRuntime} runtime files, got ${result.runtimeOutputs.length}`;
  }
  // Each holds the dynamic-location runtime exactly when some program imports
  // a name of it (spec §runtime-files).
  const importsDyn = result.outputs.some((o) => {
    const names = /^import \{ ([^}]*) \}/.exec(o.source)?.[1]?.split(", ") ?? [];
    return names.some((name) => DYN_RUNTIME_EXPORTS.includes(name));
  });
  for (const out of result.runtimeOutputs) {
    if (/^export class __DynVal\b/m.test(out.source) !== importsDyn) {
      return `${out.endpoint}: the runtime file ${importsDyn ? "lacks" : "holds"} the dynamic-location runtime`;
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

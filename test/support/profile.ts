import { PROFILE_OP, PROFILE_PREFIX, PROFILE_REPORT } from "../../src/runtime/profile.js";

/**
 * Undoes a profiling build (spec §profiling-build): what is left of a profiled
 * file once everything the profiling build adds is taken out. A profiling
 * build changes nothing else, so this must give back the ordinary build's
 * file, byte for byte.
 */

const WRAPPED_CALL = new RegExp(`(?<![A-Za-z0-9_])${PROFILE_PREFIX}(send|receive|broadcast)([A-Z])`, "g");
const PROFILE_NAME = new RegExp(`^__prof`);
const RUNTIME_IMPORT = /^import \{ (.*) \} from "\.\/__runtime";$/;
const COUNT_LINE = new RegExp(`^ *${PROFILE_PREFIX}\\w+ = ${PROFILE_PREFIX}\\w+ \\+ 1;$`);
const OP_LINE = new RegExp(`^ *${PROFILE_OP}\\(loc\\);$`);

/** An endpoint program without its profiling. */
export function unprofileProgram(source: string): string {
  const lines: string[] = [];
  for (const line of source.split("\n")) {
    if (line === `${PROFILE_REPORT}();`) {
      continue;
    }
    const runtimeImport = RUNTIME_IMPORT.exec(line);
    if (runtimeImport !== null) {
      const names = runtimeImport[1]!.split(", ").filter((name) => !PROFILE_NAME.test(name));
      if (names.length > 0) {
        lines.push(`import { ${names.join(", ")} } from "./__runtime";`);
      }
      continue;
    }
    lines.push(line.replace(WRAPPED_CALL, "$1$2"));
  }
  // What the import or the report leaves behind: a blank line that opened the
  // code, or one that followed the imports of a program with no code.
  let text = lines.join("\n").replace(/^\n+/, "");
  text = text.replace(/\n+$/, "\n");
  return text === "\n" ? "" : text;
}

/** A runtime file without its profiling. */
export function unprofileRuntime(source: string): string {
  const [first, second] = source.split("\n");
  const core = source.indexOf("export function __nothing1(");
  const rest = source
    .slice(core)
    .replace(new RegExp(`function ${PROFILE_OP}\\(loc: integer\\): void \\{\\n[\\s\\S]*?\\n\\}\\n\\n`), "")
    .split("\n")
    .filter((line) => !COUNT_LINE.test(line) && !OP_LINE.test(line))
    .join("\n")
    .replace(WRAPPED_CALL, "$1$2");
  return `${first}\n${second}\n\n${rest}`;
}

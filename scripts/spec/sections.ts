/**
 * Generates `src/spec/sections.ts` from spec.md.
 *
 *   npx tsx scripts/spec/sections.ts [--check]
 *
 * The generated file is committed. That keeps the build free of an ordering
 * dependency, and confines the diff of a renumber to one file — which is the
 * whole point of making the numbers a derived value.
 *
 * No line numbers are emitted: moving a heading must produce no diff here, or
 * the registry would churn on every edit to the prose.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./parse.js";
import { renderSections } from "./registry.js";

const OUT_PATH = join(REPO_ROOT, "src", "spec", "sections.ts");

function main(argv: readonly string[]): number {
  const wanted = renderSections();
  const current = (() => {
    try {
      return readFileSync(OUT_PATH, "utf8");
    } catch {
      return null;
    }
  })();

  if (current === wanted) {
    console.log("src/spec/sections.ts: up to date");
    return 0;
  }
  if (argv.includes("--check")) {
    console.error(
      "src/spec/sections.ts is out of date with spec.md — run `npm run spec:sections`",
    );
    return 1;
  }
  writeFileSync(OUT_PATH, wanted, "utf8");
  console.log(`src/spec/sections.ts: wrote ${wanted.split("\n").length} lines`);
  return 0;
}

process.exit(main(process.argv.slice(2)));

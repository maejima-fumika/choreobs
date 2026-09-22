/**
 * Renumbers spec.md's headings and refills its cross-reference links.
 *
 *   npx tsx scripts/spec/fmt.ts [--check]
 *
 * Run it after moving, adding or removing a heading. To add a numbered `####`,
 * write any digits in front of the title and let this work out the real one.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { SPEC_PATH } from "./parse.js";
import { renumber } from "./renumber.js";

function main(argv: readonly string[]): number {
  const before = readFileSync(SPEC_PATH, "utf8");
  const after = renumber(before);

  if (after === before) {
    console.log("spec.md: numbering is up to date");
    return 0;
  }
  if (argv.includes("--check")) {
    console.error("spec.md numbering is stale — run `npm run spec:fmt`");
    return 1;
  }
  writeFileSync(SPEC_PATH, after, "utf8");
  console.log("spec.md: renumbered");
  return 0;
}

process.exit(main(process.argv.slice(2)));

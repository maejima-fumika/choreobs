/**
 * Verifies that spec.md and the repo agree about what the sections are.
 *
 *   npx tsx scripts/spec/check.ts
 */
import { checkSpec } from "./lint.js";

const findings = checkSpec();
for (const f of findings) {
  console.error(`${f.where}: ${f.message}`);
}
if (findings.length === 0) {
  console.log("spec.md: ok");
}
process.exit(findings.length === 0 ? 0 : 1);

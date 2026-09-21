/** Prints one generated program and the compiler's verdict: npx tsx scripts/fuzz/dump.ts SEED [endpoints] */
import { compileSource } from "../../src/driver/index.js";
import { generate } from "./generator.js";

const seed = Number(process.argv[2] ?? "1");
const endpoints = (process.argv[3] ?? "alice,bob,carol").split(",");
const program = generate({ seed, endpoints });
console.log(program.source);
console.log("--- verdict ---");
try {
  const result = compileSource(program.source, "index.cbs", { endpoints });
  console.log(`success: ${result.success}`);
  for (const e of result.errors) {
    console.log(`  ${e.message}`);
  }
  if (result.success) {
    for (const out of result.outputs) {
      console.log(`\n--- ${out.endpoint} ---\n${out.source}`);
    }
  }
} catch (e) {
  console.log(`CRASH: ${e instanceof Error ? e.stack : String(e)}`);
}

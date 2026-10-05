/**
 * Prints one generated program and the compiler's verdict, exactly as `run.ts`
 * generated and compiled it for that seed:
 *
 *   npx tsx scripts/fuzz/dump.ts SEED [endpoints]
 *     [--endpoints a,b,c] [--vary] [--no-dyn] [--depth N] [--maxfn N] [--maxstmt N]
 *
 * Give it the flags the `run.ts` run had. The endpoints may also be given as
 * the second argument, `alice,bob`.
 */
import { compileSource } from "../../src/driver/index.js";
import { generate } from "./generator.js";
import { describeMode, fuzzGenOptions, parseFuzzArgs } from "./options.js";

const argv = process.argv.slice(2);
const seed = Number(argv[0] ?? "1");
const positional = argv[1] !== undefined && !argv[1].startsWith("-") ? argv[1] : undefined;
const parsed = parseFuzzArgs(argv);
const args = positional === undefined ? parsed : { ...parsed, endpoints: positional.split(",") };
const program = generate(fuzzGenOptions(seed, args));
console.log(`// endpoints: ${program.endpoints.join(", ")}`);
console.log(`// mode: ${describeMode(program, args)}`);
console.log(program.source);
console.log("--- verdict ---");
try {
  const result = compileSource(program.source, "index.cbs", {
    endpoints: program.endpoints,
    implicitDyn: program.implicitDyn,
  });
  console.log(`success: ${result.success}`);
  for (const e of result.errors) {
    console.log(`  ${e.message}`);
  }
  if (result.success) {
    for (const out of result.outputs) {
      console.log(`\n--- ${out.endpoint} ---\n${out.source}`);
    }
    console.log(`\n(and a runtime file for each of the ${result.runtimeOutputs.length} endpoints)`);
  }
} catch (e) {
  console.log(`CRASH: ${e instanceof Error ? e.stack : String(e)}`);
}

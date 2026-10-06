/**
 * Fuzz driver: generates well-typed ChoreoBS programs and compiles them.
 *
 * Any type error is a finding, because the generator only emits programs the
 * specification calls well typed. So is any communication-consistency error,
 * because those are only reachable once the checker has accepted the program.
 *
 * Programs use `@dyn` unless `--no-dyn` is given, and every other seed is
 * written for strict mode and compiled with `"implicitDyn": false`
 * (spec §strict-mode); `dump.ts` takes the same flags and reproduces a seed.
 *
 *   npx tsx scripts/fuzz/run.ts [--runs N] [--seed S] [--endpoints a,b,c]
 *     [--vary] [--no-dyn] [--depth N] [--maxfn N] [--maxstmt N] [--out DIR] [-v]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { compileSource } from "../../src/driver/index.js";
import { assertUsableEndpoints, generate } from "./generator.js";
import { describeMode, fuzzGenOptions, parseFuzzArgs } from "./options.js";
import { inspectOutputs, outputsKey } from "./inspect.js";
import { stripLocalFunctionLocations } from "./strip.js";

type Verdict = "ok" | "crash" | "commConsistency" | "rejected" | "badOutput";

interface Finding {
  readonly verdict: Verdict;
  readonly seed: number;
  readonly endpoints: readonly string[];
  /** The mode the program was generated and compiled in (see `describeMode`). */
  readonly mode: string;
  readonly detail: string;
  readonly source: string;
}

function parseArgs(argv: readonly string[]) {
  const fuzz = parseFuzzArgs(argv);
  return {
    ...fuzz,
    runs: Number(fuzz.get("--runs", "2000")),
    seed: Number(fuzz.get("--seed", "1")),
    verbose: argv.includes("-v"),
    outDir: fuzz.get("--out", "scratchpad/fuzz-findings"),
  };
}

/** Collapses identifiers and numbers so equivalent errors group together. */
function normalizeMessage(message: string): string {
  return message
    .replace(/'[^']*'/g, "'_'")
    .replace(/\b\d+\b/g, "N")
    .slice(0, 160);
}

function run(): void {
  const args = parseArgs(process.argv.slice(2));
  assertUsableEndpoints(args.endpoints);
  const counts: Record<Verdict, number> = {
    ok: 0,
    crash: 0,
    commConsistency: 0,
    rejected: 0,
    badOutput: 0,
  };
  const findings: Finding[] = [];
  const rejectionHistogram = new Map<string, { count: number; seed: number }>();
  const featureCounts = new Map<string, number>();
  let withCommunication = 0;

  for (let i = 0; i < args.runs; i += 1) {
    const seed = args.seed + i;
    const program = generate(fuzzGenOptions(seed, args));
    const { endpoints, implicitDyn } = program;
    const config = { endpoints, implicitDyn };
    for (const feature of program.features) {
      featureCounts.set(feature, (featureCounts.get(feature) ?? 0) + 1);
    }
    const record = (verdict: Verdict, detail: string) => {
      counts[verdict] += 1;
      findings.push({
        verdict,
        seed,
        endpoints,
        mode: describeMode(program, args),
        detail,
        source: program.source,
      });
    };

    let result: ReturnType<typeof compileSource>;
    try {
      result = compileSource(program.source, "index.cbs", config);
    } catch (e) {
      record("crash", e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      continue;
    }

    if (!result.success) {
      const messages = result.errors.map((e) => e.message);
      const commError = messages.find((m) =>
        m.startsWith("communication consistency"),
      );
      if (commError !== undefined) {
        record("commConsistency", commError);
      } else {
        const first = messages[0] ?? "(no message)";
        counts.rejected += 1;
        const key = normalizeMessage(first);
        const entry = rejectionHistogram.get(key);
        if (entry === undefined) {
          rejectionHistogram.set(key, { count: 1, seed });
        } else {
          entry.count += 1;
        }
      }
      continue;
    }

    const problem = inspectOutputs(result, endpoints);
    if (problem !== undefined) {
      record("badOutput", problem);
      continue;
    }

    const again = compileSource(program.source, "index.cbs", config);
    const before = outputsKey(result);
    if (before !== outputsKey(again)) {
      record("badOutput", "compilation is not deterministic");
      continue;
    }

    // Metamorphic: the order endpoints are declared in is not part of the
    // program's meaning, so each endpoint's output must be unaffected by it.
    const reversed = compileSource(program.source, "index.cbs", {
      ...config,
      endpoints: [...endpoints].reverse(),
    });
    if (!reversed.success) {
      record(
        "badOutput",
        `reversing the endpoint order changed acceptance: ${reversed.errors[0]?.message ?? "(no message)"}`,
      );
      continue;
    }
    const mismatch = endpoints.find((endpoint) => {
      const a = result.outputs.find((o) => o.endpoint === endpoint)?.source;
      const b = reversed.outputs.find((o) => o.endpoint === endpoint)?.source;
      return a !== b;
    });
    if (mismatch !== undefined) {
      record(
        "badOutput",
        `output for ${mismatch} depends on the order endpoints are declared in`,
      );
      continue;
    }

    // Metamorphic: a program that writes all its `dyn` out means the same in
    // either mode (spec §strict-mode).
    if (!implicitDyn) {
      const implicit = compileSource(program.source, "index.cbs", { endpoints });
      const same = implicit.success && outputsKey(implicit) === before;
      if (!same) {
        record("badOutput", "a program with explicit locations only compiles differently without strict mode");
        continue;
      }
    }

    // Metamorphic: a location left out inside a local function is the
    // function's own (spec §local-function-location-inference), so leaving out every
    // location written there changes nothing.
    const stripped = stripLocalFunctionLocations(program.source);
    if (stripped !== program.source) {
      const omitted = compileSource(stripped, "index.cbs", config);
      if (!omitted.success) {
        record(
          "badOutput",
          `leaving out the locations inside local functions changed acceptance: ${omitted.errors[0]?.message ?? "(no message)"}`,
        );
        continue;
      }
      if (outputsKey(omitted) !== before) {
        record("badOutput", "leaving out the locations inside local functions changed the output");
        continue;
      }
    }

    if (result.outputs.some((o) => /send|receive|broadcast|__dynTransfer/.test(o.source))) {
      withCommunication += 1;
    }
    counts.ok += 1;
  }

  console.log(
    `runs: ${args.runs}  seeds: ${args.seed}..${args.seed + args.runs - 1}`,
  );
  console.log(`endpoints: ${args.endpoints.join(", ")}`);
  console.log("");
  console.log(`  ok                     ${counts.ok}`);
  console.log(`    of which communicate ${withCommunication}`);
  console.log(`  rejected by checker    ${counts.rejected}`);
  console.log(`  crash                  ${counts.crash}`);
  console.log(`  comm inconsistency     ${counts.commConsistency}`);
  console.log(`  bad output             ${counts.badOutput}`);

  console.log("\nfeature coverage (programs exercising each):");
  for (const [feature, count] of [...featureCounts.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  ${String(count).padStart(6)}  ${feature}`);
  }

  if (rejectionHistogram.size > 0) {
    console.log(
      "\nrejection reasons (generator or checker disagrees with the spec):",
    );
    const sorted = [...rejectionHistogram.entries()].sort(
      (a, b) => b[1].count - a[1].count,
    );
    for (const [message, { count, seed }] of sorted) {
      console.log(`  ${String(count).padStart(5)}  [seed ${seed}]  ${message}`);
    }
  }

  if (findings.length > 0) {
    mkdirSync(args.outDir, { recursive: true });
    console.log(`\nfindings (${findings.length}) written to ${args.outDir}/`);
    for (const finding of findings.slice(0, 40)) {
      writeFileSync(
        `${args.outDir}/${finding.verdict}-${finding.seed}.cbs`,
        `// ${finding.verdict}: ${finding.detail}\n` +
          `// endpoints: ${finding.endpoints.join(", ")}\n` +
          `// mode: ${finding.mode}\n\n` +
          finding.source,
        "utf8",
      );
    }
    for (const finding of findings.slice(0, 10)) {
      console.log(`  [seed ${finding.seed}] ${finding.verdict}: ${finding.detail}`);
    }
  }

  if (args.verbose) {
    const sample = generate(fuzzGenOptions(args.seed, args));
    console.log("\n--- sample program (first seed) ---");
    console.log(sample.source);
  }
}

run();

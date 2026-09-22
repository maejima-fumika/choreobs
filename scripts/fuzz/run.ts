/**
 * Fuzz driver: generates well-typed ChoreoBS programs and compiles them.
 *
 * Any type error is a finding, because the generator only emits programs the
 * specification calls well typed. So is any communication-consistency error,
 * because those are only reachable once the checker has accepted the program.
 *
 *   npx tsx scripts/fuzz/run.ts [--runs N] [--seed S] [--endpoints a,b,c] [-v]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { compileSource } from "../../src/driver/index.js";
import { assertUsableEndpoints, generate } from "./generator.js";

type Verdict = "ok" | "crash" | "commConsistency" | "rejected" | "badOutput";

interface Finding {
  readonly verdict: Verdict;
  readonly seed: number;
  readonly endpoints: readonly string[];
  readonly detail: string;
  readonly source: string;
}

function parseArgs(argv: readonly string[]) {
  const get = (flag: string, fallback: string): string => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : fallback;
  };
  return {
    runs: Number(get("--runs", "2000")),
    seed: Number(get("--seed", "1")),
    endpoints: get("--endpoints", "alice,bob,carol").split(","),
    verbose: argv.includes("-v"),
    outDir: get("--out", "scratchpad/fuzz-findings"),
    blockDepth: Number(get("--depth", "2")),
    maxFunctions: Number(get("--maxfn", "3")),
    maxTopStatements: Number(get("--maxstmt", "8")),
    /** Draw a random endpoint subset per seed instead of using the whole list. */
    vary: argv.includes("--vary"),
  };
}

/** Checks the emitted BlueScript carries no choreographic residue (spec §location-annotation-removal). */
function inspectOutputs(
  result: ReturnType<typeof compileSource>,
  endpoints: readonly string[],
): string | undefined {
  if (result.outputs.length !== endpoints.length) {
    return `expected ${endpoints.length} outputs, got ${result.outputs.length}`;
  }
  for (const out of result.outputs) {
    if (/@/.test(out.source)) {
      return `${out.endpoint}: location annotation survived projection`;
    }
    if (/<-/.test(out.source)) {
      return `${out.endpoint}: transfer operator survived projection`;
    }
    if (/\babsent\b/.test(out.source)) {
      return `${out.endpoint}: 'absent' survived projection`;
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
    const endpoints = args.vary
      ? args.endpoints.slice(0, 2 + (seed % (args.endpoints.length - 1)))
      : args.endpoints;
    const program = generate({
      seed,
      endpoints,
      maxBlockDepth: args.blockDepth,
      maxFunctions: args.maxFunctions,
      maxTopStatements: args.maxTopStatements,
    });
    for (const feature of program.features) {
      featureCounts.set(feature, (featureCounts.get(feature) ?? 0) + 1);
    }
    const record = (verdict: Verdict, detail: string) => {
      counts[verdict] += 1;
      findings.push({
        verdict,
        seed,
        endpoints,
        detail,
        source: program.source,
      });
    };

    let result: ReturnType<typeof compileSource>;
    try {
      result = compileSource(program.source, "index.cbs", { endpoints });
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

    const again = compileSource(program.source, "index.cbs", { endpoints });
    const before = JSON.stringify(result.outputs.map((o) => o.source));
    const after = JSON.stringify(again.outputs.map((o) => o.source));
    if (before !== after) {
      record("badOutput", "compilation is not deterministic");
      continue;
    }

    // Metamorphic: the order endpoints are declared in is not part of the
    // program's meaning, so each endpoint's output must be unaffected by it.
    const reversed = compileSource(program.source, "index.cbs", {
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

    if (result.outputs.some((o) => /send|receive|broadcast/.test(o.source))) {
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
          `// endpoints: ${finding.endpoints.join(", ")}\n\n` +
          finding.source,
        "utf8",
      );
    }
    for (const finding of findings.slice(0, 10)) {
      console.log(`  [seed ${finding.seed}] ${finding.verdict}: ${finding.detail}`);
    }
  }

  if (args.verbose) {
    const sample = generate({ seed: args.seed, endpoints: args.endpoints });
    console.log("\n--- sample program (first seed) ---");
    console.log(sample.source);
  }
}

run();

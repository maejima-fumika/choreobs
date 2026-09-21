/**
 * Mutation fuzzer: generates a valid program carrying exactly one deliberate
 * rule violation and checks the compiler rejects it.
 *
 * A violation is emitted from the generator's own type and location
 * environment, so it is guaranteed real. An accepted program is therefore a
 * soundness hole, and the context it was injected into — top level, a local
 * function body, an if branch, a loop body — says where the rule stops holding.
 *
 *   npx tsx scripts/fuzz/violate.ts [--runs N] [--seed S] [--only ID]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { compileSource } from "../../src/driver/index.js";
import { generate, VIOLATIONS, type ViolationInfo } from "./generator.js";

interface Tally {
  caught: number;
  wrongReason: number;
  missed: number;
  notInjected: number;
  readonly contexts: Set<string>;
  readonly otherMessages: Map<string, number>;
  missedSeed?: number;
}

function parseArgs(argv: readonly string[]) {
  const get = (flag: string, fallback: string): string => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : fallback;
  };
  return {
    runs: Number(get("--runs", "4000")),
    seed: Number(get("--seed", "1")),
    endpoints: get("--endpoints", "alice,bob,carol").split(","),
    only: get("--only", ""),
    outDir: get("--out", "scratchpad/violation-findings"),
  };
}

function run(): void {
  const args = parseArgs(process.argv.slice(2));
  const violations: readonly ViolationInfo[] =
    args.only === "" ? VIOLATIONS : VIOLATIONS.filter((v) => v.id === args.only);
  if (violations.length === 0) {
    console.error(`unknown violation id '${args.only}'`);
    process.exit(1);
  }

  const tallies = new Map<string, Tally>();
  for (const v of violations) {
    tallies.set(v.id, {
      caught: 0,
      wrongReason: 0,
      missed: 0,
      notInjected: 0,
      contexts: new Set(),
      otherMessages: new Map(),
    });
  }

  const misses: { id: string; seed: number; context: string; source: string }[] = [];

  for (let i = 0; i < args.runs; i += 1) {
    const seed = args.seed + i;
    const violation = violations[i % violations.length]!;
    const tally = tallies.get(violation.id)!;
    const program = generate({
      seed,
      endpoints: args.endpoints,
      violation: violation.id,
    });

    if (program.injected === undefined) {
      tally.notInjected += 1;
      continue;
    }
    tally.contexts.add(program.injected.context);

    let result: ReturnType<typeof compileSource>;
    try {
      result = compileSource(program.source, "index.cbs", {
        endpoints: args.endpoints,
      });
    } catch (e) {
      tally.wrongReason += 1;
      const message = e instanceof Error ? `CRASH ${e.message}` : String(e);
      tally.otherMessages.set(message, (tally.otherMessages.get(message) ?? 0) + 1);
      continue;
    }

    if (result.success) {
      tally.missed += 1;
      tally.missedSeed ??= seed;
      if (misses.length < 40) {
        misses.push({
          id: violation.id,
          seed,
          context: program.injected.context,
          source: program.source,
        });
      }
      continue;
    }

    const messages = result.errors.map((e) => e.message);
    if (messages.some((m) => violation.expect.some((want) => m.includes(want)))) {
      tally.caught += 1;
    } else {
      tally.wrongReason += 1;
      const first = messages[0] ?? "(no message)";
      tally.otherMessages.set(first, (tally.otherMessages.get(first) ?? 0) + 1);
    }
  }

  console.log(`runs: ${args.runs}  endpoints: ${args.endpoints.join(", ")}\n`);
  const width = Math.max(...violations.map((v) => v.id.length));
  console.log(
    `${"violation".padEnd(width)}  ${"spec".padEnd(7)} caught  wrong  MISSED  skip  contexts`,
  );
  for (const v of violations) {
    const t = tallies.get(v.id)!;
    const flag = t.missed > 0 ? "  <== SOUNDNESS HOLE" : "";
    console.log(
      `${v.id.padEnd(width)}  ${v.spec.padEnd(7)} ${String(t.caught).padStart(6)} ${String(t.wrongReason).padStart(6)} ${String(t.missed).padStart(7)} ${String(t.notInjected).padStart(5)}  ${t.contexts.size}${flag}`,
    );
  }

  const withOther = violations.filter(
    (v) => tallies.get(v.id)!.otherMessages.size > 0,
  );
  if (withOther.length > 0) {
    console.log("\nrejected, but not with the expected message:");
    for (const v of withOther) {
      const t = tallies.get(v.id)!;
      for (const [message, count] of [...t.otherMessages].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
        console.log(`  ${v.id} (${count}x): ${message.slice(0, 120)}`);
      }
    }
  }

  const holes = violations.filter((v) => tallies.get(v.id)!.missed > 0);
  if (holes.length > 0) {
    mkdirSync(args.outDir, { recursive: true });
    console.log(`\nsoundness holes written to ${args.outDir}/`);
    for (const miss of misses) {
      writeFileSync(
        `${args.outDir}/${miss.id}-${miss.seed}.cbs`,
        `// ACCEPTED but violates ${miss.id}\n// injected in: ${miss.context}\n// endpoints: ${args.endpoints.join(", ")}\n\n${miss.source}`,
        "utf8",
      );
    }
    for (const v of holes) {
      const t = tallies.get(v.id)!;
      console.log(
        `  ${v.id} (${v.spec}): ${t.missed} accepted, first seed ${t.missedSeed}`,
      );
    }
  } else {
    console.log("\nno soundness holes: every injected violation was rejected.");
  }

  console.log("\ncontexts reached:");
  const allContexts = new Set<string>();
  for (const t of tallies.values()) {
    for (const c of t.contexts) allContexts.add(c);
  }
  console.log(`  ${[...allContexts].sort().join("\n  ")}`);
}

run();

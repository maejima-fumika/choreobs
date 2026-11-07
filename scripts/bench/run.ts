/**
 * Measures benchmarks across dyn precision (benchmarks/README.md, "Measuring").
 *
 *   npm run bench -- <benchmarks…> [options]
 *
 * A benchmark is named by its directory (`benchmarks/macro/a-smallbank-2pc`),
 * by its name (`a-smallbank-2pc`), or as a group: `micro`, `macro` or `all`.
 * `macro-esp32` needs an ESP32 board, so it is named only as a group or by its
 * directory: `all` and a name alone leave it out.
 *
 *   --seeds N           seeds 1…N, each a random order of the dyn-able locations (5)
 *   --seed-list a,b     these seeds instead
 *   --steps N           fractions 0, 1/N, …, 1 of the locations made dyn (10)
 *   --fractions a,b     these fractions instead; 0 is always measured
 *   --reps N            timing runs of each configuration (5)
 *   --end-reps N        timing runs of 0% and 100% instead, spread over the sweep (as --reps)
 *   --profile-reps N    profile runs of each configuration (1)
 *   --mode M            time, profile or both (both)
 *   --workloads FILE    workload constants by benchmark, as in benchmarks/workloads.json
 *   --set [b:]NAME=V    a workload constant, for every benchmark or for b (repeatable);
 *                       it overrides --workloads
 *   --out DIR           where the results go (benchmarks/results/<UTC time>)
 *   --timeout S         seconds before a run is killed (120)
 *   --warmup N          unrecorded baseline runs before a benchmark's first (1)
 *   --config FILE       a choreobs.json to use instead of the benchmark's (one benchmark only)
 *   --retry-failed N    run a run that ended failed, runtime_error or timeout up to N more
 *                       times, at the end of the sweep (0)
 *   --dry-run           list the runs, run nothing
 *
 * Each run appends one line to `<out>/runs.jsonl` (scripts/bench/records.ts).
 * Runs already there are skipped, so the same command resumes a sweep. With
 * --retry-failed, a run whose last record there failed is not skipped but tried
 * again, up to N more times.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { cpus, hostname, release, totalmem, type as osType } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { loadConfig } from "../../src/config/index.js";
import { PROFILE_COUNTERS, PROFILE_FORMAT_VERSION } from "../../src/runtime/profile.js";
import { addEndpoint, systemBscript, writeProject } from "../../src/workspace/index.js";
import { workspaceDir } from "../../src/workspace/layout.js";
import {
  configurations,
  configure,
  dynableLocations,
  dynSet,
  permutation,
  workloadConstants,
  type Configuration,
} from "./config.js";
import { compare, parseRun } from "./output.js";
import { planRuns, type PlannedRun } from "./plan.js";
import {
  configKey,
  latestRecords,
  parseRecords,
  RECORD_VERSION,
  RETRYABLE_STATUSES,
  runKey,
  type RunMode,
  type RunRecord,
  type RunStatus,
} from "./records.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const BENCHMARKS = join(REPO_ROOT, "benchmarks");
const GROUPS = ["micro", "macro"] as const;
/** Groups that run on boards, named on their own and never part of `all`. */
const BOARD_GROUPS = ["macro-esp32"] as const;

interface Options {
  readonly benches: readonly Bench[];
  readonly seeds: readonly number[];
  readonly fractions: readonly number[];
  readonly reps: number;
  /** From `--end-reps`: timing runs of 0% and 100%; null to take `reps`. */
  readonly endReps: number | null;
  readonly profileReps: number;
  readonly mode: "time" | "profile" | "both";
  readonly sets: readonly { bench: string | null; name: string; value: number }[];
  /** From `--workloads`: by benchmark (`<group>/<name>` or `<name>`), constant name to value. */
  readonly workloads: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly out: string;
  readonly timeout: number;
  readonly warmup: number;
  readonly config: string | null;
  /** From `--retry-failed`: further attempts at a run that ended with a status in RETRYABLE_STATUSES. */
  readonly retries: number;
  readonly dryRun: boolean;
}

interface Bench {
  /** `<group>/<name>`, or the directory's name for one outside benchmarks/. */
  readonly id: string;
  readonly dir: string;
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(2);
}

function listGroup(group: string): Bench[] {
  const dir = join(BENCHMARKS, group);
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort()
    .map((name) => ({ id: `${group}/${name}`, dir: join(dir, name) }));
}

function resolveBench(arg: string): Bench[] {
  if (arg === "all") return GROUPS.flatMap(listGroup);
  if ((GROUPS as readonly string[]).includes(arg) || (BOARD_GROUPS as readonly string[]).includes(arg)) {
    return listGroup(arg);
  }
  const path = resolve(arg);
  if (existsSync(join(path, "choreobs.json"))) {
    const rel = relative(BENCHMARKS, path);
    const id = !rel.startsWith("..") && rel.split("/").length === 2 ? rel : basename(path);
    return [{ id, dir: path }];
  }
  const found = GROUPS.flatMap(listGroup).filter((b) => basename(b.dir) === arg);
  if (found.length === 0) fail(`no benchmark '${arg}'`);
  return found;
}

function parseOptions(argv: readonly string[]): Options {
  const benches: Bench[] = [];
  const sets: Options["sets"][number][] = [];
  let seeds: number[] = [1, 2, 3, 4, 5];
  let steps = 10;
  let fractions: number[] | null = null;
  let reps = 5;
  let endReps: number | null = null;
  let profileReps = 1;
  let mode: Options["mode"] = "both";
  let out: string | null = null;
  let timeout = 120;
  let warmup = 1;
  let config: string | null = null;
  let workloads: Options["workloads"] = {};
  let retries = 0;
  let dryRun = false;
  const value = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined) fail(`${flag} requires a value`);
    return v;
  };
  const count = (text: string, flag: string, min = 0): number => {
    const n = Number(text);
    if (!Number.isInteger(n) || n < min) fail(`${flag} takes an integer of at least ${min}`);
    return n;
  };
  const list = (text: string, flag: string): number[] =>
    text.split(",").map((t) => {
      const n = Number(t);
      if (t.trim() === "" || !Number.isFinite(n)) fail(`${flag} takes numbers separated by commas`);
      return n;
    });
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case "--seeds":
        seeds = Array.from({ length: count(value(i++, arg), arg, 1) }, (_, j) => j + 1);
        break;
      case "--seed-list":
        seeds = list(value(i++, arg), arg);
        break;
      case "--steps":
        steps = count(value(i++, arg), arg, 1);
        break;
      case "--fractions":
        fractions = list(value(i++, arg), arg);
        if (fractions.some((p) => p < 0 || p > 1)) fail("--fractions takes numbers from 0 to 1");
        break;
      case "--reps":
        reps = count(value(i++, arg), arg);
        break;
      case "--end-reps":
        endReps = count(value(i++, arg), arg);
        break;
      case "--profile-reps":
        profileReps = count(value(i++, arg), arg);
        break;
      case "--mode": {
        const m = value(i++, arg);
        if (m !== "time" && m !== "profile" && m !== "both") fail("--mode takes time, profile or both");
        mode = m;
        break;
      }
      case "--workloads": {
        const path = resolve(value(i++, arg));
        if (!existsSync(path)) fail(`no file ${path}`);
        try {
          workloads = JSON.parse(readFileSync(path, "utf8")) as Options["workloads"];
        } catch (e) {
          fail(`${path}: ${e instanceof Error ? e.message : String(e)}`);
        }
        break;
      }
      case "--set": {
        const text = value(i++, arg);
        const match = /^(?:([^:=]+):)?([A-Za-z_]\w*)=(\d+)$/.exec(text);
        if (match === null) fail(`--set takes [benchmark:]NAME=VALUE, not '${text}'`);
        sets.push({ bench: match[1] ?? null, name: match[2]!, value: Number(match[3]) });
        break;
      }
      case "--out":
        out = resolve(value(i++, arg));
        break;
      case "--timeout":
        timeout = count(value(i++, arg), arg, 1);
        break;
      case "--warmup":
        warmup = count(value(i++, arg), arg);
        break;
      case "--config":
        config = resolve(value(i++, arg));
        if (!existsSync(config)) fail(`no file ${config}`);
        break;
      case "--retry-failed":
        retries = count(value(i++, arg), arg);
        break;
      case "--dry-run":
        dryRun = true;
        break;
      default:
        if (arg.startsWith("-")) fail(`unknown option '${arg}'`);
        benches.push(...resolveBench(arg));
    }
  }
  if (benches.length === 0) fail("name at least one benchmark, or micro, macro or all");
  if (config !== null && benches.length !== 1) fail("--config needs exactly one benchmark");
  const unique = [...new Map(benches.map((b) => [b.dir, b])).values()];
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return {
    benches: unique,
    seeds,
    fractions: fractions ?? Array.from({ length: steps + 1 }, (_, j) => j / steps),
    reps,
    endReps,
    profileReps,
    mode,
    sets,
    workloads,
    out: out ?? join(BENCHMARKS, "results", stamp),
    timeout,
    warmup,
    config,
    retries,
    dryRun,
  };
}

// --- one run ---------------------------------------------------------------

interface RunOutcome {
  readonly output: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly wallMs: number;
}

/** The process group of the run in progress, killed on Ctrl-C. */
let running: number | null = null;

process.on("SIGINT", () => {
  if (running !== null) {
    try {
      process.kill(-running, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  console.error("\ninterrupted; run the same command again to resume");
  process.exit(130);
});

/** `bscript workspace run --stats` in its own process group, killed whole at the timeout. */
function runBscript(cwd: string, endpoints: readonly string[], timeoutS: number): Promise<RunOutcome> {
  return new Promise((done) => {
    const start = performance.now();
    const child = spawn("bscript", ["workspace", "run", "--stats", ...endpoints], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    running = child.pid ?? null;
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        // Already gone.
      }
    }, timeoutS * 1000);
    child.on("close", (code) => {
      clearTimeout(timer);
      running = null;
      done({ output, exitCode: code, timedOut, wallMs: performance.now() - start });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      running = null;
      done({ output: `${output}\n${e.message}`, exitCode: null, timedOut: false, wallMs: performance.now() - start });
    });
  });
}

// --- a benchmark -------------------------------------------------------------

interface Prepared {
  readonly bench: Bench;
  readonly work: string;
  readonly boards: string;
  readonly endpoints: readonly string[];
  readonly source: string;
  readonly workload: Readonly<Record<string, number>>;
}

/** A copy of the benchmark under benchmarks/.work, with its BlueScript workspace made. */
async function prepare(bench: Bench, options: Options): Promise<Prepared> {
  const boards = options.config === null ? "default" : basename(options.config, ".json");
  const work = join(BENCHMARKS, ".work", `${bench.id.replace("/", "-")}${boards === "default" ? "" : `--${boards}`}`);
  const configText = readFileSync(options.config ?? join(bench.dir, "choreobs.json"), "utf8");
  if (existsSync(work) && readFileSync(join(work, "choreobs.json"), "utf8") !== configText) {
    rmSync(work, { recursive: true, force: true });
  }
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, "choreobs.json"), configText);
  rmSync(join(work, "src"), { recursive: true, force: true });
  cpSync(join(bench.dir, "src"), join(work, "src"), { recursive: true });
  const config = loadConfig(join(work, "choreobs.json"));
  for (const endpoint of config.endpoints) {
    await addEndpoint(work, { name: endpoint.name }, systemBscript, async () => {
      throw new Error(`${endpoint.name} has no board in choreobs.json`);
    });
  }
  const source = readFileSync(join(bench.dir, "src", "index.cbs"), "utf8");
  return {
    bench,
    work,
    boards,
    endpoints: config.endpoints.map((e) => e.name),
    source,
    workload: workloadFor(bench, source, options),
  };
}

/**
 * The workload of `bench`: its entry in `--workloads`, then the `--set`
 * values that apply to it. A `--set` that names no benchmark applies to each
 * that has the constant; one that names `bench`, and every entry of the file,
 * must be one of its constants.
 */
function workloadFor(bench: Bench, source: string, options: Options): Record<string, number> {
  const names = new Set(workloadConstants(source).map((c) => c.name));
  const workload: Record<string, number> = {};
  const fromFile = options.workloads[bench.id] ?? options.workloads[basename(bench.dir)] ?? {};
  for (const [name, value] of Object.entries(fromFile)) {
    if (!names.has(name)) fail(`${bench.id} has no workload constant ${name} (--workloads)`);
    workload[name] = value;
  }
  for (const set of options.sets) {
    if (set.bench !== null && set.bench !== bench.id && set.bench !== basename(bench.dir)) continue;
    if (!names.has(set.name)) {
      if (set.bench !== null) fail(`${bench.id} has no workload constant ${set.name}`);
      continue;
    }
    workload[set.name] = set.value;
  }
  return workload;
}

function statusOf(
  outcome: RunOutcome,
  record: Pick<RunRecord, "endpoints">,
  correct: boolean | null,
  profileErrors: readonly string[],
): RunStatus {
  const endpoints = Object.values(record.endpoints);
  if (outcome.timedOut) return "timeout";
  if (endpoints.some((e) => e.memory_exhausted)) return "memory_exhausted";
  if (endpoints.some((e) => e.runtime_error !== null || e.status === "error")) return "runtime_error";
  if (endpoints.some((e) => e.status !== "finished") || profileErrors.length > 0) return "failed";
  if (correct === false) return "incorrect";
  return "ok";
}

async function measure(prepared: Prepared, options: Options, done: Set<string>, records: RunRecord[]): Promise<number> {
  const { bench, work, boards, endpoints, source, workload } = prepared;
  const locations = dynableLocations(source);
  const n = locations.length;
  const configs = configurations(n, options.seeds, options.fractions);
  const set = new Map(Object.entries(workload));

  if (!options.dryRun) {
    mkdirSync(join(options.out, "locations"), { recursive: true });
    const record = {
      bench: bench.id,
      n,
      locations,
      workload: workloadConstants(source),
      seeds: Object.fromEntries(options.seeds.map((seed) => [seed, permutation(n, seed)])),
    };
    writeFileSync(
      join(options.out, "locations", `${bench.id.replace("/", "-")}.json`),
      JSON.stringify(record, null, 1),
    );
  }

  // What the baseline printed, the reference for every other run: from a
  // record already there, else from this sweep's first baseline run.
  const baselineKey = configKey({ bench: bench.id, boards, workload, seed: null, k: 0 });
  let baseline: Record<string, readonly string[]> | null = null;
  const fromRecords = records.find((r) => configKey(r) === baselineKey && r.status === "ok");
  if (fromRecords !== undefined) {
    baseline = Object.fromEntries(Object.entries(fromRecords.endpoints).map(([e, r]) => [e, r.printed]));
  }

  const write = (config: Configuration, mode: RunMode): boolean => {
    const text = configure(source, dynSet(config), set);
    writeFileSync(join(work, "src", "index.cbs"), text);
    const result = writeProject(work, { profile: mode === "profile" });
    if (result.errors.length > 0) {
      throw new CompileFailure(result.errors.map((e) => e.message).join("\n"));
    }
    return true;
  };

  const keyOf = (config: Configuration, rep: number, mode: RunMode): string =>
    runKey({ bench: bench.id, boards, workload, seed: config.seed, k: config.k, rep, mode });
  // A run with a record that is not done failed before, and is tried again.
  const tried = new Set(records.map(runKey));
  const timing = options.mode !== "profile";
  const plan: PlannedRun[] = planRuns(configs, {
    reps: timing ? options.reps : 0,
    endReps: timing ? (options.endReps ?? options.reps) : 0,
    profileReps: options.mode !== "time" ? options.profileReps : 0,
  }).filter(({ config, rep, mode }) => !done.has(keyOf(config, rep, mode)));
  console.log(
    `${bench.id}: ${n} dyn-able locations, ${configs.length} configurations, ${plan.length} runs to do` +
      (Object.keys(workload).length > 0 ? `, ${Object.entries(workload).map(([k, v]) => `${k}=${v}`).join(" ")}` : ""),
  );
  if (options.dryRun) {
    for (const { config, rep, mode } of plan) {
      const again = tried.has(keyOf(config, rep, mode)) ? " (failed before)" : "";
      console.log(`  p=${config.p.toFixed(2)} k=${config.k} seed=${config.seed ?? "-"} rep=${rep} ${mode}${again}`);
    }
    return plan.length;
  }

  for (let i = 0; i < options.warmup && plan.length > 0; i += 1) {
    write(configs[0]!, "time");
    await runBscript(workspaceDir(work), endpoints, options.timeout);
  }

  // Attempts at each run in this session. A run that fails for a reason in
  // RETRYABLE_STATUSES goes to the end of the plan, so that a board has time to
  // come back before the next attempt.
  const attempts = new Map<string, number>();
  for (let index = 1; index <= plan.length; index += 1) {
    const { config, rep, mode } = plan[index - 1]!;
    const key = keyOf(config, rep, mode);
    const attempt = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, attempt);
    const startedAt = new Date().toISOString();
    const base = {
      version: RECORD_VERSION,
      bench: bench.id,
      boards,
      workload,
      seed: config.seed,
      p: config.p,
      k: config.k,
      n,
      rep,
      mode,
      started_at: startedAt,
    };
    let record: RunRecord;
    let rawOutput = "";
    try {
      write(config, mode);
      const outcome = await runBscript(workspaceDir(work), endpoints, options.timeout);
      rawOutput = outcome.output;
      const parsed = parseRun(outcome.output, endpoints, mode === "profile");
      if (!parsed.sawStats && !outcome.timedOut && outcome.exitCode === 0) {
        fail("bscript printed no STATS line: it needs a bscript whose `workspace run` takes --stats");
      }
      const finished = Object.values(parsed.endpoints).every((e) => e.status === "finished");
      const printed = Object.fromEntries(Object.entries(parsed.endpoints).map(([e, r]) => [e, r.printed]));
      if (baseline === null && config.k === 0 && finished && !outcome.timedOut) {
        baseline = printed;
      }
      const comparison = finished && baseline !== null ? compare(baseline, printed) : null;
      const partial = { endpoints: parsed.endpoints };
      record = {
        ...base,
        status: statusOf(outcome, partial, comparison?.correct ?? null, parsed.profileErrors),
        correct: comparison?.correct ?? null,
        extra_lines: comparison?.extraLines ?? 0,
        mismatch: comparison?.mismatch ?? null,
        error: parsed.profileErrors.length > 0 ? parsed.profileErrors.join("; ") : null,
        exit_code: outcome.exitCode,
        wall_ms: outcome.wallMs,
        endpoints: parsed.endpoints,
      };
    } catch (e) {
      if (!(e instanceof CompileFailure)) throw e;
      record = {
        ...base,
        status: "compile_error",
        correct: null,
        extra_lines: 0,
        mismatch: null,
        error: e.message,
        exit_code: null,
        wall_ms: 0,
        endpoints: {},
      };
      rawOutput = e.message;
    }
    appendFileSync(join(options.out, "runs.jsonl"), `${JSON.stringify(record)}\n`);
    records.push(record);
    done.add(runKey(record));
    if (record.status !== "ok") {
      mkdirSync(join(options.out, "failures"), { recursive: true });
      writeFileSync(failureLog(options.out, bench, config, rep, mode), rawOutput);
    }
    const retry = RETRYABLE_STATUSES.has(record.status) && attempt <= options.retries;
    if (retry) plan.push({ config, rep, mode });
    const exec = Math.max(...Object.values(record.endpoints).map((e) => e.exec_ms ?? 0));
    console.log(
      `  [${index}/${plan.length}] p=${config.p.toFixed(2)} k=${config.k} seed=${config.seed ?? "-"} ` +
        `rep=${rep} ${mode.padEnd(7)} ${record.status}${record.status === "ok" ? ` ${exec.toFixed(1)} ms` : ""}` +
        (attempt > 1 ? ` (attempt ${attempt})` : "") +
        (retry ? ", will retry" : ""),
    );
  }
  return plan.length;
}

class CompileFailure extends Error {}

/** Where the output of a failed run goes. Each attempt at a run keeps a file of its own. */
function failureLog(out: string, bench: Bench, config: Configuration, rep: number, mode: RunMode): string {
  const stem = `${bench.id.replace("/", "-")}_seed${config.seed ?? "-"}_k${config.k}_rep${rep}_${mode}`;
  let path = join(out, "failures", `${stem}.log`);
  for (let n = 2; existsSync(path); n += 1) {
    path = join(out, "failures", `${stem}_${n}.log`);
  }
  return path;
}

// --- the session -------------------------------------------------------------

function capture(command: string, args: readonly string[], cwd = REPO_ROOT): string | null {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function writeMeta(options: Options, argv: readonly string[]): void {
  const path = join(options.out, "meta.json");
  const sessions = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as unknown[]) : [];
  const cpu = cpus();
  sessions.push({
    started_at: new Date().toISOString(),
    argv,
    git_commit: capture("git", ["rev-parse", "HEAD"]),
    git_dirty: (capture("git", ["status", "--porcelain"]) ?? "") !== "",
    bscript_version: capture("bscript", ["--version"]),
    node: process.version,
    os: `${osType()} ${release()}`,
    host: hostname(),
    cpu: cpu[0]?.model ?? null,
    cpus: cpu.length,
    memory_bytes: totalmem(),
    profile_format: PROFILE_FORMAT_VERSION,
    profile_counters: PROFILE_COUNTERS.map((c) => c.key),
  });
  writeFileSync(path, `${JSON.stringify(sessions, null, 1)}\n`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const options = parseOptions(argv);
  if (!options.dryRun) {
    if (!systemBscript.available()) fail("bscript, BlueScript's command-line tool, is not on PATH");
    mkdirSync(options.out, { recursive: true });
    writeMeta(options, argv);
  }
  const runsPath = join(options.out, "runs.jsonl");
  const records = existsSync(runsPath) ? parseRecords(readFileSync(runsPath, "utf8")) : [];
  const retried = (r: RunRecord) => options.retries > 0 && RETRYABLE_STATUSES.has(r.status);
  const done = new Set(latestRecords(records).filter((r) => !retried(r)).map(runKey));
  let total = 0;
  for (const bench of options.benches) {
    let prepared: Prepared;
    if (options.dryRun) {
      const source = readFileSync(join(bench.dir, "src", "index.cbs"), "utf8");
      prepared = {
        bench,
        work: "",
        boards: options.config === null ? "default" : basename(options.config, ".json"),
        endpoints: [],
        source,
        workload: workloadFor(bench, source, options),
      };
    } else {
      prepared = await prepare(bench, options);
    }
    total += await measure(prepared, options, done, records);
  }
  if (!options.dryRun) {
    console.log(`${total} runs recorded in ${relative(process.cwd(), runsPath) || runsPath}`);
    console.log(`summarize with: npm run bench:summarize -- ${relative(process.cwd(), options.out) || options.out}`);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});

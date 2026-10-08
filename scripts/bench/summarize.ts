/**
 * Turns the runs `run.ts` recorded into CSV files for the paper's tables and
 * figures (benchmarks/README.md, "Measuring").
 *
 *   npm run bench:summarize -- <results dir…> [--out DIR]
 *
 * It reads `runs.jsonl` from each directory and writes, to `--out` (the first
 * directory by default):
 *
 *   runs.csv     one row per run and endpoint, as recorded
 *   configs.csv  one row per configuration: its time against the baseline's,
 *                and its counters summed over the endpoints
 *   summary.csv  one row per benchmark and fraction, over its configurations
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PROFILE_COUNTERS, type CounterKey } from "../../src/runtime/profile.js";
import { configKey, parseRecords, workloadKey, type RunRecord } from "./records.js";

type Cell = string | number | boolean | null;
type Row = Record<string, Cell>;

const COUNTER_KEYS: readonly CounterKey[] = PROFILE_COUNTERS.map((c) => c.key);

/** The `q` quantile of `xs`, interpolated linearly; null for none. */
export function quantile(xs: readonly number[], q: number): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

const median = (xs: readonly number[]): number | null => quantile(xs, 0.5);

/** A run's time: the longest of its endpoints', since the run lasts as long as its slowest. */
export function runTime(record: RunRecord): number | null {
  const times = Object.values(record.endpoints).map((e) => e.exec_ms);
  return times.length === 0 || times.some((t) => t === null) ? null : Math.max(...(times as number[]));
}

/** An endpoint's CPU time, user and system; null where bscript reports none (records of version 1). */
export function cpuTime(e: RunRecord["endpoints"][string]): number | null {
  const user = e.cpu_user_ms ?? null;
  const sys = e.cpu_sys_ms ?? null;
  return user === null || sys === null ? null : user + sys;
}

/**
 * The share of the run the slowest endpoint spent on its own CPU time: what is left
 * is waiting, for messages and for the other endpoints.
 */
export function busyShare(record: RunRecord): number | null {
  const endpoints = Object.values(record.endpoints);
  if (endpoints.length === 0) return null;
  const slowest = endpoints.reduce((a, b) => ((b.exec_ms ?? 0) > (a.exec_ms ?? 0) ? b : a));
  const cpu = cpuTime(slowest);
  return cpu === null || !slowest.exec_ms ? null : cpu / slowest.exec_ms;
}

/** A run whose numbers count: it finished, and printed what the baseline did as far as is known. */
export function valid(record: RunRecord): boolean {
  return record.status === "ok" && record.correct !== false;
}

/** The counters of a profile run, summed over its endpoints; null if any endpoint has no report. */
export function summedCounters(record: RunRecord): Record<CounterKey, number> | null {
  const reports = Object.values(record.endpoints).map((e) => e.profile);
  if (reports.length === 0 || reports.some((r) => r === null)) return null;
  return Object.fromEntries(
    COUNTER_KEYS.map((key) => [key, reports.reduce((sum, r) => sum + r![key], 0)]),
  ) as Record<CounterKey, number>;
}

/** Whether the counters of a profile run agree with each other (spec §profiling-build). */
export function invariantsHold(record: RunRecord): boolean {
  const endpoints = Object.values(record.endpoints);
  for (const { profile: c } of endpoints) {
    if (c === null) return false;
    if (c.op_arith + c.op_array + c.op_print !== c.op_here + c.op_every + c.op_unbound + c.op_skip) return false;
    if (c.transfer !== c.transfer_none + c.transfer_copy + c.transfer_receive) return false;
  }
  const sum = summedCounters(record)!;
  return sum.receive_n === sum.send_n + sum.broadcast_n * (endpoints.length - 1);
}

const numbers = (xs: readonly (number | null)[]): number[] => xs.filter((x): x is number => x !== null);
const maxOrNull = (xs: readonly (number | null)[]): number | null =>
  xs.length === 0 || xs.some((x) => x === null) ? null : Math.max(...(xs as number[]));
const sumOrNull = (xs: readonly (number | null)[]): number | null =>
  xs.length === 0 || xs.some((x) => x === null) ? null : (xs as number[]).reduce((s, x) => s + x, 0);

function groupBy<T>(xs: readonly T[], key: (x: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    groups.set(k, [...(groups.get(k) ?? []), x]);
  }
  return groups;
}

const benchKey = (r: Pick<RunRecord, "bench" | "boards" | "workload">): string =>
  [r.bench, r.boards, workloadKey(r.workload)].join("|");

/** One row per run and endpoint. */
export function runRows(records: readonly RunRecord[]): Row[] {
  return records.flatMap((r) =>
    Object.entries(r.endpoints).map(([endpoint, e]) => ({
      bench: r.bench,
      group: r.bench.split("/")[0]!,
      boards: r.boards,
      workload: workloadKey(r.workload),
      seed: r.seed,
      p: r.p,
      k: r.k,
      n: r.n,
      fraction: r.n === 0 ? 0 : r.k / r.n,
      rep: r.rep,
      mode: r.mode,
      run_status: r.status,
      correct: r.correct,
      extra_lines: r.extra_lines,
      wall_ms: r.wall_ms,
      started_at: r.started_at,
      endpoint,
      ep_status: e.status,
      exec_ms: e.exec_ms,
      cpu_user_ms: e.cpu_user_ms ?? null,
      cpu_sys_ms: e.cpu_sys_ms ?? null,
      gc_runs: e.gc_runs,
      gc_ms: e.gc_ms,
      alloc_words: e.alloc_words,
      alloc_objects: e.alloc_objects,
      heap_words: e.heap_words,
      printed_lines: e.printed.length,
      ...Object.fromEntries(COUNTER_KEYS.map((key) => [key, e.profile?.[key] ?? null])),
    })),
  );
}

/** One row per configuration. */
export function configRows(records: readonly RunRecord[]): Row[] {
  // The baseline of each benchmark, workload and set of boards: its median time.
  const baselines = new Map<string, number | null>();
  for (const [key, runs] of groupBy(records.filter((r) => r.k === 0 && r.mode === "time" && valid(r)), benchKey)) {
    baselines.set(key, median(runs.map(runTime).filter((t): t is number => t !== null)));
  }
  const rows: Row[] = [];
  for (const runs of groupBy(records, configKey).values()) {
    const first = runs[0]!;
    const timing = runs.filter((r) => r.mode === "time" && valid(r));
    const times = timing.map(runTime).filter((t): t is number => t !== null);
    const profiles = runs.filter((r) => r.mode === "profile" && valid(r));
    const counted = profiles.map(summedCounters).filter((c): c is Record<CounterKey, number> => c !== null);
    const baseline = baselines.get(benchKey(first)) ?? null;
    const execMedian = median(times);
    const profileMedian = median(profiles.map(runTime).filter((t): t is number => t !== null));
    const counter = (key: CounterKey): number | null => median(counted.map((c) => c[key]));
    const sumOf = (keys: readonly CounterKey[]): number | null =>
      counted.length === 0 ? null : median(counted.map((c) => keys.reduce((s, k) => s + c[k], 0)));
    const perEndpointMax = (pick: (e: RunRecord["endpoints"][string]) => number | null): number | null =>
      median(
        profiles.map((r) => Math.max(...Object.values(r.endpoints).map((e) => pick(e) ?? 0))),
      );
    rows.push({
      bench: first.bench,
      group: first.bench.split("/")[0]!,
      boards: first.boards,
      workload: workloadKey(first.workload),
      seed: first.seed,
      p: first.p,
      k: first.k,
      n: first.n,
      fraction: first.n === 0 ? 0 : first.k / first.n,
      runs: runs.length,
      time_runs: timing.length,
      profile_runs: profiles.length,
      runs_incorrect: runs.filter((r) => r.status === "incorrect").length,
      runs_failed: runs.filter((r) => r.status !== "ok" && r.status !== "incorrect").length,
      exec_ms_median: execMedian,
      exec_ms_q1: quantile(times, 0.25),
      exec_ms_q3: quantile(times, 0.75),
      exec_ms_min: times.length === 0 ? null : Math.min(...times),
      baseline_ms: baseline,
      slowdown: execMedian !== null && baseline !== null ? execMedian / baseline : null,
      slowdown_min: times.length > 0 && baseline !== null ? Math.min(...times) / baseline : null,
      cpu_ms_max_endpoint_median: median(numbers(timing.map((r) => maxOrNull(Object.values(r.endpoints).map(cpuTime))))),
      cpu_ms_sum_median: median(numbers(timing.map((r) => sumOrNull(Object.values(r.endpoints).map(cpuTime))))),
      busy_share_median: median(numbers(timing.map(busyShare))),
      gc_ms_median: median(timing.map((r) => Math.max(...Object.values(r.endpoints).map((e) => e.gc_ms ?? 0)))),
      alloc_objects_median: median(
        timing.map((r) => Object.values(r.endpoints).reduce((s, e) => s + (e.alloc_objects ?? 0), 0)),
      ),
      heap_words_max: Math.max(0, ...runs.flatMap((r) => Object.values(r.endpoints).map((e) => e.heap_words ?? 0))),
      profile_exec_ms: profileMedian,
      profile_overhead: profileMedian !== null && execMedian !== null ? profileMedian / execMedian : null,
      invariants_ok: profiles.length === 0 ? null : profiles.every(invariantsHold),
      requests: sumOf(["send_n", "receive_n", "broadcast_n"]),
      requests_max_endpoint: perEndpointMax((e) =>
        e.profile === null ? null : e.profile.send_n + e.profile.receive_n + e.profile.broadcast_n,
      ),
      comm_ms_max_endpoint: perEndpointMax((e) =>
        e.profile === null ? null : e.profile.send_ms + e.profile.receive_ms + e.profile.broadcast_ms,
      ),
      ops_total: sumOf(["op_arith", "op_array", "op_print"]),
      ops_replicated: sumOf(["op_every", "op_unbound"]),
      ...Object.fromEntries(COUNTER_KEYS.map((key) => [key, counter(key)])),
    });
  }
  return rows.sort(
    (a, b) =>
      String(a.bench).localeCompare(String(b.bench)) ||
      String(a.boards).localeCompare(String(b.boards)) ||
      String(a.workload).localeCompare(String(b.workload)) ||
      (a.k as number) - (b.k as number) ||
      ((a.seed as number | null) ?? 0) - ((b.seed as number | null) ?? 0),
  );
}

/** One row per benchmark and fraction, over its configurations. */
export function summaryRows(configs: readonly Row[]): Row[] {
  const rows: Row[] = [];
  const groups = groupBy(configs, (c) => [c.bench, c.boards, c.workload, c.p].join("|"));
  for (const group of groups.values()) {
    const first = group[0]!;
    const slowdowns = group.map((c) => c.slowdown).filter((s): s is number => typeof s === "number");
    const share = (limit: number): number | null =>
      slowdowns.length === 0 ? null : slowdowns.filter((s) => s <= limit).length / slowdowns.length;
    const med = (key: string): number | null =>
      median(group.map((c) => c[key]).filter((v): v is number => typeof v === "number"));
    rows.push({
      bench: first.bench,
      group: first.group,
      boards: first.boards,
      workload: first.workload,
      p: first.p,
      k: first.k,
      n: first.n,
      configs: group.length,
      configs_valid: slowdowns.length,
      configs_incorrect: group.filter((c) => (c.runs_incorrect as number) > 0).length,
      configs_failed: group.filter((c) => (c.runs_failed as number) > 0).length,
      slowdown_median: median(slowdowns),
      slowdown_q1: quantile(slowdowns, 0.25),
      slowdown_q3: quantile(slowdowns, 0.75),
      slowdown_min: slowdowns.length === 0 ? null : Math.min(...slowdowns),
      slowdown_max: slowdowns.length === 0 ? null : Math.max(...slowdowns),
      share_within_1_1x: share(1.1),
      share_within_2x: share(2),
      exec_ms_median: med("exec_ms_median"),
      baseline_ms: first.baseline_ms,
      profile_overhead_median: med("profile_overhead"),
      cpu_ms_max_endpoint_median: med("cpu_ms_max_endpoint_median"),
      cpu_ms_sum_median: med("cpu_ms_sum_median"),
      busy_share_median: med("busy_share_median"),
      invariants_ok: group.every((c) => c.invariants_ok !== false),
      med_requests: med("requests"),
      med_ops_total: med("ops_total"),
      med_ops_replicated: med("ops_replicated"),
      ...Object.fromEntries(COUNTER_KEYS.map((key) => [`med_${key}`, med(key)])),
    });
  }
  return rows;
}

function cell(value: Cell): string {
  if (value === null) return "";
  const text = typeof value === "number" ? (Number.isInteger(value) ? String(value) : value.toPrecision(6)) : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** `rows` as CSV, their columns in the order the first row has them. */
export function toCsv(rows: readonly Row[]): string {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]!);
  return [columns.join(","), ...rows.map((row) => columns.map((c) => cell(row[c] ?? null)).join(","))].join("\n") + "\n";
}

function main(): void {
  const argv = process.argv.slice(2);
  const dirs: string[] = [];
  let out: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") {
      out = resolve(argv[++i] ?? "");
    } else if (argv[i]!.startsWith("-")) {
      console.error(`error: unknown option '${argv[i]}'`);
      process.exit(2);
    } else {
      dirs.push(resolve(argv[i]!));
    }
  }
  if (dirs.length === 0) {
    console.error("usage: npm run bench:summarize -- <results dir…> [--out DIR]");
    process.exit(2);
  }
  const records = dirs.flatMap((dir) => {
    const path = join(dir, "runs.jsonl");
    if (!existsSync(path)) {
      console.error(`error: no ${path}`);
      process.exit(2);
    }
    return parseRecords(readFileSync(path, "utf8"));
  });
  const target = out ?? dirs[0]!;
  const configs = configRows(records);
  const summary = summaryRows(configs);
  writeFileSync(join(target, "runs.csv"), toCsv(runRows(records)));
  writeFileSync(join(target, "configs.csv"), toCsv(configs));
  writeFileSync(join(target, "summary.csv"), toCsv(summary));
  const bad = records.filter((r) => r.status !== "ok").length;
  console.log(
    `${records.length} runs, ${configs.length} configurations, ${summary.length} summary rows` +
      (bad > 0 ? `; ${bad} runs did not end ok (see failures/)` : ""),
  );
  console.log(`wrote runs.csv, configs.csv and summary.csv to ${target}`);
}

if (import.meta.filename === resolve(process.argv[1] ?? "")) {
  main();
}

/**
 * What `run.ts` records of one run, one JSON object per line of `runs.jsonl`,
 * and what `summarize.ts` reads back.
 */
import type { CounterKey } from "../../src/runtime/profile.js";

/** 2 added the CPU times of the endpoints: `cpu_user_ms` and `cpu_sys_ms`. */
export const RECORD_VERSION = 2;

/** A timing run is an ordinary build; a profile run is a profiling build (spec §profiling-build). */
export type RunMode = "time" | "profile";

/**
 * How a run went, worst first: `compile_error` and `timeout` before the
 * program's own failures, then a run that finished with output other than the
 * baseline's (`incorrect`), then `ok`.
 */
export type RunStatus =
  | "compile_error"
  | "timeout"
  | "memory_exhausted"
  | "runtime_error"
  | "failed"
  | "incorrect"
  | "ok";

/** What one endpoint did in a run. Every number is null where bscript reports none. */
export interface EndpointRecord {
  /** The status bscript gives it: `finished`, `error`, `failed`, `disconnected` or `stopped`. */
  readonly status: string | null;
  readonly exec_ms: number | null;
  /** CPU time over `exec_ms`; waiting for a message uses none. Absent from records of version 1. */
  readonly cpu_user_ms?: number | null;
  readonly cpu_sys_ms?: number | null;
  readonly gc_runs: number | null;
  readonly gc_ms: number | null;
  readonly alloc_words: number | null;
  readonly alloc_objects: number | null;
  readonly heap_words: number | null;
  /** What it printed, the profile report left out. */
  readonly printed: readonly string[];
  /** The counters of its report, in a profile run. */
  readonly profile: Readonly<Record<CounterKey, number>> | null;
  readonly runtime_error: string | null;
  readonly memory_exhausted: boolean;
}

export interface RunRecord {
  readonly version: number;
  /** The benchmark, as `<group>/<name>`. */
  readonly bench: string;
  /** Which `choreobs.json`: `default`, or the name of the file `--config` gave. */
  readonly boards: string;
  /** The workload constants changed with `--set`, by name. */
  readonly workload: Readonly<Record<string, number>>;
  readonly seed: number | null;
  /** The fraction asked for, and what it came to: `k` of the `n` dyn-able locations are `dyn`. */
  readonly p: number;
  readonly k: number;
  readonly n: number;
  readonly rep: number;
  readonly mode: RunMode;
  readonly status: RunStatus;
  /** Whether it printed what the baseline did; null when there was no baseline to compare with, or it did not finish. */
  readonly correct: boolean | null;
  /** Lines it printed beyond the baseline's, each one another endpoint printed there. */
  readonly extra_lines: number;
  readonly mismatch: string | null;
  readonly error: string | null;
  readonly exit_code: number | null;
  readonly wall_ms: number;
  readonly started_at: string;
  readonly endpoints: Readonly<Record<string, EndpointRecord>>;
}

/** The workload overrides as one stable string, e.g. `ACCOUNTS=128;TXNS=3000`. */
export function workloadKey(workload: Readonly<Record<string, number>>): string {
  return Object.keys(workload)
    .sort()
    .map((name) => `${name}=${workload[name]}`)
    .join(";");
}

/** What a run is a repetition of: everything but `rep` and `mode`. */
export function configKey(r: Pick<RunRecord, "bench" | "boards" | "workload" | "seed" | "k">): string {
  return [r.bench, r.boards, workloadKey(r.workload), r.seed ?? "-", r.k].join("|");
}

/** What makes a run unique, so that a sweep can resume without running it twice. */
export function runKey(r: Pick<RunRecord, "bench" | "boards" | "workload" | "seed" | "k" | "rep" | "mode">): string {
  return [configKey(r), r.rep, r.mode].join("|");
}

/**
 * The statuses the testbed can cause as well as the program: a board that did
 * not connect or report in full (`failed`), a link that dropped and left the
 * other endpoints waiting (`runtime_error`), a run that hung (`timeout`).
 * `--retry-failed` runs them again.
 */
export const RETRYABLE_STATUSES: ReadonlySet<RunStatus> = new Set(["failed", "runtime_error", "timeout"]);

/** The last record of each run (by {@link runKey}): a retried run is what its last attempt says. */
export function latestRecords(records: readonly RunRecord[]): RunRecord[] {
  return [...new Map(records.map((r) => [runKey(r), r])).values()];
}

/** The records of a `runs.jsonl`. A line cut short by an interrupted run is skipped. */
export function parseRecords(text: string): RunRecord[] {
  const records: RunRecord[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      records.push(JSON.parse(line) as RunRecord);
    } catch {
      // The last line of an interrupted run.
    }
  }
  return records;
}

/**
 * Reading what `bscript workspace run --stats` prints, and checking it against
 * the baseline. Pure functions, so that the tests can feed them text.
 *
 * bscript prefixes each line an endpoint prints with `[name] `, the name
 * padded to the longest; it prints `STATS <name> key=value…` as each endpoint
 * ends, when its output is not a terminal; and a runtime error or an
 * exhausted heap appears as the endpoint's own line. A profiling build ends
 * each endpoint's output with its report (spec §profiling-build).
 */
import {
  PROFILE_COUNTERS,
  PROFILE_FORMAT_VERSION,
  PROFILE_MARKER,
  type CounterKey,
} from "../../src/runtime/profile.js";
import type { EndpointRecord } from "./records.js";

const ANSI = /\x1b\[[0-9;]*m/g;
const PREFIXED = /^\[([^\]\s]+) *\] ?(.*)$/;
const STATS = /^STATS (\S+) (.*)$/;
const STATS_FIELDS = [
  "exec_ms", "cpu_user_ms", "cpu_sys_ms", "gc_runs", "gc_ms", "alloc_words", "alloc_objects", "heap_words",
] as const;

export interface ParsedRun {
  readonly endpoints: Record<string, EndpointRecord>;
  /** Whether any STATS line was printed at all. */
  readonly sawStats: boolean;
  /** What went wrong reading an endpoint's profile report, if anything. */
  readonly profileErrors: readonly string[];
}

/** A value as `print` shows it, without the quotes host puts around a string. */
export function unquote(value: string): string {
  return value.length >= 2 && value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1) : value;
}

/** Everything bscript printed for `endpoints`, stdout and stderr together. */
export function parseRun(output: string, endpoints: readonly string[], profile: boolean): ParsedRun {
  const lines = new Map<string, string[]>(endpoints.map((e) => [e, []]));
  const stats = new Map<string, Record<string, string>>();
  const runtimeErrors = new Map<string, string>();
  const exhausted = new Set<string>();
  let sawStats = false;

  for (const raw of output.replace(ANSI, "").split("\n")) {
    const line = raw.replace(/\r$/, "");
    const stat = STATS.exec(line);
    if (stat !== null) {
      sawStats = true;
      stats.set(stat[1]!, keyValues(stat[2]!));
      continue;
    }
    const prefixed = PREFIXED.exec(line);
    if (prefixed === null || !lines.has(prefixed[1]!)) {
      continue;
    }
    const [, endpoint, text] = prefixed as unknown as [string, string, string];
    if (text.includes("** memory exhausted **")) {
      exhausted.add(endpoint);
      continue;
    }
    if (text.startsWith("** runtime error")) {
      runtimeErrors.set(endpoint, text.replace(/^\*\* runtime error:? ?/, ""));
      continue;
    }
    lines.get(endpoint)!.push(text);
  }

  const profileErrors: string[] = [];
  const result: Record<string, EndpointRecord> = {};
  for (const endpoint of endpoints) {
    const printed = lines.get(endpoint)!;
    let profileValues: Record<CounterKey, number> | null = null;
    let output = printed;
    if (profile) {
      const at = printed.findIndex((l) => unquote(l) === PROFILE_MARKER);
      if (at < 0) {
        profileErrors.push(`${endpoint}: no profile report`);
      } else {
        output = printed.slice(0, at);
        const report = readReport(printed.slice(at + 1));
        if (typeof report === "string") {
          profileErrors.push(`${endpoint}: ${report}`);
        } else {
          profileValues = report;
        }
      }
    }
    const fields = stats.get(endpoint);
    const number = (key: string): number | null => {
      const v = fields?.[key];
      return v === undefined || v === "NA" ? null : Number(v);
    };
    result[endpoint] = {
      status: fields?.status ?? null,
      ...(Object.fromEntries(STATS_FIELDS.map((key) => [key, number(key)])) as Record<
        (typeof STATS_FIELDS)[number],
        number | null
      >),
      printed: output,
      profile: profileValues,
      runtime_error: runtimeErrors.get(endpoint) ?? null,
      memory_exhausted: exhausted.has(endpoint),
    };
  }
  return { endpoints: result, sawStats, profileErrors };
}

/** `key=value` pairs separated by spaces. */
function keyValues(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const pair of text.split(" ")) {
    const eq = pair.indexOf("=");
    if (eq > 0) fields[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return fields;
}

/** The counters after the marker: the version, the count, then the values. */
function readReport(lines: readonly string[]): Record<CounterKey, number> | string {
  if (Number(lines[0]) !== PROFILE_FORMAT_VERSION) {
    return `profile format ${lines[0]}, expected ${PROFILE_FORMAT_VERSION}`;
  }
  if (Number(lines[1]) !== PROFILE_COUNTERS.length) {
    return `profile of ${lines[1]} counters, expected ${PROFILE_COUNTERS.length}`;
  }
  const values = lines.slice(2, 2 + PROFILE_COUNTERS.length).map(Number);
  if (values.length < PROFILE_COUNTERS.length || values.some((v) => !Number.isFinite(v))) {
    return "profile report cut short";
  }
  return Object.fromEntries(PROFILE_COUNTERS.map(({ key }, i) => [key, values[i]!])) as Record<CounterKey, number>;
}

/** Whether two printed values are the same: integers, booleans and strings exactly, floats within a relative 1e-3. */
export function sameValue(a: string, b: string): boolean {
  if (a === b) return true;
  const float = /^-?\d+\.\d+$/;
  if (float.test(a) && float.test(b)) {
    const x = Number(a);
    const y = Number(b);
    return Math.abs(x - y) <= 1e-3 * Math.max(Math.abs(x), Math.abs(y)) + 1e-6;
  }
  return false;
}

export interface Comparison {
  readonly correct: boolean;
  readonly extraLines: number;
  readonly mismatch: string | null;
}

/**
 * Whether a run printed what the baseline printed (benchmarks/README.md).
 * Only the endpoints that print in the baseline are compared. A value whose
 * `dyn` location is never bound is printed at every endpoint (spec §dyn-print),
 * so an endpoint may print more than in the baseline: that is accepted when
 * the baseline's lines come in order among its own, and each extra line is
 * one some other endpoint printed in the baseline.
 */
export function compare(
  baseline: Readonly<Record<string, readonly string[]>>,
  run: Readonly<Record<string, readonly string[]>>,
): Comparison {
  let extraLines = 0;
  const everyLine = Object.values(baseline).flat();
  for (const [endpoint, expected] of Object.entries(baseline)) {
    if (expected.length === 0) continue;
    const actual = run[endpoint] ?? [];
    if (actual.length === expected.length && actual.every((line, i) => sameValue(line, expected[i]!))) {
      continue;
    }
    let j = 0;
    let extra = 0;
    for (const line of actual) {
      if (j < expected.length && sameValue(line, expected[j]!)) {
        j += 1;
      } else if (everyLine.some((other) => sameValue(line, other))) {
        extra += 1;
      } else {
        return { correct: false, extraLines, mismatch: `${endpoint} printed ${line}, expected ${expected[j] ?? "nothing more"}` };
      }
    }
    if (j < expected.length) {
      return { correct: false, extraLines, mismatch: `${endpoint} did not print ${expected[j]}` };
    }
    extraLines += extra;
  }
  return { correct: true, extraLines, mismatch: null };
}

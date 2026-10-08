import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PROFILE_COUNTERS, type CounterKey } from "../../src/runtime/profile.js";
import type { EndpointRecord, RunRecord } from "../../scripts/bench/records.js";
import { parseRecords, runKey } from "../../scripts/bench/records.js";
import {
  busyShare,
  configRows,
  invariantsHold,
  quantile,
  summaryRows,
  toCsv,
} from "../../scripts/bench/summarize.js";

function counters(values: Partial<Record<CounterKey, number>> = {}): Record<CounterKey, number> {
  return { ...Object.fromEntries(PROFILE_COUNTERS.map(({ key }) => [key, 0])), ...values } as Record<CounterKey, number>;
}

function endpoint(exec: number, profile: Record<CounterKey, number> | null = null): EndpointRecord {
  return {
    status: "finished",
    exec_ms: exec,
    gc_runs: 1,
    gc_ms: 0.01,
    alloc_words: 10,
    alloc_objects: 5,
    heap_words: 8194,
    printed: [],
    profile,
    runtime_error: null,
    memory_exhausted: false,
  };
}

function record(fields: Partial<RunRecord> & Pick<RunRecord, "k" | "rep">): RunRecord {
  return {
    version: 1,
    bench: "macro/x",
    boards: "default",
    workload: {},
    seed: fields.k === 0 || fields.k === 10 ? null : 1,
    p: fields.k / 10,
    n: 10,
    mode: "time",
    status: "ok",
    correct: true,
    extra_lines: 0,
    mismatch: null,
    error: null,
    exit_code: 0,
    wall_ms: 1000,
    started_at: "2026-10-08T00:00:00Z",
    endpoints: { alice: endpoint(100), bob: endpoint(90) },
    ...fields,
  };
}

describe("summarizing runs (scripts/bench/summarize.ts)", () => {
  it("interpolates quantiles", () => {
    assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
    assert.equal(quantile([5], 0.25), 5);
    assert.equal(quantile([], 0.5), null);
  });

  it("divides each configuration's median time by the baseline's, a run lasting as long as its slowest endpoint", () => {
    const records = [
      record({ k: 0, rep: 0 }),
      record({ k: 0, rep: 1, endpoints: { alice: endpoint(110), bob: endpoint(10) } }),
      record({ k: 5, rep: 0, endpoints: { alice: endpoint(210), bob: endpoint(1) } }),
      record({ k: 5, rep: 1, endpoints: { alice: endpoint(200), bob: endpoint(1) } }),
      record({ k: 5, rep: 2, status: "runtime_error", endpoints: { alice: endpoint(5), bob: endpoint(5) } }),
      record({ k: 10, rep: 0, correct: false, status: "incorrect" }),
    ];
    const configs = configRows(records);
    const base = configs.find((c) => c.k === 0)!;
    const half = configs.find((c) => c.k === 5)!;
    const all = configs.find((c) => c.k === 10)!;
    assert.equal(base.baseline_ms, 105);
    assert.equal(base.slowdown, 1);
    assert.equal(half.exec_ms_median, 205);
    assert.equal(half.slowdown, 205 / 105);
    assert.equal(half.runs_failed, 1);
    assert.equal(all.slowdown, null);
    assert.equal(all.runs_incorrect, 1);

    const summary = summaryRows(configs);
    const s = summary.find((r) => r.k === 5)!;
    assert.equal(s.configs, 1);
    assert.equal(s.share_within_1_1x, 0);
    assert.equal(s.share_within_2x, 1);
    assert.equal(summary.find((r) => r.k === 10)!.configs_incorrect, 1);
  });

  it("sums the counters of a profile run over its endpoints, and checks they agree", () => {
    const alice = counters({ send_n: 3, broadcast_n: 1, receive_n: 1, op_arith: 2, op_here: 1, op_skip: 1, transfer: 1, transfer_copy: 1 });
    // Over both endpoints, receives are the sends plus each broadcast once per other endpoint.
    const bob = counters({ receive_n: 3, op_arith: 2, op_unbound: 2 });
    const run = record({ k: 5, rep: 0, mode: "profile", endpoints: { alice: endpoint(1, alice), bob: endpoint(1, bob) } });
    assert.equal(invariantsHold(run), true);
    const row = configRows([run])[0]!;
    assert.equal(row.requests, 8);
    assert.equal(row.ops_total, 4);
    assert.equal(row.ops_replicated, 2);
    assert.equal(row.invariants_ok, true);
    const broken = record({ ...run, endpoints: { alice: endpoint(1, { ...alice, op_here: 0 }), bob: endpoint(1, bob) } });
    assert.equal(invariantsHold(broken), false);
  });

  it("takes the CPU time of the endpoints, and reads records without it as missing", () => {
    const withCpu = (exec: number, user: number, sys: number): EndpointRecord =>
      ({ ...endpoint(exec), cpu_user_ms: user, cpu_sys_ms: sys });
    const run = record({
      k: 0,
      rep: 0,
      endpoints: { alice: withCpu(100, 10, 5), bob: withCpu(90, 30, 10) },
    });
    assert.equal(busyShare(run), 0.15);
    const row = configRows([run])[0]!;
    assert.equal(row.cpu_ms_max_endpoint_median, 40);
    assert.equal(row.cpu_ms_sum_median, 55);
    assert.equal(row.busy_share_median, 0.15);
    const old = configRows([record({ k: 0, rep: 0 })])[0]!;
    assert.equal(old.cpu_ms_max_endpoint_median, null);
  });

  it("writes CSV with quoting", () => {
    assert.equal(toCsv([{ a: 1, b: "x,y", c: null, d: 0.5 }]), 'a,b,c,d\n1,"x,y",,0.500000\n');
  });

  it("reads records, skipping a line cut short, and keys a run by what makes it unique", () => {
    const one = record({ k: 0, rep: 0 });
    const records = parseRecords(`${JSON.stringify(one)}\n{"version": 1, "be`);
    assert.equal(records.length, 1);
    assert.equal(runKey(one), "macro/x|default||-|0|0|time");
  });
});

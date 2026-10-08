import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compare, parseRun, sameValue, unquote } from "../../scripts/bench/output.js";
import { PROFILE_COUNTERS } from "../../src/runtime/profile.js";

const STATS_ALICE = "STATS alice status=finished exec_ms=12.500 gc_runs=1 gc_ms=0.010 alloc_words=10 alloc_objects=3 heap_words=8194";
const STATS_BOB = "STATS bob   status=finished exec_ms=NA gc_runs=NA gc_ms=NA alloc_words=NA alloc_objects=NA heap_words=NA";

/** The lines of a profile report with counters 1, 2, 3, …, as host prints it. */
function report(prefix: string, quoted = true): string[] {
  return [
    `${prefix}${quoted ? "'__choreobs_profile'" : "__choreobs_profile"}`,
    `${prefix}1`,
    `${prefix}${PROFILE_COUNTERS.length}`,
    ...PROFILE_COUNTERS.map((_, i) => `${prefix}${i + 1}${i === 1 ? ".500000" : ""}`),
  ];
}

describe("reading bscript's output (scripts/bench/output.ts)", () => {
  it("reads padded prefixes, STATS lines and NA", () => {
    const output = [
      "INFO: Start executing programs.",
      "[alice] 42",
      "[bob  ] true",
      "[alice] 'done'",
      STATS_ALICE,
      STATS_BOB.replace("bob   ", "bob "),
    ].join("\n");
    const run = parseRun(output, ["alice", "bob"], false);
    assert.equal(run.sawStats, true);
    assert.deepEqual(run.endpoints.alice!.printed, ["42", "'done'"]);
    assert.deepEqual(run.endpoints.bob!.printed, ["true"]);
    assert.equal(run.endpoints.alice!.exec_ms, 12.5);
    assert.equal(run.endpoints.alice!.status, "finished");
    assert.equal(run.endpoints.bob!.exec_ms, null);
    assert.equal(run.endpoints.alice!.profile, null);
  });

  it("reads the CPU times of the endpoints", () => {
    const output = [
      "[alice] 1",
      "STATS alice status=finished exec_ms=69.154 cpu_user_ms=5.251 cpu_sys_ms=6.434 gc_runs=1 gc_ms=0.014 alloc_words=13086 alloc_objects=3538 heap_words=8194",
      "STATS bob status=finished exec_ms=68.672 cpu_user_ms=NA cpu_sys_ms=NA gc_runs=1 gc_ms=0.013 alloc_words=13312 alloc_objects=3108 heap_words=8194",
    ].join("\n");
    const run = parseRun(output, ["alice", "bob"], false);
    assert.equal(run.endpoints.alice!.cpu_user_ms, 5.251);
    assert.equal(run.endpoints.alice!.cpu_sys_ms, 6.434);
    assert.equal(run.endpoints.bob!.cpu_user_ms, null);
  });

  it("reads the output of a bscript that reports no CPU time", () => {
    const run = parseRun(["[alice] 1", STATS_ALICE].join("\n"), ["alice"], false);
    assert.equal(run.endpoints.alice!.exec_ms, 12.5);
    assert.equal(run.endpoints.alice!.cpu_user_ms, null);
  });

  it("takes the profile report out of what was printed, quoted or not", () => {
    for (const quoted of [true, false]) {
      const output = ["[alice] 7", ...report("[alice] ", quoted), "[bob  ] 8", ...report("[bob  ] ", quoted), STATS_ALICE].join("\n");
      const run = parseRun(output, ["alice", "bob"], true);
      assert.deepEqual(run.profileErrors, []);
      assert.deepEqual(run.endpoints.alice!.printed, ["7"]);
      assert.equal(run.endpoints.bob!.profile!.send_n, 1);
      assert.equal(run.endpoints.bob!.profile!.send_ms, 2.5);
      assert.equal(run.endpoints.bob!.profile!.op_skip, PROFILE_COUNTERS.length);
    }
  });

  it("reports a missing or cut-short profile report", () => {
    const output = ["[alice] 7", ...report("[alice] ").slice(0, 10)].join("\n");
    const run = parseRun(output, ["alice", "bob"], true);
    assert.deepEqual(run.profileErrors, ["alice: profile report cut short", "bob: no profile report"]);
  });

  it("notices a runtime error and an exhausted heap", () => {
    const output = [
      "[alice] 1",
      "[alice] ** runtime error: location error: alice and bob",
      "[bob  ] ** memory exhausted **",
      "ERROR: [alice] Ended with a runtime error.",
    ].join("\n");
    const run = parseRun(output, ["alice", "bob"], false);
    assert.equal(run.endpoints.alice!.runtime_error, "location error: alice and bob");
    assert.deepEqual(run.endpoints.alice!.printed, ["1"]);
    assert.equal(run.endpoints.bob!.memory_exhausted, true);
    assert.equal(run.sawStats, false);
  });

  it("compares integers and booleans exactly, floats within 1e-3", () => {
    assert.ok(sameValue("7126.211914", "7126.246582"));
    assert.ok(!sameValue("7126.211914", "7140.000000"));
    assert.ok(!sameValue("41", "42"));
    assert.ok(!sameValue("true", "false"));
    assert.equal(unquote("'x'"), "x");
  });

  it("checks only the endpoints that print in the baseline", () => {
    const baseline = { alice: ["1", "2"], bob: [] };
    assert.deepEqual(compare(baseline, { alice: ["1", "2"], bob: ["9"] }), { correct: true, extraLines: 0, mismatch: null });
    assert.equal(compare(baseline, { alice: ["1", "3"], bob: [] }).correct, false);
    assert.equal(compare(baseline, { alice: ["1"], bob: [] }).correct, false);
  });

  it("accepts a line another endpoint printed in the baseline, as an unbound dyn value prints everywhere", () => {
    const baseline = { alice: ["793760"], bob: ["470562"] };
    const run = { alice: ["793760", "470562"], bob: ["793760", "470562"] };
    assert.deepEqual(compare(baseline, run), { correct: true, extraLines: 2, mismatch: null });
    assert.equal(compare(baseline, { alice: ["793760", "5"], bob: ["470562"] }).correct, false);
  });
});

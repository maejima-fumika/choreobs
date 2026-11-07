import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { configurations, permutation, type Configuration } from "../../scripts/bench/config.js";
import { isEnd, planRuns, type PlannedRun } from "../../scripts/bench/plan.js";

// 0%, two seeds at 50% and 100%: four configurations, two of them ends.
const CONFIGS = configurations(10, [1, 2], [0, 0.5, 1]);

const name = (r: PlannedRun) => `${r.config.k}/${r.config.seed ?? "-"}/${r.rep}/${r.mode}`;
const timing = (plan: readonly PlannedRun[], config: Configuration) =>
  plan.filter((r) => r.config === config && r.mode === "time").map((r) => r.rep);

/** The plan of run.ts before --end-reps: every configuration the same number of timing runs. */
function before(configs: readonly Configuration[], reps: number, profileReps: number): PlannedRun[] {
  const plan: PlannedRun[] = [];
  for (let rep = 0; rep < Math.max(reps, profileReps); rep += 1) {
    const rest = configs.filter((c) => c.k !== 0);
    const order = [...configs.filter((c) => c.k === 0), ...permutation(rest.length, 1000 + rep).map((i) => rest[i]!)];
    for (const config of order) {
      if (rep < reps) plan.push({ config, rep, mode: "time" });
      if (rep < profileReps) plan.push({ config, rep, mode: "profile" });
    }
  }
  return plan;
}

describe("the order of a sweep (scripts/bench/plan.ts)", () => {
  it("knows the ends: 0% and 100%, the configurations without a seed", () => {
    assert.deepEqual(CONFIGS.filter(isEnd).map((c) => c.k), [0, 10]);
  });

  it("plans as before when the ends take as many timing runs as the rest", () => {
    for (const [reps, profileReps] of [[3, 1], [2, 3], [1, 0], [0, 2], [5, 1]] as const) {
      assert.deepEqual(
        planRuns(CONFIGS, { reps, endReps: reps, profileReps }).map(name),
        before(CONFIGS, reps, profileReps).map(name),
      );
    }
  });

  it("gives the ends more timing runs, and the rest no more", () => {
    const plan = planRuns(CONFIGS, { reps: 3, endReps: 5, profileReps: 1 });
    for (const config of CONFIGS) {
      assert.deepEqual(timing(plan, config).sort(), isEnd(config) ? [0, 1, 2, 3, 4] : [0, 1, 2]);
      assert.deepEqual(plan.filter((r) => r.config === config && r.mode === "profile").map((r) => r.rep), [0]);
    }
    assert.equal(new Set(plan.map(name)).size, plan.length, "no run twice");
    // A configuration's timing run and profile run stay next to each other.
    for (const [i, r] of plan.entries()) {
      if (r.mode === "profile") assert.deepEqual(plan[i - 1], { config: r.config, rep: r.rep, mode: "time" });
    }
  });

  it("puts the extra runs of the ends inside the blocks, not after them", () => {
    const plan = planRuns(CONFIGS, { reps: 3, endReps: 5, profileReps: 0 });
    const at = (k: number, rep: number) => plan.findIndex((r) => r.config.k === k && r.rep === rep);
    // The baseline still opens each block.
    for (let rep = 0; rep < 3; rep += 1) assert.equal(plan.filter((r) => r.rep === rep)[0]!.config.k, 0);
    // Extra 3 falls inside block 0, extra 4 inside block 1, both away from the next block's baseline.
    assert.ok(at(0, 0) < at(0, 3) && at(0, 3) < at(0, 1) - 1);
    assert.ok(at(0, 1) < at(0, 4) && at(0, 4) < at(0, 2) - 1);
    // 0% and 100% run their extra runs next to each other.
    assert.equal(at(10, 3), at(0, 3) + 1);
    assert.notEqual(plan.at(-1)!.rep, 4);
  });

  it("spreads more extra runs than blocks over the blocks", () => {
    const plan = planRuns(CONFIGS, { reps: 2, endReps: 7, profileReps: 0 });
    const end = CONFIGS[0]!;
    assert.deepEqual(timing(plan, end).sort(), [0, 1, 2, 3, 4, 5, 6]);
    // Five extra runs over two blocks: three in the first, two in the second.
    const blockOf = (i: number) => plan.slice(0, i + 1).filter((r) => r.config === end && r.rep < 2).length - 1;
    const extras = plan.map((r, i) => (r.config === end && r.rep >= 2 ? blockOf(i) : null)).filter((b) => b !== null);
    assert.deepEqual(extras, [0, 0, 0, 1, 1]);
  });

  it("can give the ends fewer timing runs, or only them", () => {
    const fewer = planRuns(CONFIGS, { reps: 3, endReps: 1, profileReps: 0 });
    for (const config of CONFIGS) assert.deepEqual(timing(fewer, config), isEnd(config) ? [0] : [0, 1, 2]);
    const only = planRuns(CONFIGS, { reps: 0, endReps: 2, profileReps: 0 });
    assert.deepEqual(only.map(name), ["0/-/0/time", "10/-/0/time", "0/-/1/time", "10/-/1/time"]);
  });
});

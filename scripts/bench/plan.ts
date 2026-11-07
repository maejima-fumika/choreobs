/**
 * The order in which a sweep runs its configurations (benchmarks/README.md,
 * "How it measures").
 *
 * A sweep is a sequence of blocks, one per repetition. Each block runs the
 * baseline first and then every other configuration in an order shuffled for
 * that block, so that a drift of the machine's speed spreads over all
 * configurations instead of falling on some. A configuration has its timing
 * run and, in the first blocks, its profile run next to each other.
 *
 * The two ends, no location `dyn` and all of them (the configurations without
 * a seed), may take more timing runs than the rest (`--end-reps`): every
 * configuration is measured against the baseline. Their extra runs go into the
 * middle of the blocks, spread evenly, rather than into blocks of their own at
 * the end, where a drift would fall on them alone.
 */
import { permutation, type Configuration } from "./config.js";
import type { RunMode } from "./records.js";

/** How many runs of each kind a configuration takes; 0 for a kind the sweep leaves out. */
export interface Repetitions {
  /** Timing runs of a configuration with a seed. */
  readonly reps: number;
  /** Timing runs of an end: 0% or 100%. */
  readonly endReps: number;
  /** Profile runs of every configuration. */
  readonly profileReps: number;
}

export interface PlannedRun {
  readonly config: Configuration;
  /** Which repetition of the configuration in this mode: with the rest of the key, it names the run. */
  readonly rep: number;
  readonly mode: RunMode;
}

/** Whether `config` is an end, the same program for every seed. */
export function isEnd(config: Configuration): boolean {
  return config.seed === null;
}

/** Every run of a sweep over `configs`, in the order it makes them. */
export function planRuns(configs: readonly Configuration[], r: Repetitions): PlannedRun[] {
  // The timing runs of the ends that fit in the blocks' own slots, and the rest.
  const shared = Math.min(r.reps, r.endReps);
  const extras = r.endReps - shared;
  const blocks = Math.max(r.reps, r.profileReps, extras > 0 ? 1 : 0);
  const ends = configs.filter(isEnd);

  const plan: PlannedRun[] = [];
  for (let block = 0; block < blocks; block += 1) {
    // The runs of each configuration in this block, kept together.
    const groups: PlannedRun[][] = [];
    for (const config of order(configs, block)) {
      const group: PlannedRun[] = [];
      if (block < (isEnd(config) ? shared : r.reps)) group.push({ config, rep: block, mode: "time" });
      if (block < r.profileReps) group.push({ config, rep: block, mode: "profile" });
      if (group.length > 0) groups.push(group);
    }
    // The extra timing runs of the ends this block takes, spread over it between groups.
    const mine = Array.from({ length: extras }, (_, j) => j).filter((j) => Math.floor((j * blocks) / extras) === block);
    const length = groups.length;
    mine.forEach((j, i) => {
      const at = Math.round(((i + 1) * length) / (mine.length + 1)) + i;
      groups.splice(at, 0, ends.map((config) => ({ config, rep: shared + j, mode: "time" as const })));
    });
    plan.push(...groups.flat());
  }
  return plan;
}

/** The configurations in the order of a block: the baseline, then the rest shuffled. */
function order(configs: readonly Configuration[], block: number): Configuration[] {
  const baseline = configs.filter((c) => c.k === 0);
  const rest = configs.filter((c) => c.k !== 0);
  return [...baseline, ...permutation(rest.length, 1000 + block).map((i) => rest[i]!)];
}

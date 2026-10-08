import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileSource } from "../../src/driver/index.js";
import {
  configurations,
  configure,
  dynableLocations,
  dynSet,
  permutation,
  workloadConstants,
} from "../../scripts/bench/config.js";
import { aliceBob } from "../support/config.js";
import { projectRoots, REPO_ROOT } from "../support/project.js";
import { readSourceFiles } from "../../src/local-imports/index.js";
import { loadConfig } from "../../src/config/index.js";

const SOURCE = `// Workload
let ROUNDS: integer@every = 100@every;
let LIMIT: integer@every = 7@every;
let state: integer@every = 0@every;

function twice@alice(x: integer@alice): integer@alice {
  return x * 2@alice;
}

function step(x: integer@alice): integer@bob {
  let y: integer@bob <- twice(x);
  return y;
}

for (let i: integer@every = 0@every; i < ROUNDS; i = i + 1@every) {
  let v: integer@bob = step(1@alice); // "@alice" in a comment stays
}
`;

const benchmarks = projectRoots().filter((dir) => dir.startsWith("benchmarks/"));

function read(dir: string): string {
  return readFileSync(join(REPO_ROOT, dir, "src", "index.cbs"), "utf8");
}

describe("benchmark configurations (benchmarks/README.md)", () => {
  it("finds the locations outside local functions, and only those", () => {
    const locations = dynableLocations(SOURCE);
    assert.deepEqual(
      locations.map((l) => `${l.line}:${l.text}`),
      [
        "2:every", "2:every", "3:every", "3:every", "4:every", "4:every",
        "10:alice", "10:bob", "11:bob", "15:every", "15:every", "15:every",
        "16:bob", "16:alice",
      ],
    );
  });

  it("leaves out the location of a local import", () => {
    const source = readFileSync(join(REPO_ROOT, "examples/thermostat/src/index.cbs"), "utf8");
    const imports = source.split("\n").flatMap((line, i) => (line.startsWith("import@") ? [i + 1] : []));
    assert.ok(imports.length > 0);
    assert.ok(dynableLocations(source).every((l) => !imports.includes(l.line)));
  });

  it("counts the dyn-able locations the README lists for the macro benchmarks", () => {
    const counts = Object.fromEntries(
      benchmarks.filter((d) => d.includes("/macro/")).map((d) => [d.split("/").at(-1), dynableLocations(read(d)).length]),
    );
    assert.deepEqual(counts, {
      "a-smallbank-2pc": 371,
      "b-sensor-fusion": 120,
      "c-replicated-kvs": 117,
      "d-kmeans": 114,
      "e-sample-sort": 147,
      "f-jacobi": 80,
      "g-secure-aggregation": 243,
      "h-job-dispatcher": 105,
    });
  });

  it("finds the workload constants: capitalized, at every, outside a for", () => {
    assert.deepEqual(
      workloadConstants(SOURCE).map((c) => [c.name, c.value]),
      [["ROUNDS", 100], ["LIMIT", 7]],
    );
    for (const dir of benchmarks) {
      assert.ok(workloadConstants(read(dir)).length > 0, `${dir} has no workload constant`);
    }
  });

  it("changes nothing for no dyn and no workload", () => {
    assert.equal(configure(SOURCE, new Set()), SOURCE);
  });

  it("makes the chosen locations dyn and sets the workload, touching nothing else", () => {
    const out = configure(SOURCE, new Set([0, 13]), new Map([["ROUNDS", 5000]]));
    assert.match(out, /^let ROUNDS: integer@dyn = 5000@every;$/m);
    assert.match(out, /step\(1@dyn\); \/\/ "@alice" in a comment stays/);
    assert.match(out, /function twice@alice\(x: integer@alice\): integer@alice/);
    assert.equal(out.replace("@dyn", "@every").replace("5000", "100").replace("1@dyn", "1@alice"), SOURCE);
  });

  it("rejects an unknown constant and a value a benchmark cannot hold", () => {
    assert.throws(() => configure(SOURCE, new Set(), new Map([["NOPE", 1]])), /no workload constant NOPE/);
    assert.throws(() => configure(SOURCE, new Set(), new Map([["ROUNDS", 2 ** 29]])), /from 0 to/);
  });

  it("nests the configurations of a seed, and draws the same ones every time", () => {
    const n = 50;
    assert.deepEqual(permutation(n, 3), permutation(n, 3));
    assert.notDeepEqual(permutation(n, 3), permutation(n, 4));
    // The order the prototype measured with, so that its seeds still name the same configurations.
    assert.deepEqual(permutation(10, 1).slice(0, 5), [7, 8, 3, 2, 1]);
    const configs = configurations(n, [1, 2], [0, 0.1, 0.5, 1]);
    const small = dynSet(configs.find((c) => c.seed === 1 && c.p === 0.1)!);
    const large = dynSet(configs.find((c) => c.seed === 1 && c.p === 0.5)!);
    assert.equal(small.size, 5);
    assert.ok([...small].every((i) => large.has(i)));
  });

  it("lists no dyn and all dyn once, without a seed", () => {
    const configs = configurations(20, [1, 2, 3], [0.5, 1]);
    assert.deepEqual(
      configs.map((c) => [c.seed, c.k]),
      [[null, 0], [1, 10], [2, 10], [3, 10], [null, 20]],
    );
  });

  it("gives every benchmark a program that compiles at half and at all of its locations dyn", () => {
    for (const dir of benchmarks) {
      const root = join(REPO_ROOT, dir);
      const source = read(dir);
      const endpoints = loadConfig(join(root, "choreobs.json")).endpoints.map((e) => e.name);
      const files = readSourceFiles(join(root, "src"));
      const n = dynableLocations(source).length;
      for (const p of [0.5, 1]) {
        const configured = configure(source, dynSet({ seed: 1, p, k: Math.round(p * n), n }));
        const result = compileSource(configured, "index.cbs", { endpoints, implicitDyn: false }, files);
        assert.equal(result.success, true, `${dir} at ${p}: ${result.errors.map((e) => e.message).join("\n")}`);
      }
    }
  });

  it("compiles the small program it rewrites", () => {
    assert.equal(compileSource(SOURCE, "index.cbs", aliceBob).success, true);
  });
});

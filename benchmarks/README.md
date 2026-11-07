# ChoreoBS benchmarks

These benchmarks evaluate the run-time cost of gradual locating, i.e. of leaving
locations to `dyn` (spec §dyn). They are written for two research questions:

* **RQ1:** how much does gradual locating cost? Each benchmark is run with its
  *location precision* (the fraction of its dyn-able locations made `dyn`) at
  0, 10, …, 100%.
* **RQ2:** which run-time mechanism dominates that cost? Each micro benchmark
  isolates one or two of the mechanisms listed below. The macro benchmarks are
  complete programs that combine them.

Every program here is the **0% baseline**. It is compiled in strict mode
(`"implicitDyn": false`), so every location is written and none of them is
`dyn`. The other configurations are derived from it by rewriting written
locations to `@dyn`.

## Layout

```
benchmarks/
  micro/  u1-arith-int  u1-arith-float  u2-ping-pong  u3-array  u4-boundary
          u5-fanout-k2  u5-fanout-k4  u5-fanout-k8
          u6-bystander-n2  u6-bystander-n4  u6-bystander-n8
  macro/  a-smallbank-2pc  b-sensor-fusion  c-replicated-kvs  d-kmeans
          e-sample-sort  f-jacobi  g-secure-aggregation  h-job-dispatcher
  macro-esp32/  b-sensor-fusion
```

Each directory is a ChoreoBS project shaped like those in `examples/`: a
`choreobs.json`, which puts every endpoint on the `host` board, and a
`src/index.cbs`. A variant that changes the set of endpoints (u5, u6) or the
base type (u1) has a directory of its own, because `choreobs.json` fixes the
endpoints.

`macro-esp32/` holds macro benchmarks with every endpoint on an ESP32 board
of its own (see [Running on ESP32 boards](#running-on-esp32-boards)). Each has
the program of the macro benchmark of the same name, unchanged; only its
`choreobs.json` differs.

`test/integration/benchmarks.test.ts` compiles every benchmark as part of
`npm test`, and checks that each is in strict mode. It also checks that each
`macro-esp32/` benchmark has the same source and endpoints as its macro
benchmark, with every endpoint on `esp32` under a device name of its own.

The measuring scripts (see [Measuring](#measuring)) keep their copies of the
benchmarks in `benchmarks/.work/` and write their results to
`benchmarks/results/`. Neither is committed.

## Running a benchmark

The BlueScript workspace is not committed. Make it from the benchmark's
directory with `choreobs add-endpoint` for each endpoint in its
`choreobs.json`, then run:

```bash
cd benchmarks/macro/d-kmeans
choreobs add-endpoint coordinator
choreobs add-endpoint worker1
choreobs add-endpoint worker2
choreobs add-endpoint worker3
choreobs add-endpoint worker4
choreobs run
```

`choreobs` comes from `npm run build && npm link` at the root of the
repository. Things to keep in mind:

* `bscript workspace run` exits with status 1 when an endpoint stops with a
  runtime error or runs out of memory. The output says which: look for
  `runtime error` and `memory exhausted`.
* Starting the endpoints takes about a second, which dominates at the default
  sizes. The default sizes are kept small so that every benchmark finishes in a
  few seconds and the self-checks can be run often. Each benchmark has a
  **Workload** section of `@every` constants at the top of its source; scale
  them up for timing runs.
* The C runtime of BlueScript has a fixed heap of 8K words (32 KB), on the host
  too. A `dyn` value that is not bound to one endpoint keeps a copy of its
  payload at every endpoint, so a configuration with many `dyn` arrays needs
  more heap than the baseline. Raising an array-heavy benchmark's sizes (u3,
  D, E, F, G) can exhaust the heap at high precision before it does at 0%.

## Running on ESP32 boards

`macro-esp32/b-sensor-fusion` is B with each of its six endpoints on an ESP32
board of its own.

bscript connects to every board over Bluetooth LE and relays every message
between them: the boards never talk to each other directly. Prepare each board
once, with the BlueScript runtime from the same BlueScript as the `bscript` on
`PATH`, under the device name its endpoint has in `choreobs.json`:

| Endpoint | Device name |
|---|---|
| `sensor1` | `CBS-S1` |
| `sensor2` | `CBS-S2` |
| `sensor3` | `CBS-S3` |
| `fusion` | `CBS-F` |
| `controller` | `CBS-C` |
| `actuator` | `CBS-A` |

```bash
bscript board setup esp32
bscript board flash-runtime esp32 -d CBS-S1
```

Then run it as any other benchmark, with every board powered and nearby:

```bash
cd benchmarks/macro-esp32/b-sensor-fusion
choreobs add-endpoint sensor1
choreobs add-endpoint sensor2
choreobs add-endpoint sensor3
choreobs add-endpoint fusion
choreobs add-endpoint controller
choreobs add-endpoint actuator
choreobs run --stats
```

To measure it, name it by its directory or as the group `macro-esp32`. It is
left out of `all`, and the name `b-sensor-fusion` alone means the host one.
`caffeinate` keeps the Mac awake until the command ends; keep the lid open and
the Mac on its charger, or it sleeps anyway and the boards disconnect.

```bash
caffeinate -i -s npm run bench -- macro-esp32 --fractions 0 --reps 1 --mode time --warmup 0 --set TICKS=80 --timeout 1800
```

A sweep at every 10%, with timing and profile runs in one command, takes
about two and a half hours with three boards:

```bash
caffeinate -i -s npm run bench -- macro-esp32 --seeds 5 --steps 10 --reps 3 --end-reps 5 --set TICKS=80 --warmup 2 --timeout 300 --retry-failed 2 --out benchmarks/results/esp32x3-sweep
```

Things to keep in mind:

* Every message crosses Bluetooth twice, from its sender to the Mac and from
  the Mac to its receiver, and each send or receive waits for the Mac's
  answer. B sends about 22 messages a tick, so start with a small `TICKS` and
  a long `--timeout`. `benchmarks/workloads.json` has no entry for it. In a
  trial with `sensor1` alone on a board, one send or receive there took about
  73 ms, 0.22 s a tick.
* `TICKS` below 71 leaves too few ticks after the setpoint changes for the
  plant to settle, so `controller` prints `false`. At 71 the plant ends 1.7
  from the setpoint, against a limit of 2.0; 80 leaves a margin. The script
  does not read that line: a run is correct when it prints what its baseline
  printed, and `macro-esp32` is its own baseline.
* A board reports `exec_ms` alone: `cpu_*` and `gc_ms` stay empty. The
  profiling build runs on the boards, and its `send_ms`, `receive_ms` and
  `broadcast_ms` tell how much of `exec_ms` went to messages. A `dyn`
  configuration exercises counters not yet tried on a board
  (spec §unverified-bluescript-assumptions).
* A board's float arithmetic may differ from the host's in the last digits.
  Outputs are compared with a tolerance (see [How it measures](#how-it-measures)),
  and the self-check allows 2.0. In the trial with `sensor1` on a board, the
  output matched the host's exactly.
* The terminal that runs `bscript` needs macOS's Bluetooth permission. A
  process without it is killed with `SIGABRT` as soon as it scans.
* Connecting to a board now and then times out, and now and then a link drops
  and leaves the other endpoints waiting. Measure with `--retry-failed 2`,
  which runs such a run again at the end of the sweep. Do a trial run into an
  `--out` of its own, or the sweep counts it as its first repetition.

## Measuring

`scripts/bench/` measures the benchmarks across location precision. It makes
each configuration, compiles and runs it with `bscript workspace run --stats`,
checks what it prints against the baseline, and records the run. A second
script turns the records into CSV files for the tables and figures.

You need `bscript` on `PATH`, with a `workspace run` that takes `--stats`. The
CPU times need a `bscript` whose `STATS` lines carry `cpu_user_ms` and
`cpu_sys_ms`; with an older one they are left empty.
Nothing else needs building: the scripts run from source with `tsx`.

```bash
# A quick look: one benchmark, 0%, 50% and 100%, two repetitions.
npm run bench -- a-smallbank-2pc --seeds 2 --fractions 0,0.5,1 --reps 2 --out benchmarks/results/try
npm run bench:summarize -- benchmarks/results/try

# The full sweep of the macro benchmarks, at the sizes chosen for timing.
npm run bench -- macro --workloads benchmarks/workloads.json
```

### Options of `npm run bench`

Benchmarks are named by directory (`benchmarks/macro/a-smallbank-2pc`), by name
(`a-smallbank-2pc`), or as a group: `micro`, `macro` or `all`. `macro-esp32` is
a group too, but `all` and a name alone leave it out, since it needs a board.

| Option | Meaning | Default |
|---|---|---|
| `--seeds N` | seeds 1 to N, each a random order of the dyn-able locations | 5 |
| `--seed-list a,b` | these seeds instead | |
| `--steps N` | fractions 0, 1/N, …, 1 of the locations made `dyn` | 10 |
| `--fractions a,b` | these fractions instead; 0 is always measured | |
| `--reps N` | timing runs of each configuration | 5 |
| `--end-reps N` | timing runs of 0% and 100% instead, spread over the sweep | as `--reps` |
| `--profile-reps N` | profile runs of each configuration | 1 |
| `--mode M` | `time`, `profile` or `both` | `both` |
| `--workloads FILE` | workload constants by benchmark, as in `benchmarks/workloads.json` | |
| `--set [b:]NAME=V` | a workload constant, for every benchmark that has it or for benchmark `b`; repeatable, and it overrides `--workloads` | |
| `--out DIR` | where the results go | `benchmarks/results/<UTC time>` |
| `--timeout S` | seconds before a run is killed | 120 |
| `--warmup N` | unrecorded baseline runs before a benchmark's first run | 1 |
| `--config FILE` | a `choreobs.json` to use instead of the benchmark's, e.g. one that puts the endpoints on `esp32` boards; one benchmark only | |
| `--retry-failed N` | run a run that ended `failed`, `runtime_error` or `timeout` up to N more times, at the end of the sweep | 0 |
| `--dry-run` | list the runs, run nothing | |

Each run is appended to `runs.jsonl` as soon as it ends. The same command run
again skips every run already there, so an interrupted sweep resumes where it
stopped, and a sweep can be extended with more seeds or repetitions.

A run can fail for want of the testbed rather than the program: a board that
does not connect or does not report in full (`failed`), a link that drops and
leaves the other endpoints waiting (`runtime_error`), a run that hangs
(`timeout`). `--retry-failed N` puts such a run at the end of the sweep, up to
N more times, so that a board has time to come back. On a resumed sweep it
also tries again each run whose last record there failed so; `--dry-run` marks
them `(failed before)`. Every attempt stays in `runs.jsonl`, and each failed
one leaves its output in `failures/`. A run that ends `incorrect`,
`memory_exhausted` or `compile_error` would do so again, and is not retried.

### Sizes for timing

The default sizes keep every benchmark quick. For timing,
`benchmarks/workloads.json` raises each macro benchmark so that its baseline
runs for about 170 ms. At the default sizes the baselines ran for 12–107 ms,
and a single run of the shorter ones varied by 4–8% (by how far the timing run
and the profile run of the same configuration disagreed). Each benchmark is
raised through the constant that repeats the work, so the data, and with it
the heap a run needs, stays as it is, and every value stays below 2^29:

| Benchmark | Constant | Default | For timing | Baseline then |
|---|---|---|---|---|
| a-smallbank-2pc | `TXNS` | 300 | 1100 | about 170 ms |
| b-sensor-fusion | `TICKS` | 400 | 800 | about 175 ms |
| c-replicated-kvs | `OPS` | 400 | 1200 | about 170 ms |
| d-kmeans | `RESTARTS` | 4 | 128 | about 165 ms |
| e-sample-sort | `ROUNDS` | 5 | 150 | about 155 ms |
| f-jacobi | `MAX_STEPS` | 400 | 1300 | about 165 ms |
| g-secure-aggregation | `ROUNDS` | 30 | 1000 | about 165 ms |
| h-job-dispatcher | `JOBS` | 200 | 2400 | about 180 ms |

Each value was chosen from the baseline's time at two sizes, taken as a fixed
part plus a part per repetition. At these sizes five runs of one
configuration spread by less than 3% (the interquartile range over the
median), 3.8% at most, and every configuration tried at 0%, 50% and 100% ran
correctly. f-jacobi stops at `MAX_STEPS` at both sizes, before its residual
reaches the bound that ends it earlier, so its steps grow with the constant.

The size changes the result, not only its noise: at a small size, the start
and the initialization, which `dyn` changes little, weigh more. The slowdown
at 100% rose from 1.42 to 1.61 for d-kmeans, from 1.49 to 1.62 for
g-secure-aggregation and from 1.26 to 1.40 for h-job-dispatcher, and moved
by 0.06 or less for the others. Report the sizes with the results.

### How it measures

* **Configurations.** A benchmark's dyn-able locations (see
  [Conventions](#conventions)) are found in its tokens: every location written
  outside a local function, apart from the `@P` of an `import@P`. A seed fixes
  a random order of them, and the fraction `p` makes the first `round(p · n)`
  of them `dyn`. The configurations of one seed are therefore nested: a larger
  `p` only adds locations to a smaller one. 0% and 100% are the same program
  for every seed, and are measured once, with no seed. The rewriting works on
  tokens, so comments are never touched, and `--set` changes only the integer
  literal of a Workload constant.
* **Timing runs and profile runs.** A timing run is the ordinary build. Its
  time is `exec_ms` from bscript's `STATS` line, taken on the board: it leaves
  out starting, compiling and loading the programs, and includes waiting for
  messages and printing. A run takes as long as its slowest endpoint. A
  profile run is a profiling build (`choreobs run --profile`, spec
  §profiling-build), which counts what each endpoint does and prints a report
  at the end. Its wrappers and counters cost time, so its times are not used
  as results; `profile_overhead` in `configs.csv` says by how much they differ.
  The counts do not depend on timing, so one profile run of each configuration
  is enough.
* **Order.** Each repetition runs the baseline first and then every other
  configuration in a shuffled order, so that a drift of the machine's speed
  spreads over all configurations instead of falling on some. A
  configuration's timing run and profile run come one after the other. Every
  run records when it started.
* **The ends.** 0% and 100% are measured once for every seed, and every
  configuration is compared with 0%, so they may take more timing runs
  (`--end-reps`). Their extra runs go into the middle of the repetitions,
  spread evenly, so that they do not all fall at the end of the sweep.
  `scripts/bench/plan.ts` makes the order.
* **Correctness.** Each run is compared with what the baseline printed, as
  described in [Conventions](#conventions): only the endpoints that print in
  the baseline, integers and booleans exactly, floats within a relative 1e-3.
  A value whose `dyn` location is never bound is printed at every endpoint, so
  an endpoint may print lines another endpoint printed in the baseline; they
  are accepted and counted in `extra_lines`.
* **Failures.** A run is `ok`, `incorrect`, `failed` (an endpoint did not
  finish, or its report is missing), `runtime_error`, `memory_exhausted`,
  `timeout` or `compile_error`. Whatever bscript printed for a run that is not
  `ok` is kept in `failures/`.

### Output

`npm run bench` writes to its `--out` directory:

| File | Contents |
|---|---|
| `runs.jsonl` | one JSON object per run (`scripts/bench/records.ts`): the configuration, its status, and for each endpoint its `STATS` fields, what it printed and, for a profile run, its counters |
| `meta.json` | one entry per session: the arguments, the git commit and whether the tree was clean, the versions of `bscript` and Node, the machine |
| `locations/<bench>.json` | the dyn-able locations with their lines and columns, the workload constants, and each seed's order |
| `failures/*.log` | bscript's output for each run that did not end `ok` |

`npm run bench:summarize -- <dir…> [--out DIR]` reads `runs.jsonl` from each
directory and writes three CSV files:

| File | One row per | Main columns |
|---|---|---|
| `runs.csv` | run and endpoint, every attempt | the record, flattened, with every counter |
| `configs.csv` | configuration (benchmark, boards, workload, seed, `k`) | `exec_ms_median`, quartiles, `baseline_ms`, `slowdown` (median time over the baseline's), `cpu_ms_max_endpoint_median`, `cpu_ms_sum_median`, `busy_share_median`, `gc_ms_median`, `alloc_objects_median`, `requests` (communication calls of all endpoints), `ops_total`, `ops_replicated`, each counter summed over the endpoints, `invariants_ok`, `profile_overhead`, `runs_failed`, `runs_retried` (earlier attempts at runs tried again; the rest of the row counts each run by its last attempt) |
| `summary.csv` | benchmark and fraction | `slowdown_median`, quartiles, minimum and maximum over the configurations, `share_within_1_1x` and `share_within_2x`, and the median of each counter (`med_…`) |

Only valid runs count towards a time: those that ended `ok`.

### CPU time

Every timing run also records the CPU time of each endpoint, taken by bscript
over the same window as `exec_ms`: `cpu_user_ms` for its own work, the dynamic
runtime and the garbage collector included, and `cpu_sys_ms` for passing its
messages and output through the pipes to bscript. Waiting for a message uses
none, so `exec_ms` minus both is about the time the endpoint waited.
`busy_share_median` in `configs.csv` is the CPU time of the slowest endpoint
over its `exec_ms`. On the host at the default sizes, the smallbank baseline's
endpoints are busy for about 11–17% of their 69 ms.

### Counters

A profiling build counts, at each endpoint (spec §profiling-build):

| Counters | Mechanism |
|---|---|
| `send_n`, `send_ms`, `receive_n`, `receive_ms`, `broadcast_n`, `broadcast_ms` | calls of the communication API and the time spent in them, waiting for a message included; static and dynamic transfers alike |
| `dynval_new` | K1 boxing |
| `locvar_new`, `find`, `unify`, `bind`, `root_steps` | K2 location variables |
| `holds`, `is_here`, `is_every`, `kind_dispatch` | K3 dispatch |
| `unbound`, `inject`, `cast` | K4 inject and cast |
| `transfer`, `transfer_broadcast`, `transfer_send`, `transfer_none`, `transfer_copy`, `transfer_receive`, `copy_array` | K5 communication |
| `op_arith`, `op_array`, `op_print`, `op_here`, `op_every`, `op_unbound`, `op_skip` | K6 redundant execution: each dynamic operation, by kind and by where its operands were unified to. `op_every + op_unbound` are computed by every endpoint, `op_skip` by none here |

`invariants_ok` checks that these agree: the operations by kind and by
location add up to the same total, the three results of a transfer add up to
`transfer`, and over all endpoints the receives equal the sends plus each
broadcast once per other endpoint.

### Caveats

* The heap is 32 KB on the host too. A larger workload, or a configuration
  with many unbound `dyn` arrays, can end in `memory_exhausted`.
* `STATS` lines are printed only when bscript's output is not a terminal. The
  script reads it through a pipe.
* A run that times out is killed with its whole process group, endpoints
  included.
* Every endpoint runs as a process of its own. Keep the number of endpoints
  below the number of cores (u5-fanout-k8 runs nine).
* With `--config` putting endpoints on `esp32`, `STATS` gives `exec_ms` alone
  for them. The profiling build runs there, but only its counters outside
  `dyn` values have been tried (spec §unverified-bluescript-assumptions).
* For a single run by hand, `choreobs run --stats --profile` prints the same
  report.

## Conventions

Every benchmark follows these rules.

**The baseline is fully static.** Every `let` in a choreography context has a
written type, so each one is a location that can be made `dyn`. A *dyn-able
location* is a written location outside a local function: a type annotation,
a located literal, an array literal's location, or a choreography function's
parameter or return type. `@every` locations count too. Local functions can
never hold `dyn` (spec §local-function-strict-location-rule), so their
locations are not dyn-able. Leaving one out does not make it `dyn` either: it is
the function's own location (spec §local-function-location-inference).

**Local functions are leaf kernels only.** A local function is used only for an
inner loop over one endpoint's data that involves no other role: sorting,
probing a hash table, a sweep, a gradient. Protocol logic and the computation
done per message are written in choreography functions or at top level, where
their locations are dyn-able. How much of a run is spent in each kind of code
differs between benchmarks on purpose. The summary table gives each one's
centre of computation.

**Values stay within 30 bits.** A `dyn` payload, an array element and a printed
value are BlueScript `any`s, which keep an integer only within ±2^29, and a
float exactly only for magnitudes in [2^-30, 2^32) (spec §array-types). Every
integer in these programs, intermediate values included, stays below 2^29. Random
numbers come from the generator `s = (s * 75 + 74) % 65537`. Randomness that
a branch needs, such as an operation's kind in C, is computed at `every`, so
every endpoint draws the same value without a message.

**Each program checks itself.** A macro benchmark prints, at one endpoint, a
boolean `ok` for its own invariants, followed by checksums. A micro benchmark
prints a checksum. To check a configuration, compare what it prints with what
the baseline prints. Two caveats:

* A value whose `dyn` location is never bound is printed at every endpoint,
  not only at the endpoint that prints it in the baseline (spec
  §print-typing). Compare only the lines of the endpoint that prints in the
  baseline.
* Float results may differ in their last digits between the baseline and a
  `dyn` configuration. For example, u1-arith-float prints `7126.211914` at 0%
  and `7126.246582` at 100%. A boxed float operation rounds after every
  operation, while the static code probably does not. Compare floats with a
  relative tolerance (1e-3 is ample). Integer and boolean results must match
  exactly.

## Run-time mechanisms

| | Mechanism | What it is in the runtime |
|---|---|---|
| K1 | Boxing | a `__DynVal` allocated per dynamic operation, its payload a BlueScript `any`, and the garbage they leave |
| K2 | Location variables | a fresh `__LocVar` per result, and union-find in `__unify`/`__bind`/`__find` |
| K3 | Dispatch | the integer comparisons of location codes in `__holdsPayload`, `__isHere` and `__cast`, and the dispatch on the kind code in `__dynTransfer` (spec §location-and-kind-codes) |
| K4 | Inject and cast | `__inject`/`__cast` wherever a static value meets a `dyn` one |
| K5 | Communication | a transfer to a `dyn` destination broadcasts instead of sending; a dynamic transfer copies arrays (`__copyArray`) |
| K6 | Redundant execution | endpoint projection keeps every dynamic operation at every endpoint, so endpoints that do not own a value still perform the operation (spec §dyn-lowering) |

## Summary

### Micro benchmarks

| Benchmark | Endpoints | What it does | Mechanisms |
|---|---|---|---|
| u1-arith-int / -float | 2 | scalar arithmetic in a choreography loop | K1, K2, K3 |
| u2-ping-pong | 2 | round trips of a scalar | K3, K5 |
| u3-array | 2 | array element access, push, length, and whole-array transfers | K1, K5 |
| u4-boundary | 2 | u1's computation inside local functions, called from the loop | K4 |
| u5-fanout-k2 / -k4 / -k8 | 3 / 5 / 9 | scatter, gather and broadcast | K5, K6 |
| u6-bystander-n2 / -n4 / -n8 | 2 / 4 / 8 | u1's loop at one endpoint, the others idle | K6 |

### Macro benchmarks

| Benchmark | Endpoints | Communication pattern | Centre of computation | Data | Lines | Dyn-able locations |
|---|---|---|---|---|---|---|
| A smallbank-2pc | 4 | request/response and agreement | choreography | integer, branch-heavy | 666 | 371 |
| B sensor-fusion | 6 | pipeline, broadcast decisions | choreography | float scalars | 266 | 120 |
| C replicated-kvs | 4 | replication fan-out | choreography (communication-bound) | integer arrays | 309 | 117 |
| D kmeans | 5 | iterative scatter-gather | both | float arrays | 402 | 114 |
| E sample-sort | 5 | all-to-all | both (array copies) | integer arrays | 699 | 147 |
| F jacobi | 4 | nearest-neighbour halo, allreduce | local kernels | float arrays | 278 | 80 |
| G secure-aggregation | 5 | star, plus client-to-client pairs | both | modular integers and floats | 677 | 243 |
| H job-dispatcher | 5 | destination chosen by data | choreography | integer | 290 | 105 |

The location counts are approximate: they count the written `@location`s
outside local functions.

### How the macro benchmarks were chosen

The macro benchmarks are few, so they were chosen to differ from each other as
much as possible. These are the criteria.

**No two share a communication pattern.** Each has a pattern of its own (the
table above), from request/response with agreement (A) to a destination chosen
by run-time data (H). Together they cover the shapes distributed programs are
usually built from: request and response, broadcast, scatter-gather,
all-to-all, nearest-neighbour exchange with a reduction, and peers that talk to
each other as well as to a hub.

**The centre of computation spans the whole range.** Local functions are always
static (see [Conventions](#conventions)), so the cost of `dyn` falls on
choreography code. The suite has both ends: F spends its time in local kernels
and is the lower bound, and A is almost all choreography code, with the most
dyn-able locations. C is the communication-bound end. The others lie between.

**The data differ.** The suite has branch-heavy integer scalars (A, H), float
scalars (B), integer arrays (C, E), float arrays (D, F), and modular integers
mixed with floats (G). Scalars and arrays reach different parts of the runtime:
a `dyn` scalar is boxed by every operation on it (K1), and a dynamic transfer
copies an array (K5). Floats also show the rounding difference described in
[Conventions](#conventions).

**Each leans on different mechanisms.** The micro benchmarks isolate the
mechanisms K1–K6; the macro benchmarks show which of them matters in a whole
program. C is the most exposed to communication (K5), in E the data moved are
mostly whole arrays, B does its float arithmetic in choreography code every
tick (K1), and A and H route values through `if` chains on an id known only at
run time.

**Each is a known workload.** Most come from established benchmarks or
algorithms, so that the programs are not shaped to suit ChoreoBS: SmallBank (A)
and YCSB workloads A and F (C) from databases; k-means (D), sample sort (E) and
Jacobi iteration (F) from parallel computing; the pairwise masking of secure
aggregation (G) from federated learning; and a Kalman filter in a PID loop (B)
from embedded control, the domain BlueScript is made for. H is included
because a destination chosen by run-time data is the situation that motivates
`dyn`, so the suite has at least one program in which `dyn` is the natural
choice. None is the original as published: [Origins](#origins) gives what each
is adapted from and how it differs.

**Each fits the measurement.**

* Four to six endpoints: enough for the patterns above, and fewer than the
  cores of the machine, since every endpoint is a process of its own (see
  [Caveats](#caveats)).
* At least 80 dyn-able locations (F has the fewest), so each 10% step of RQ1
  makes at least eight more locations `dyn`.
* A self-check (see [Conventions](#conventions)), so every configuration can be
  confirmed against the baseline before its time is counted.
* Workloads within BlueScript's limits: integers within 30 bits, and data that
  fit the 32 KB heap.

What the choice leaves out: every endpoint runs on the host, where a message
costs one bscript call, so no program measures communication between devices
(see [Not provided yet](#not-provided-yet)).

### Origins

Each macro benchmark is adapted from a published benchmark or algorithm, or,
for B and H, written for this suite around a textbook technique. All of them
are smaller than their originals (see [Conventions](#conventions) for the
limits), and every random number comes from the suite's own generator. The
other changes:

| Benchmark | Adapted from | Main changes |
|---|---|---|
| A smallbank-2pc | SmallBank [1] | Without WriteCheck, and with shares of its own. Single-node in the original: here the accounts are partitioned over three shards, and every transaction but Balance runs two-phase commit, with a participant failing 2% of the time. SendPayment and Amalgamate always span two shards. Accounts are drawn uniformly. |
| B sensor-fusion | None: a Kalman filter [2] in a PID loop | The filter tracks position only, as a scalar, and corrects the speed by a fixed gain outside its state. Noise is a sum of two uniform draws. The actuator simulates the plant. |
| C replicated-kvs | YCSB workloads A and F [3] | One mix of the two (50% read, 35% update, 15% read-modify-write) in place of either. Keys are uniform, not Zipfian, and a record is one integer, not ten fields. The primary-backup replication and the consistency checks are this suite's: YCSB specifies only the client's load. |
| D kmeans | Lloyd's algorithm [4] | Two-dimensional points around four true centres, split over four workers. Restarts from random centroids, not k-means++. |
| E sample-sort | Samplesort [5], with regular sampling as in PSRS [6] | Four workers, 16 samples per worker, three splitters chosen at a coordinator. Fresh data each round. |
| F jacobi | Jacobi iteration for the heat equation | One dimension, fixed boundary temperatures, and a convergence test every `RES_EVERY` steps. |
| G secure-aggregation | Pairwise masking from Bonawitz et al. [7] | Only the pairwise masks: no self-masks, no secret sharing, so no recovery from clients that drop out, and no authentication. A tiny Diffie-Hellman group (p = 16381) and a non-cryptographic generator, so it is not secure. The model is a linear regression. The debugging path that sends unmasked encodings is this suite's. |
| H job-dispatcher | None: shortest-expected-delay dispatch | Written for this suite. The dispatcher picks the worker with the least backlog divided by speed, from estimates that are refreshed only every `REPORT_EVERY` ticks. |

1. M. Alomari, M. Cahill, A. Fekete, U. Röhm. The cost of serializability on
   platforms that use snapshot isolation. ICDE 2008.
2. R. E. Kalman. A new approach to linear filtering and prediction problems.
   Journal of Basic Engineering, 1960.
3. B. F. Cooper, A. Silberstein, E. Tam, R. Ramakrishnan, R. Sears.
   Benchmarking cloud serving systems with YCSB. SoCC 2010.
4. S. P. Lloyd. Least squares quantization in PCM. IEEE Transactions on
   Information Theory, 1982.
5. W. D. Frazer, A. C. McKellar. Samplesort: a sampling approach to minimal
   storage tree sorting. Journal of the ACM, 1970.
6. H. Shi, J. Schaeffer. Parallel sorting by regular sampling. Journal of
   Parallel and Distributed Computing, 1992.
7. K. Bonawitz et al. Practical secure aggregation for privacy-preserving
   machine learning. CCS 2017.

## Micro benchmarks

### u1-arith-int, u1-arith-float

A loop counted at `every` does a few arithmetic operations on scalars held at
`alice`, with no communication and no local function. Under `dyn`, each
operator becomes a runtime call that allocates a `__DynVal` and a location
variable, and unifies the location variables of its operands. The float
variant performs the same kind of work on floats, so comparing the two shows
whether boxing a float costs more.

* Workload: `ITERS = 20000`.
* Output: `alice` prints the checksum `acc`.

### u2-ping-pong

A scalar makes `ROUNDS` round trips `alice → bob → alice`, with one arithmetic
step at `bob` per round. Its cost is almost entirely the two transfers. Three
configurations isolate what a dynamic transfer costs:

| Configuration | Make `dyn` | Effect |
|---|---|---|
| source dyn | the type of `ball` | `__dynTransfer` dispatches on where the source turns out to be |
| destination dyn | the type of `atBob` | the send becomes a broadcast, and the result is unbound |
| both | both of them | both effects |

* Workload: `ROUNDS = 2000`.
* Output: `alice` prints the final `ball`.

### u3-array

Phase 1 rebuilds an `integer[]@alice` `PASSES` times. Each pass reads every
element, pushes the new value onto a fresh array, writes it back into place,
and reads `.length`. All of this is choreography code, so each array operation
becomes a `__dynArray*` call once its locations are `dyn`. Phase 2 sends the
array to `bob` `SENDS` times. A dynamic transfer copies the array as well.

* Workload: `N = 256`, `PASSES = 20`, `SENDS = 50`.
* Output: `alice` prints `aliceSum` and `bob` prints `bobSum`.

### u4-boundary

The computation of u1-arith-int, moved into two local functions at `alice`.
The loop only passes choreography-level values in and out. When those values
are `dyn`, every call casts its arguments to `alice` and injects its result
back, while the arithmetic itself stays static. Comparing u4 with u1 separates
the cost of crossing the boundary from the cost of the dynamic operators. It
prints the same checksum as u1-arith-int.

* Workload: `ITERS = 20000`.
* Output: `alice` prints the checksum `acc`.

### u5-fanout-k2, -k4, -k8

`root` and K workers. Each round:

1. `root` scatters a task to every worker;
2. each worker does one arithmetic step;
3. `root` gathers the results and broadcasts their sum;
4. every endpoint folds the sum into its own accumulator.

The three directories differ only in K. A transfer to a `dyn` destination is a
broadcast to every endpoint, and every endpoint performs every dynamic
operation, so the cost of a dynamic transfer is expected to grow with K. On a
single machine, keep K + 1 at or below the number of physical cores.

* Workload: `ROUNDS = 500`.
* Output: `root` prints the checksum of all the accumulators.

### u6-bystander-n2, -n4, -n8

The loop of u1-arith-int, run entirely at `owner`, with N − 1 idle endpoints.
Statically, endpoint projection leaves the idle endpoints nothing but the loop
counter. Once the kernel's locations are `dyn`, the idle endpoints perform
every operation too, producing `null` payloads. The three directories differ
only in N. All of them print the same checksum as u1-arith-int.

* Workload: `ITERS = 20000`.
* Output: `owner` prints the checksum `acc`.

## Macro benchmarks

### A smallbank-2pc: SmallBank over two-phase commit

`coordinator` and `shard1`–`shard3`. Each shard holds a partition of the bank:
checking and savings balances and a lock for each account. The coordinator
generates a stream of SmallBank transactions with this mix (without
WriteCheck):

| Transaction | Share |
|---|---|
| Balance | 15% |
| DepositChecking | 20% |
| TransactSavings | 15% |
| SendPayment | 35% |
| Amalgamate | 15% |

SendPayment and Amalgamate always involve two different shards. Each
transaction other than Balance runs two-phase commit:

1. The header is broadcast.
2. Prepare: the source shard locks the account and checks the funds; a
   destination shard locks its account. Each votes, and a participant fails
   2% of the time.
3. The coordinator broadcasts the decision.
4. On commit, the source applies the transaction and sends the amount it moved
   directly to the destination shard. On abort, the locks are released.
5. Both participants ack.

Balance is a single read at the source shard, answered to the coordinator.

Characteristics:

* Every route to a shard is an `if` chain on a shard id broadcast at `every`,
  so the program is large and branch-heavy, and almost all of it is
  choreography code. It has the most dyn-able locations in the suite.
* Shards talk to each other directly, not only to the coordinator.

Details:

* Workload: `TXNS = 300`, `ACCOUNTS = 64` per shard, `INITIAL = 1000` per
  balance.
* Self-check: money is conserved (the shards' totals equal the initial total
  plus the deposits committed), every participant acked, and no lock is left
  held.
* Output: `coordinator` prints `ok`, the numbers of committed and aborted
  transactions, and a checksum of the balances read.

### B sensor-fusion: a control loop over redundant sensors

`sensor1`–`sensor3`, `fusion`, `controller` and `actuator`. Each tick:

1. The actuator, which simulates the plant (a damped mass), sends its true
   position to the sensors in place of physics.
2. Each sensor reports the position with noise. `sensor2` also drifts, and
   `sensor3` sometimes produces a spike.
3. Fusion runs a Kalman filter that predicts with an estimated speed, and
   rejects readings more than three standard deviations from the prediction.
4. Fusion broadcasts the tick's mode: normal, or degraded when some reading
   was rejected. In degraded mode, fusion tells each sensor whether its
   reading was kept, a rejected sensor drops its bias, and the controller
   switches to gentler gains.
5. The controller runs a PID law towards a setpoint, which changes half-way
   through the run, and sends the command to the actuator.

Characteristics:

* The arithmetic of each tick (measurement, filter update, PID, plant step) is
  all choreography code over float scalars. Noise, gating, the mode rule and
  clamping are local kernels.
* The communication is a pipeline, with a broadcast decision every tick.

Details:

* Workload: `TICKS = 400`.
* Self-check: the plant ends within 2.0 of the final setpoint.
* Output: `controller` prints `ok`, the final position, the number of degraded
  ticks and the number of readings rejected.

### C replicated-kvs: a primary-backup key-value store

`client`, `primary`, `backup1` and `backup2`. Each replica holds an
open-addressing hash table in two `integer[]`s. The client issues a
YCSB-style mix (workloads A and F):

| Operation | Share | What happens |
|---|---|---|
| read | 50% | the primary answers |
| update | 35% | the primary writes, replicates synchronously to both backups, and acks the client |
| read-modify-write | 15% | a read, then an update with a value computed at the client |

Every `CHECK_EVERY` operations, the replicas compare their table checksums at
the primary, and the verdict is broadcast.

Characteristics:

* There is little computation: probing and checksums are local kernels, and
  the rest is messages and choreography code. This is the communication-bound
  end of the suite, and the benchmark most exposed to K5.

Details:

* Workload: `OPS = 400`, `KEYS = 200`, `CAPACITY = 512`, `CHECK_EVERY = 50`.
* Self-check: every check, and a final one, found the replicas identical, and
  every write was acked.
* Output: `client` prints `ok`, the number of writes and a checksum of the
  values read.

### D kmeans: distributed k-means with restarts

`coordinator` and `worker1`–`worker4`. Each worker holds its own points as a
flattened `float[]`. Each iteration of Lloyd's algorithm:

1. The coordinator broadcasts the centroids.
2. Each worker assigns its points to the nearest centroid, and sends back the
   sums and count for each cluster and its share of the inertia.
3. The coordinator reduces the partials and moves the centroids. It then
   broadcasts whether any centroid still moves, which drives the `while`.

The clustering restarts `RESTARTS` times from random centroids, and the best
inertia is kept.

Characteristics:

* The assignment pass is a local kernel. The reduction, the centroid update and
  the convergence test are choreography code.
* Float arrays are broadcast and gathered every iteration.

Details:

* Workload: `POINTS = 200` per worker, `K = 4`, `MAX_ITERS = 20`,
  `RESTARTS = 4`.
* Self-check: within each restart the inertia never increases (allowing for
  float rounding), and the best inertia is below a bound that only a correct
  clustering of the generated data meets.
* Output: `coordinator` prints `ok`, the best inertia and the total number of
  iterations.

### E sample-sort: distributed sample sort

`coordinator` and `worker1`–`worker4`. Each round, every worker generates
fresh integers, and then:

1. Each worker sorts its integers and sends evenly spaced samples to the
   coordinator.
2. The coordinator merges the samples and broadcasts three splitters as an
   `integer[]@every`.
3. Each worker cuts its data into four buckets.
4. The workers exchange the buckets all-to-all: twelve array transfers.
5. Each worker merges the four buckets it now holds.

Characteristics:

* Sorting, cutting and merging are local kernels. Sampling, the choice of
  splitters, the exchange and the audit are choreography code.
* Most of the data moved is whole arrays, so array transfers and copies
  dominate. This makes it the benchmark that needs the most heap at high
  precision (see "Running a benchmark").

Details:

* Workload: `N_PER_WORKER = 100`, `SAMPLES = 16`, `ROUNDS = 5`.
* Self-check, every round: each worker's result is sorted, the ranges are
  ordered across workers, no element was lost, and the checksum of the
  elements is conserved.
* Output: `coordinator` prints `ok` and a checksum over all rounds.

### F jacobi: 1-D heat diffusion with halo exchange

`worker1`–`worker4` in a line. Each worker owns a segment of the rod, with a
ghost cell at each end. The left end of the rod is held at 100 and the right
end at 0. Each step:

1. Halo exchange: each worker sends its edge cells to its neighbours (six
   transfers).
2. Each worker runs a Jacobi sweep over its segment.

Every `RES_EVERY` steps, the residuals are reduced at `worker1`, which
broadcasts whether the rod has converged. The `while` runs until it has, or
until `MAX_STEPS`.

Characteristics:

* The sweep is a local kernel and dominates the run time. Only the halo
  exchange and the reduction are choreography code. This benchmark is the
  lower bound of the suite.

Details:

* Workload: `CELLS = 16` per worker, `MAX_STEPS = 400`, `RES_EVERY = 10`.
* Self-check: the residual never increases from one check to the next (the
  iteration matrix is symmetric), and every interior temperature lies within
  [0, 100].
* Output: `worker1` prints `ok`, the number of steps, the last residual and the
  temperature at the middle of the rod.

### G secure-aggregation: federated learning with secure aggregation

`server` and `client1`–`client4`.

Setup: every pair of clients agrees on a secret by Diffie-Hellman (p = 16381,
generator 2). They exchange public keys directly, client to client: twelve
transfers. Both clients of a pair then advance a generator seeded with their
secret in step.

Each round:

1. The server broadcasts the linear-regression model.
2. Each client computes the gradient on its own data and encodes it in fixed
   point mod `MODULUS`. It masks each coordinate: it adds the mask it shares
   with each higher-numbered client and subtracts the one it shares with each
   lower-numbered client.
3. The server sums the masked vectors. The masks cancel, so the sum is the sum
   of the gradients, although no single gradient is revealed. The server
   decodes the sum and takes a gradient step.

Every `VERIFY_EVERY` rounds, a debugging path also sends the unmasked
encodings, so the server can check that the masks really cancelled.

Characteristics:

* The gradient and the loss are local kernels.
* Key agreement, masking, aggregation and the model update are choreography
  code. They mix modular integer arithmetic with float arithmetic.

Details:

* Workload: `ROUNDS = 30`, `SAMPLES = 50` per client, `DIM = 2`,
  `MODULUS = 1048576`, `VERIFY_EVERY = 5`.
* Self-check: every verification found the masked and unmasked sums equal,
  and the loss fell below a tenth of its value after the first step.
* Output: `server` prints `ok`, the loss after the first and the last round,
  and the bias it learned (close to 1.0).

### H job-dispatcher: load-aware dispatch

`dispatcher` and `worker1`–`worker4`, with speeds 3, 2, 2 and 1 units of work
per tick. The dispatcher receives a stream of jobs of random size. Each tick:

1. Every `REPORT_EVERY` ticks, the workers report their backlogs, which reset
   the dispatcher's estimates. In between, the dispatcher keeps its own
   estimates, which go stale.
2. The dispatcher picks the worker with the least expected waiting time and
   broadcasts its choice.
3. An `if` chain on the choice sends the job to that worker.
4. Every worker works off up to its speed.

After the last job, the system drains until every backlog is empty.

Characteristics:

* Which endpoint a value goes to is decided by run-time data. That is the
  situation that motivates `dyn`.
* The work itself is a local kernel. Scheduling, bookkeeping and reports are
  choreography code.

Details:

* Workload: `JOBS = 200`, `MAX_SIZE = 8`, `REPORT_EVERY = 4`.
* Self-check: the work done equals the work issued.
* Output: `dispatcher` prints `ok`, the number of ticks, the units issued and a
  checksum of the work.

## Not provided yet

* Sizes for timing for the micro benchmarks (see
  [Sizes for timing](#sizes-for-timing) for the macro ones).
* A way to vary the cost of one message on the host, to see how the results
  depend on it. The host delivers every message through bscript, at about
  40 µs a call, and a broadcast costs one call however many endpoints
  receive it.

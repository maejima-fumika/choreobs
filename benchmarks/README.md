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
```

Each directory is a ChoreoBS project shaped like those in `examples/`: a
`choreobs.json`, which puts every endpoint on the `host` board, and a
`src/index.cbs`. A variant that changes the set of endpoints (u5, u6) or the
base type (u1) has a directory of its own, because `choreobs.json` fixes the
endpoints.

`test/integration/benchmarks.test.ts` compiles every benchmark as part of
`npm test`, and checks that each is in strict mode.

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

* `bscript` exits with status 0 even when an endpoint stops with a runtime
  error. Check the output for `runtime error` and `memory exhausted`.
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

## Conventions

Every benchmark follows these rules.

**The baseline is fully static.** Every `let` in a choreography context has a
written type, so each one is a location that can be made `dyn`. A *dyn-able
location* is a written location outside a local function: a type annotation,
a located literal, an array literal's location, or a choreography function's
parameter or return type. `@every` locations count too. Local functions can
never hold `dyn` (spec §local-function-strict-location-rule), so their
locations are not dyn-able.

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

* A timer. ChoreoBS has no clock, so time is measured outside the processes.
  This includes the startup of about a second.
* A generator of precision configurations: enumerate the dyn-able locations,
  and rewrite a chosen fraction of them to `@dyn`.
* Sizes calibrated for timing runs.

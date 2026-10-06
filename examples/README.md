# ChoreoBS examples

Each directory is a self-contained ChoreoBS project: a `src/index.cbs` and the
`choreobs.json` that declares its endpoints, all of them on the `host` board
(spec §input-files, §choreobs-json).

The BlueScript workspace the compiler writes into is not committed
(spec §output-files). To compile and run an example, make it first, from the
example's directory, with `choreobs add-endpoint` for each endpoint listed in
its `choreobs.json`. That makes the workspace too, and asks nothing, since
`choreobs.json` already gives each endpoint's board (spec §commands):

```bash
cd examples/map-reduce
choreobs add-endpoint driver
choreobs add-endpoint worker1
choreobs add-endpoint worker2
choreobs run
```

`choreobs run` compiles, then runs every endpoint's program together with
`bscript workspace run`. Compilation alone is `choreobs compile`, which writes
each endpoint's program to `workspace/<endpoint>/src/index.bs`, and its runtime
file `__runtime.bs` beside it (spec §runtime-files). `choreobs` itself comes from `npm run build && npm link`
at the root of this repository.

`test/integration/examples.test.ts` compiles every directory here as part of
`npm test`, without a workspace, so an example that stops compiling fails the
suite.

## The examples

| Directory | Endpoints | What it exercises |
|---|---|---|
| `sensor-pipeline` | sensor1, sensor2, gateway, server | local read/calibrate functions, direct transfers into a gateway, a `for` loop that reuses its communication tags each iteration, broadcast of a verdict before branching on it |
| `two-phase-commit` | coordinator, alice, bob, carol | a full propose/vote/decide protocol, votes converging on one endpoint, a decision broadcast so that every endpoint takes the same branch, local recursion with a written return type |
| `map-reduce` | driver, worker1, worker2 | partial aggregation on each worker, reduction at the driver, broadcasting a shared mean for a second pass, and publishing a loop bound as `@every` so a choreography-level `for` can use it |
| `control-loop` | controller, actuator, monitor | a `while` loop whose condition is `@every`, a closed control loop across three endpoints, and the difference between `=` (aliases an array) and `<-` (fresh copy) |

## Things these examples are meant to illustrate

**A loop condition in a choreography context must be `@every`.** A bound that
lives at one endpoint has to be transferred first:

```ts
let rounds: integer@every <- totalAbove;   // totalAbove : integer@driver
for (let round = 0@every; round < rounds; round = round + 1@every) { ... }
```

**Branching must be agreed before it is taken.** A decision computed at one
endpoint is broadcast, and the `@every` copy is what the `if` tests, so every
endpoint takes the same branch:

```ts
let decision: boolean@every <- committed;   // committed : boolean@coordinator
if (decision) { ... } else { ... }
```

**`<-` at a single location is a fresh copy, `=` is not.** For a mutable array
this is the difference between sharing and copying:

```ts
let aliased: float[]@monitor = trail;   // same array
let copied: float[]@monitor <- trail;   // fresh array
```

**A local function names its location once.** Every value in a local function
is at the function's own location, so the locations inside it are left out and
taken from the declaration (spec §local-function-location-inference):

```ts
function aliceCanAfford@alice(amount: integer): boolean {   // amount : integer@alice
    let balance = aliceBalance();
    return amount <= balance;                                // boolean@alice
}
```

**An empty array literal needs an annotated binding.** Its element type is not
inferred from a return type, so write it out:

```ts
function newTrail@monitor(): float[] {
    let trail: float[] = [];
    return trail;
}
```

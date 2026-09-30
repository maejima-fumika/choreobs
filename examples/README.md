# ChoreoBS examples

Each directory is a self-contained ChoreoBS project: an `index.cbs` and the
`choreobs.json` that declares its endpoints (spec §input-files).

Compile one with:

```bash
npx tsx src/cli/main.ts compile examples/<name>/index.cbs
```

This writes `index_<endpoint>.bs` next to the source, one per endpoint, and
`__runtime_<endpoint>.bs` beside them when the programs call a runtime helper
(spec §runtime-files). Those outputs are build artifacts and are not committed.

`test/integration/examples.test.ts` compiles every directory here as part of
`npm test`, so an example that stops compiling fails the suite.

## The examples

| Directory | Endpoints | What it exercises |
|---|---|---|
| `sensor-pipeline` | sensor1, sensor2, gateway, server | local read/calibrate functions, direct transfers into a gateway, a `for` loop that reuses its communication tags each iteration, broadcast of a verdict before branching on it |
| `two-phase-commit` | coordinator, alice, bob, carol | a full propose/vote/decide protocol, votes converging on one endpoint, a decision broadcast so that every endpoint takes the same branch, local recursion with an explicit return type |
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

**An empty array literal needs an annotated binding.** Its element type is not
inferred from a return type, so write it out:

```ts
function newTrail@monitor(): float[]@monitor {
    let trail: float[]@monitor = []@monitor;
    return trail;
}
```

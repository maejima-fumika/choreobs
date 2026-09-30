# Fuzzing ChoreoBS

Generates random ChoreoBS programs and compiles them, looking for bugs the
hand-written test suite does not reach.

```bash
npm run fuzz -- --runs 5000 --seed 1 --endpoints alice,bob,carol
```

| flag | meaning | default |
|---|---|---|
| `--runs N` | how many programs to generate | 2000 |
| `--seed S` | first seed; program `i` uses seed `S + i` | 1 |
| `--endpoints a,b,c` | endpoints to declare | `alice,bob,carol` |
| `--depth N` | maximum control-flow nesting | 2 |
| `--maxfn N` / `--maxstmt N` | function and top-level statement budget | 3 / 8 |
| `--vary` | draw a random endpoint subset per seed | off |
| `--no-dyn` | generate no `@dyn` (spec §dyn) | off |
| `--out DIR` | where failing programs are written | `scratchpad/fuzz-findings` |
| `-v` | also print the first generated program | off |

Programs use `@dyn` unless `--no-dyn` is given: dynamic variables, literals,
arrays, parameters, return types and transfers, and `dyn` values meeting
concrete ones. Every other seed (the even ones) is written for strict mode —
all of its `dyn` spelled out — and compiled with `"implicitDyn": false`; the
odd ones may also leave locations out and have them be `dyn`
(spec §omitted-locations, §strict-mode).

Reproduce one program with `npx tsx scripts/fuzz/dump.ts SEED [endpoints]`,
giving it the flags the run had (`--no-dyn`, `--vary`, `--depth`, …). It
generates and compiles exactly as `run.ts` did for that seed, and prints the
source, its mode, the verdict, and the projection for each endpoint. Finding
files record the endpoints and the mode too.

## Why a rejection is a finding

[`generator.ts`](generator.ts) is written to emit **only** programs the
specification calls well typed: locations are consistent (`~`, spec
§location-consistency-and-join) — equal, or with `dyn` on one side — and never
subsumed, binary operands share a location, conditions sit at the context's
location, transfers keep their base type with arrays invariant, local function
bodies mention nothing but their own endpoint and no `dyn`, and no function is
recursive.

So the driver treats every outcome other than success as something to look at:

- **crash** — an exception escaped the compiler instead of a diagnostic.
- **rejected by checker** — either the generator misreads a rule or the checker
  does. Rejections are grouped by normalized message so a systematic
  disagreement stands out from a one-off.
- **comm inconsistency** — only reachable once the checker has accepted the
  program, so the projection contradicts itself. Always a compiler bug.
- **bad output** — choreographic residue (`@`, `<-`, `absent`) survived
  projection, braces are unbalanced, the runtime files are not written for
  every endpoint exactly when a program imports them, or hold the
  dynamic-location runtime when no program imports from it or lack it when one
  does (spec §runtime-files),
  compilation is not deterministic, the output depends on the order endpoints
  are declared in, or a program written for strict mode compiles differently
  without it (spec §strict-mode).

These output checks live in [`inspect.ts`](inspect.ts), which the fixed corpus in
`test/integration/fuzz.test.ts` uses too.

A clean run reports feature coverage, because "no findings" only means something
if the corpus reached the interesting constructs — communication inside loops
and branches, broadcasts, array payloads, shadowing, inferred return types.

## Mutation fuzzing: are invalid programs rejected?

The run above only exercises the accepting path. The complementary direction
asks whether the checker *rejects* what it must:

```bash
npm run fuzz:violate -- --runs 32000 --seed 1 --endpoints alice,bob,carol
```

Each program is valid apart from **one** deliberate rule violation, emitted from
the generator's own type and location environment rather than by editing text,
so the violation is guaranteed real (renaming a location in a source file can
leave the program accidentally well typed; this cannot).

An accepted program is a soundness hole. The report also separates *rejected for
the expected reason* from *rejected for some other reason*, because a rule that
only appears to hold because an unrelated error fires first is not enforced.

| flag | meaning | default |
|---|---|---|
| `--only ID` | run a single violation (ids are listed in the report) | all |
| `--out DIR` | where accepted-but-invalid programs are written | `scratchpad/violation-findings` |

`--runs`, `--seed` and `--endpoints` work as above.

### Why the injection site is randomized

Soundness holes in this compiler are context-dependent: a rule is enforced on
one path and forgotten on another. Two real examples — return-type inference
skipped `let ... <- ...` bindings, and the call-graph walk skipped `if`
conditions and index-assignment targets — were both of that shape, and both were
invisible to line coverage of the accepting path.

So each violation is injected at a random statement position, and the report
tracks which of the 15 contexts it reached:

```
top-level, top-level > if-then, top-level > if-else, top-level > while,
top-level > for, choreography-fn, choreography-fn > if-then, ... ,
local-fn, local-fn > if-then, local-fn > if-else, local-fn > while, local-fn > for
```

A violation caught at top level but missed inside a loop body is exactly the
failure this is built to find. Some violations are only meaningful in some
contexts — an `@every` value is a violation only inside a local function — and
the generator shapes the program accordingly (forcing a local function to exist,
or two local functions at different endpoints for §calling-another-endpoints-local-function).

### Still not covered

Violations of rules about whole declarations rather than statements: function
overloading (§function-overloading), local function parameter and return locations (§invalid-local-function-parameter-location,
§invalid-local-function-return-location), `@every` on a function declaration (§every-on-a-function-declaration), and the recursion rules
(§recursion, §inference-and-recursion). Those are covered by hand-written tests instead.

`missingReturnValue` (§missing-return-in-a-non-void-function) is the one declaration-shaped violation the
generator does inject: it suppresses the trailing `return` of a function whose
return type is written, which needs no extra program structure.

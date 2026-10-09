# ChoreoBS case studies

Three IoT programs, each grown step by step from a plain BlueScript program
running on one machine into a choreography over several devices. Each step is
a directory of its own, a complete ChoreoBS project shaped like those in
`examples/`: a `choreobs.json`, which puts every endpoint on the `host` board,
and a `src/index.cbs`, with BlueScript files under `src/hardware/` once real
devices come in. The comment at the top of each `index.cbs` says what changed
from the step before, and why.

The way of writing they illustrate:

1. Write the program as plain BlueScript, on the host alone. No location is
   written, so every value is `dyn` (spec §omitted-locations), and with one endpoint that
   simply means the host.
2. Move one part to a device by giving its function a location, and send what
   crosses over with `<-`. The device's input is a mock at first.
3. Replace the mock with the device's driver, imported at its endpoint
   (spec §import-declarations). Its traces show what the mock hid, which motivates the next
   steps.
4. Add a second device to switch to, a filter, an actuator, as the program
   needs them.
5. Finish in strict mode (`"implicitDyn": false`, spec §strict-mode), which asks for
   every location that is still left out.

The hardware is simulated: each file under `src/hardware/` replays a recorded
trace, one reading per tick, so every run prints the same thing.

## Running a step

`run.sh` makes a step's BlueScript workspace with `choreobs add-endpoint` for
each endpoint in its `choreobs.json`, if it is not there yet, and runs it with
`choreobs run`. Further arguments, such as `--stats`, go to `choreobs run`.

```bash
case-study/run.sh case-study/1-greenhouse/step4-backup-sensor
```

`choreobs` comes from `npm run build && npm link` at the root of this
repository. `test/integration/case-study.test.ts` compiles every step as part
of `npm test`, and checks that the last step of each scenario is in strict
mode.

## 1. Greenhouse irrigation (`1-greenhouse`)

A soil-moisture probe decides whether the host runs the irrigation pump
(on when the moisture is under 31). The pump prints `true` or `false` each
tick, over 10 ticks.

| Step | Endpoints | Change | Lines (+/−) | Pump on at tick |
|---|---|---|---|---|
| `step0-host-only` | host | plain BlueScript, mock probe | — | 4 |
| `step1-sensor-node` | + soil | `readMoisture@soil`, the tick sent to `soil` | +3 −2 | 4, printed at `soil` |
| `step2-pump-on-host` | | `tooDry@host`, `setPump@host`, the reading sent to the host | +3 −3 | 4 |
| `step3-real-sensor` | | the mock replaced by the probe's driver | +1 −6 | 3, 5, 6–9 |
| `step4-backup-sensor` | + backup | `plausible@soil` sent to `every`; `reading: float@dyn` comes from either probe | +14 −1 | 3, 5 |
| `step5-filter` | + filter | a mean of the last three readings at `filter` | +20 −1 | 5 |
| `step6-strict` | | strict mode; the loop counter's literals at `every` | +1 −1 | 5 |

The lines count the code of `index.cbs` only, without comments or blank lines.

The real probe jitters, which switches the pump on and off around the
threshold (ticks 3 to 5), and breaks at tick 6, reading −1.0, which keeps the
pump on while the soil is wet. Step 4 fixes the second with a backup probe,
step 5 the first with a filter.

## 2. Fall detection (`2-fall-detection`)

A wristband's accelerometer detects a fall, a sample over 3 g, and the tick
of each detection is printed, over 12 ticks. The wearer bumps into something
at tick 3 and falls at ticks 10 and 11.

| Step | Endpoints | Change | Lines (+/−) | Reported |
|---|---|---|---|---|
| `step0-host-only` | host | plain BlueScript, mock samples | — | 3, 10, 11 |
| `step1-band-raw` | + band | `readAccel@band`; each sample sent to the host as an array of three | +8 −5 | 3, 10, 11 |
| `step2-feature-on-band` | | `magnitude2` moved from `@host` to `@band`; one float sent instead | +3 −3 | 3, 10, 11 |
| `step3-real-imu` | | the mock replaced by the band's driver | +2 −10 | 3 |
| `step4-phone-fallback` | + phone | whether the band is worn sent to `every`; `m2: float@dyn` comes from the band or the phone | +17 −7 | 3, 6, 10, 11 |
| `step5-median-filter` | | a median of three at the host | +27 −1 | 11 |
| `step6-alert` | + caregiver | the verdict sent to `every`; the caregiver is told, the phone vibrates | +9 −6 | caregiver 11, phone vibrates |
| `step7-strict` | | strict mode; the loop counter's literals at `every` | +1 −1 | same |

The band's recorded trace shows that it is taken off to charge at tick 6, so
the real fall goes unseen (step 3). The phone sees it, but also the jolt of
being put in a pocket at tick 6 (step 4). The median drops both one-sample
spikes and reports the fall a tick late (step 5).

## 3. Vibration monitoring (`3-vibration-monitor`)

Accelerometers on a motor's bearings stop the machine when the vibration goes
over 4.5 mm/s. The tick at which the machine stops is printed, and the loop
ends for every endpoint; it runs at most 20 ticks.

| Step | Endpoints | Change | Lines (+/−) | Stops at tick |
|---|---|---|---|---|
| `step0-host-only` | host | plain BlueScript, mock that grows steadily | — | 9 |
| `step1-sensor-node` | + vib1 | `readVibration@vib1`, the decision at the host, the verdict sent to `every` | +9 −6 | 9 |
| `step2-real-sensor` | | the mock replaced by the driver | +1 −3 | 4 |
| `step3-three-sensors` | + vib2, vib3 | two more sensors; the worst of three at the host | +20 −4 | 4 |
| `step4-gateway-filter` | + gateway | a median of three per sensor and the worst of three at `gateway` | +35 −5 | 13 |
| `step5-emergency-stop` | + stopper | `cutPower()` in the branch that stops | +2 −0 | 13, `power cut` |
| `step6-strict` | | strict mode; `running` and `t` at `every` | +5 −5 | same |

The mock grows to exercise the stop; the real drive-end bearing is healthy,
but a tool dropped on its housing at tick 4 gives one reading of 6.0, which
stops the machine for nothing (steps 2 and 3). The bearing that is really
wearing out is the gearbox's (`vib3`), over the limit from tick 12; with the
median at the gateway the machine stops for it, at tick 13 (step 4).

## Observations

**Every step runs.** Leaving a location out makes it `dyn`, so a step that
locates one function is a complete program; the rest follows at run time.

**Locating part of a program can bind more than that part.** In the
greenhouse's step 1, passing the `dyn` loop counter straight to
`readMoisture@soil(t)` compiles, but binds the counter to `soil`; the loop
condition, which must be at `every`, then fails on the second iteration with
`location error: every and soil`. Sending the counter instead
(`let tick: integer@soil <- t;`) copies it without binding it. All three
scenarios do this from their first located step.

**Unlocated code follows its data.** In the same step, `tooDry` and `setPump`
are not located yet, so they run where their argument is: the pump prints at
`[soil]`. Locating them at the host without sending the reading still
compiles, because the `30.0` in `tooDry` was `dyn`, and fails at run time;
once `tooDry` is at the host the same mistake is a compile error
(`argument float@soil is not at parameter location float@host: use a transfer
instead`).

**The type checker points at the communication a change needs.** Moving
`magnitude2` from the host to the band (fall detection, step 2) without
changing the transfer is the error `argument float[]@host is not at parameter
location float[]@band`. Branching on the host's verdict without sending it to
`every` (vibration monitoring, step 1) is `condition must be boolean@every in
a choreography context`.

**`dyn` stays where the location is a run-time decision.** Switching to a
backup device (greenhouse step 4, fall detection step 4) assigns the reading
from one device or the other to a variable written `@dyn`, and sends it on
from wherever it is. That `@dyn` is written, so it stays in strict mode.

**An agreed branch is cheap to extend.** Once a verdict is at `every`, a new
endpoint joins the branch with a call and no new communication: the stopper
in vibration monitoring, step 5, is one endpoint, one import and one call.

**A local function is at one endpoint.** The band and the phone compute the
same magnitude, so fall detection has a copy of it at each
(`bandMagnitude2@band`, `phoneMagnitude2@phone`).

**Strict mode is a small last step.** By the end, the only locations left out
are those of the loop counters, and of the loop flag in vibration monitoring.

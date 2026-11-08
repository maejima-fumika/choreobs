# ChoreoBS v1 Specification <a id="choreobs-core-v0-specification"></a>

ChoreoBS v1 is a choreographic programming language with explicit and gradual locations, designed to be transpiled to BlueScript through Endpoint Projection (EPP).

Every value has a location. A location is written explicitly, taken by simple local type inference from an initializer or from the local function it is written in, or left to run time with the dynamic location `dyn` (spec [§3.5](#dyn)). A `dyn` location is checked when the program runs rather than when it is compiled; this is **gradual locating**. A program that writes no `dyn`, and omits no location outside its local functions, is checked entirely statically and compiles exactly as it would without gradual locating.

v1 supports simple local type inference for initialized `let` and `const` declarations, `for` initializer `let` declarations, expression result types, function return types, and the locations left out inside a local function. General location inference, `any`, `undefined` and asynchronous execution are outside its scope.

---

## 1. Overview <a id="overview"></a>

### 1.1 Language Name <a id="language-name"></a>

- Language name: `ChoreoBS`
- Source file extension: `.cbs`
- Output file extension: `.bs`
- Compilation target: BlueScript

### 1.2 Design Goals <a id="design-goals"></a>

ChoreoBS v1 aims to:

- describe communication among multiple endpoints as a single choreography;
- statically track where values are located using explicit location annotations;
- let a program leave some locations to run time with `dyn`, and check those locations when it runs (spec [§3.5](#dyn));
- reduce annotation burden through simple local type inference;
- generate BlueScript endpoint programs for each endpoint;
- reduce send/receive mismatches through syntax, typing, and EPP rules.

### 1.3 Basic Example <a id="basic-example"></a>

```ts
let x: integer@alice = 10@alice;
let y: integer@bob <- x;
```

This program declares `x` as `integer@alice`, sends its value from `alice` to
`bob`, and stores the received value in `y`. Writing `let x = 10@alice;` would
infer the same type from the initializer (spec [§7.20.1](#let-type-inference)).

After EPP:

```ts
// workspace/alice/src/index.bs
let x: integer = 10;
sendInteger("bob", "__top_0", x);
```

```ts
// workspace/bob/src/index.bs
let y: integer = receiveInteger("alice", "__top_0");
```

A location left out altogether is `dyn` (spec [§8.2](#omitted-locations)): `let x = 10;` declares
`x : integer@dyn`, whose location is decided when the program runs. Inside a
local function it is the function's own location instead (spec [§7.20.8](#local-function-location-inference)).

***

## 2. Input and Output <a id="input-and-output"></a>

### 2.1 Input Files <a id="input-files"></a>

A ChoreoBS project is a directory that holds a `choreobs.json` configuration
file (spec [§2.2](#choreobs-json)) and the program. The program is always
`src/index.cbs`:

```text
project/
  choreobs.json
  src/
    index.cbs
  workspace/
```

`workspace/` is where the compiler writes its output (spec [§2.3](#output-files)).

The compiler finds the project from the directory it is run in: it looks for
`choreobs.json` there, and then in each parent directory in turn, and compiles
the `src/index.cbs` next to the first one it finds (spec [§2.4](#commands)).

The basename of the input file must not begin with `__` (spec [§16.52](#reserved-input-file-name)).
The compiler names the files it writes with that prefix, as it does the
identifiers it introduces (spec [§4.3](#identifiers)), and keeps the prefix out of the files it
is given. `src/index.cbs` keeps clear of it; the rule binds any other way of
handing the compiler a source file.

`src/` may also hold BlueScript source files, which the program imports
functions and constants from and which the compiler copies into the endpoints'
projects (spec [§2.5](#bluescript-source-files)).

### 2.2 `choreobs.json` <a id="choreobs-json"></a>

`choreobs.json` names the project, lists its endpoints with the BlueScript board
each one runs on and the BlueScript packages each one uses, and optionally says
whether an omitted location is `dyn` (spec [§8.3](#strict-mode)).

```json
{
  "name": "greeting",
  "endpoints": [
    { "name": "alice", "board": "host" },
    {
      "name": "bob",
      "board": "esp32",
      "deviceName": "BOB",
      "dependencies": { "thermo": "https://github.com/example/bs-thermo.git#v1.0.0" }
    }
  ]
}
```

```json
{
  "name": "greeting",
  "implicitDyn": false,
  "endpoints": [
    { "name": "alice", "board": "host" },
    { "name": "bob", "board": "host" }
  ]
}
```

#### Rules <a id="endpoint-rules"></a>

* `name` must be a non-empty string. It names the project; nothing in compilation depends on it.
* `endpoints` must be an array of objects, one per endpoint. An entry that is a bare string, such as `"alice"`, is an error: it is the format of earlier versions, which named an endpoint and nothing else.
* Each entry's `name` names one endpoint and defines an individual location.
* Each name is held in the value namespace for the whole program (spec [§6.1](#namespaces)): no function, variable or parameter may take an endpoint's name, whether or not the source ever writes `@` with it.
* Each name must be an identifier (spec [§4.3](#identifiers)) and must not be a reserved word (spec [§4.4](#keywords)). An endpoint name is written after `@` in the source (spec [§5.2](#types)) and is also the name of the endpoint's directory in the workspace (spec [§2.3](#output-files)): a name that is not an identifier would name an endpoint no program could refer to, and would still name a directory — `../x` would place it outside the workspace.
* A name must not begin with `__`, which is reserved for the compiler (spec [§4.3](#identifiers), [§6.2](#function-names)), on the same terms as every other identifier the source writes.
* The **reserved runtime names** of spec [§6.2](#function-names) that do not begin with `__` — the communication API names and `print` — are *not* reserved here. An endpoint name reaches the generated code only as a string literal (spec [§13.14](#communication-api)), as the end of the runtime's constant `__loc_<name>` (spec [§14.6](#location-and-kind-codes)), and as the name of a directory, never as a BlueScript identifier of its own, so it cannot capture a runtime function the way a variable of that name would.
* The names must be distinct. A repeated name is an error: it would give two endpoints the same directory, and make one endpoint both the sender and the receiver of the same communication.
* Two names must not differ only in case, as `Alice` and `alice` do. They are distinct identifiers, but a file system that ignores case — the default on macOS — would give them the same directory.
* `every` and `dyn` are reserved words and must not appear as names (spec [§16.2](#using-every-as-an-endpoint)). This is a special case of the reserved-word rule above, called out separately because `every` and `dyn` name the two locations that are deliberately never listed (spec [§3.4](#every), [§3.5](#dyn)).
* Every individual location used in a `.cbs` source file must be listed in `endpoints`. The locations `every` and `dyn` are never listed.
* Each entry's `board` must be `"esp32"` or `"host"`: the BlueScript board the endpoint's program runs on.
* Each entry may have a `deviceName`, and only an `"esp32"` entry may. It must be a non-empty string: the name the board goes by over Bluetooth, which `bscript` connects to. An `"esp32"` entry without one has BlueScript's default, `BLUESCRIPT`.
* No two `"esp32"` entries may have the same device name, counting a missing one as `BLUESCRIPT`: nothing would decide which board runs which endpoint's program.
* Each entry may have `dependencies`: the BlueScript packages the endpoint uses (spec [§2.6](#bluescript-packages)). It is an object from each package's name to where the package comes from, in the form of the `dependencies` of a `bsconfig.json`, and may be empty.
  * A package's name begins with a letter, a digit or `_`, and goes on with letters, digits, `_`, `.` and `-`. It is written at the start of a BlueScript import, where a leading `.` would make it a relative path and a `/` would end it, and it names the package's directory in `packages/`.
  * The name must be the package's own `projectName`: `bscript` installs a package under that name, whatever the key says (spec [§2.4](#commands)).
  * Two names must not differ only in case: a file system that ignores case would give them one directory.
  * A package comes from a git URL, optionally followed by `#` and the tag or branch to check out, as in `"https://github.com/example/bs-thermo.git#v1.0.0"`. The string has at most one `#`, with something on each side of it.
* `implicitDyn` is optional. When present it must be a boolean (spec [§16.51](#invalid-implicit-dyn)). It defaults to `true`, under which an omitted location that nothing infers is `dyn`; `false` selects strict mode, under which that omission is an error (spec [§8.3](#strict-mode)).
* The compiler generates a program for each endpoint listed in `endpoints`, even if that endpoint is not used in the source.

### 2.3 Output Files <a id="output-files"></a>

The compiler writes into a BlueScript workspace, `workspace/`, next to
`choreobs.json`. The workspace holds one BlueScript project per endpoint, in a
directory named after the endpoint:

```text
project/
  choreobs.json
  src/
    index.cbs
  workspace/
    bsworkspace.json
    alice/
      bsconfig.json
      src/
        index.bs
        __runtime.bs
    bob/
      bsconfig.json
      packages/
        thermo/
      src/
        index.bs
        __runtime.bs
```

The workspace and its projects are made by BlueScript's own command-line tool,
`bscript`, which `choreobs create` and `choreobs add-endpoint` run
(spec [§2.4](#commands)). The compiler reads `bsworkspace.json` and each `bsconfig.json`, and
never writes them, so whatever `bscript` keeps there survives compilation. Nor
does it write into a project's `packages/`, where `bscript` installs the
packages the endpoint uses (spec [§2.6](#bluescript-packages)).

For each endpoint, the compiler writes these files into its project:

* the endpoint's program, at the project's entry file: the `entryFile` of its
  `bsconfig.json`, or `./index.bs`, BlueScript's default, when there is none.
  `bscript project create` sets it to `./src/index.bs`;
* the endpoint's runtime file, `__runtime.bs`, in the same directory as the
  program (see below);
* a copy of each BlueScript source file that goes to the endpoint, at the same
  path below the program's directory as the file has below `src/`
  (spec [§2.5](#bluescript-source-files)).

A missing directory on the way to them is created. These files are written anew
on every compilation; nothing else in the project is touched. A copy of a
source file that has since been removed from `src/` is left where it is: no
program imports it any more.

Before it writes anything, the compiler checks the workspace against
`choreobs.json`. If a check fails it reports an error and writes nothing:

* `workspace/bsworkspace.json` must exist.
* Each endpoint must have its project: `workspace/<endpoint>/bsconfig.json`,
  with `projectName` equal to the endpoint's name and `boardName` equal to its
  `board`. `bscript` delivers a message by project name, so the project name is
  what makes `sendInteger("bob", …)` reach `bob` (spec [§13.14](#communication-api)).
* Each endpoint's project must be registered in `bsworkspace.json`, and for an
  `"esp32"` endpoint with the endpoint's device name, counting a missing one on
  either side as `BLUESCRIPT`.
* Each endpoint's project must have the packages `choreobs.json` lists for the
  endpoint, and no others, each for the endpoint's board (spec [§2.6](#bluescript-packages)).
* No other project registered in the workspace may have an endpoint's name as
  its `projectName`, where a message for that endpoint could reach it instead,
  nor, for an `"esp32"` endpoint, its device name, where `bscript` could connect
  to the wrong board.
* The entry file's name must not begin with `__`, which would let a runtime
  file overwrite the program, and the entry file must lie under the project's
  `srcDir` (`.` when there is none), as BlueScript requires of every source
  file.
* No copy of a source file may land on the entry file, as a copy of
  `src/index.bs` would when the entry file is `./src/index.bs`. The paths are
  compared without regard to case, as a file system that ignores case would
  compare them.

A project registered in the workspace that is no endpoint's is left alone, with
a warning: `choreobs run` leaves it out, but `bscript workspace run` on its own
still runs it.

Compilation never runs `bscript`. A missing project or registration is made
with `choreobs add-endpoint` (spec [§2.4](#commands)), the packages are put in step with
`choreobs install`, and the programs are run with `choreobs run`.

#### Runtime Files <a id="runtime-files"></a>

The generated code relies on names the compiler defines itself — helper
functions and, for `dyn`, the class `__DynVal`. The compiler writes them into
each endpoint's runtime file, `__runtime.bs`, and the endpoint's program imports
what it uses from there (spec [§13.10](#runtime-import)).

A runtime file has two parts, in this order:

1. the **core helpers** — `__nothing1` to `__nothing5` (spec [§14.1](#nothing)), `__and`
   and `__or` (spec [§14.3](#and-or-helpers)), and the copy helper `__copyArray`
   (spec [§14.4](#copy-array-helper)). They are in every runtime file;
2. the **dynamic-location runtime** (spec [§14.5](#dyn-runtime)). It is there only for a program
   that uses `dyn` — whether written or produced by an omission (spec [§8.2](#omitted-locations)).

A profiling build puts a third part before them, and counts events in the other
two (spec [§13.17](#profiling-build)).

* A runtime file is written for **every** endpoint on every compilation, whether
  or not the endpoint's program imports from it. BlueScript compiles only the
  files a program imports, so an unused runtime file costs nothing, and a
  runtime file left over from an earlier compilation can never fall out of
  step with the program. A program can import from it without calling
  anything — `function f(a: integer@dyn): void {}` imports `__DynVal` alone.
* Every endpoint's file has the same parts. Whether the dynamic-location runtime
  is there is decided for the program, not for each endpoint: a `dyn` value lives
  at all of them.
* The files differ only in the comment at the top of the file, which names their
  endpoint, and, where the dynamic-location runtime is there, in the constant
  `__here`, which holds its code (spec [§14.10](#location-functions)).
* The dynamic-location runtime opens with a constant for each location, which
  numbers the endpoints in the order `choreobs.json` lists them
  (spec [§14.6](#location-and-kind-codes)). Every file of a compilation is written from the same list, so
  they agree; reordering the endpoints renumbers them all at once.
* Every top-level declaration of the file is a function, a class, or an
  `integer` constant. None holds a value the garbage collector traces
  (spec [§14.6](#location-and-kind-codes)). A profiling build adds its counters, `integer` and
  `float` variables, which hold no traced value either (spec [§13.17](#profiling-build)).
* Every function, class and constant the generated code uses is exported, and
  imported by name (spec [§13.10](#runtime-import)).
* Every name in the file begins with `__`, the internal helpers included
  (`__root`, `__copyPayload`, `__sendAny`, …), so that nothing depends on how
  BlueScript scopes a module's names (spec [§6.2](#function-names)).
* A program without `dyn` gets the core helpers alone: nothing in its output
  depends on gradual locating.
* The communication API and BlueScript's `print` are not in the runtime file.
  They belong to BlueScript's standard library, which every program has without
  importing it (spec [§14](#runtime-support-functions)).

### 2.4 Commands <a id="commands"></a>

The compiler's command-line tool is `choreobs`. It has five commands. Each one
that works on an existing project finds it as compilation does: it looks for
`choreobs.json` in the directory it is run in, and then in each parent
directory (spec [§2.1](#input-files)).

#### `choreobs create <name>` <a id="choreobs-create-name"></a>

Creates a new project in a new directory `<name>`:

* `choreobs.json`, with `name` set to `<name>` and no endpoints;
* an empty `src/index.cbs`;
* the workspace, made by running `bscript workspace create workspace` in the
  new directory.

`<name>` must be the name of one directory — not empty, not `.` or `..`, and
without `/` or `\` — and that directory must not exist. If `bscript` fails,
the directory is left as it is, and `choreobs add-endpoint` makes the
workspace later.

#### `choreobs add-endpoint <name> [-b <board>] [-d <device-name>]` <a id="choreobs-add-endpoint-name-b-board-d-device-name"></a>

Adds an endpoint, and makes its BlueScript project:

1. The endpoint `{ "name": <name>, "board": <board>, "deviceName": <device-name> }`
   must keep `choreobs.json` valid (spec [§2.2](#choreobs-json)). Without `-b`, the board is
   asked for interactively; without a terminal to ask on, that is an error.
2. Each of these is run only when what it makes is missing:
   * `bscript workspace create workspace`, in the project directory, when
     there is no `workspace/`;
   * `bscript project create <name> -b <board>`, in `workspace/`, when there is
     no `workspace/<name>/`;
   * `bscript workspace add <name>`, in `workspace/`, with `-d <device-name>`
     when a device name is given, when the project is not registered;
   * `bscript project install`, in `workspace/<name>/`, for each package
     `choreobs.json` lists for the endpoint that the project does not have as
     listed, as `choreobs install` runs it.
3. The endpoint is added to the end of `endpoints` in `choreobs.json`. The
   file's other keys are kept, in their order.

What is already there is taken over when it agrees with the endpoint: a
`workspace/<name>/` whose `bsconfig.json` has the endpoint's name as
`projectName` and its board as `boardName`, and a registration with the
endpoint's device name. Everything is checked before `bscript` is run at all,
and anything that disagrees stops the command: a project of another name or
board, a registration with another device name, a `workspace/` without
`bsworkspace.json`, a `workspace/<name>/` without `bsconfig.json`, another
registered project with the endpoint's name as its `projectName`, or another
registered `esp32` project with the endpoint's device name, or a package
installed as `choreobs.json` lists it but for another board. A package the
project has that `choreobs.json` does not list is left where it is:
`choreobs install` removes it.

For an endpoint that `choreobs.json` already lists, `add-endpoint` repairs its
project instead: it runs the steps of 2 that are missing, with the board and
device name `choreobs.json` gives, asks nothing, and leaves `choreobs.json` as
it is. A `-b` or `-d` that disagrees with `choreobs.json` is an error. This is
how a workspace that was never committed is made again, one endpoint at a time.

#### `choreobs install` <a id="choreobs-install"></a>

Gives each endpoint's project the packages `choreobs.json` lists for the
endpoint, and no others (spec [§2.6](#bluescript-packages)). For each endpoint, in the order `endpoints`
lists them, it runs in `workspace/<endpoint>/`:

1. `bscript project uninstall <name>` for each package the project's
   `bsconfig.json` lists and `choreobs.json` does not;
2. `bscript project install <url>`, with `-t <tag>` when the package's string
   ends in `#<tag>`, for each package `choreobs.json` lists that the project
   does not have as listed: one its `bsconfig.json` does not list, lists with
   another string, or that is not in `packages/<name>/`.

* Every endpoint must have its project, agreeing with `choreobs.json` as
  `choreobs add-endpoint` requires; a missing one is made with
  `choreobs add-endpoint`. Everything is checked before `bscript` runs at all,
  and a package installed as listed but for another board stops the command:
  installing it again cannot help.
* `bscript` installs a package under its own `projectName`. When that is not
  the name `choreobs.json` gives it, the command stops and says which name to
  write; the next `choreobs install` removes the package it installed under the
  other name.
* With nothing to do, it runs no `bscript` at all.

#### `choreobs compile [--profile]` <a id="choreobs-compile"></a>

Compiles the project's `src/index.cbs` and writes the output into the
workspace (spec [§2.3](#output-files)), printing the path of each file it writes, the copies of
the BlueScript source files included (spec [§2.5](#bluescript-source-files)). It never runs `bscript`.

* With `--profile`, what it writes is a profiling build (spec [§13.17](#profiling-build)).

#### `choreobs run [--stats] [--profile]` <a id="choreobs-run-stats"></a>

Compiles and writes the project as `choreobs compile` does, without printing
the paths, and then runs every endpoint's program together:
`bscript workspace run <endpoint>…` in `workspace/`, with the name of every
endpoint in `endpoints`.

* With `--stats`, it runs `bscript workspace run --stats <endpoint>…`
  instead, which prints the execution time, the CPU time and the memory
  statistics of each endpoint when it finishes.
* With `--profile`, what it writes and runs is a profiling build
  (spec [§13.17](#profiling-build)): each endpoint prints a report when its program ends. The
  two options may be given together, in either order.

* Naming the endpoints keeps a project registered in the workspace that is no
  endpoint's from running (spec [§2.3](#output-files)).
* Nothing runs when compilation fails, when the workspace disagrees with
  `choreobs.json`, or when there is no endpoint. That `bscript` is there is
  checked before anything is written.
* The command ends when `bscript workspace run` does, and fails when it fails.

```bash
choreobs create greeting
cd greeting
choreobs add-endpoint alice -b host
choreobs add-endpoint bob -b esp32 -d BOB
choreobs run
```

### 2.5 BlueScript Source Files <a id="bluescript-source-files"></a>

A **BlueScript source file** of a project is a file under `src/` whose name ends
in `.bs`, in `src/` itself or in a directory below it. The program imports
functions and constants from them (spec [§5.19](#import-declarations)), and the compiler copies them into
the endpoints' projects. A file whose name does not end in `.bs`, and a
symbolic link, is not a source file: it is neither read nor copied.

```text
project/
  choreobs.json
  src/
    index.cbs
    clock.bs
    sensor@alice.bs
    filters/
      smooth.bs
```

#### Names <a id="bluescript-source-file-names"></a>

* Each name on the path of a source file below `src/` — each directory, and
  the file's name without `.bs` — begins with a letter or `_` and goes on with
  letters, digits, `_` and `-` (spec [§16.64](#invalid-bluescript-file-name)). BlueScript turns each source file
  into a C file and a target of a Makefile, where a space, `%`, `$`, `#` or `:`
  would break the build, and it rejects a source file whose name is only
  digits.
* No name on the path begins with `__`, which is reserved for the compiler, as
  it is for the input file (spec [§16.52](#reserved-input-file-name)): the runtime file is `__runtime.bs`.
* A file's name may end, before `.bs`, in `@` and the name of an endpoint, as
  `sensor@alice.bs` does. Such a file is **endpoint-specific**: it goes to that
  endpoint alone, and only an import at that endpoint may import from it
  (spec [§5.19](#import-declarations)). Every other source file is **shared**: it goes to every endpoint,
  and an import at any endpoint may import from it.
* The endpoint after `@` must be one `choreobs.json` lists: not `every`, not
  `dyn`. A name with two `@`s, with nothing before its `@`, or with `@` in a
  directory's name is an error (spec [§16.64](#invalid-bluescript-file-name)).
* No two source files have paths that differ only in case, as `Clock.bs` and
  `clock.bs` do: a file system that ignores case would give them the same copy.

Every source file is held to these rules, whether or not the program imports
from it, because every source file is copied.

#### Copies <a id="bluescript-source-file-copies"></a>

Each endpoint's project gets a copy of every shared source file and of every
source file specific to that endpoint (spec [§2.3](#output-files)). A copy has the same path
below the directory of the endpoint's program — the directory of its entry file,
which also holds its runtime file — as the source file has below `src/`. With
the entry file `./src/index.bs`, `bscript project create`'s default, the example
above gives:

```text
workspace/
  alice/
    src/
      index.bs
      __runtime.bs
      clock.bs
      sensor@alice.bs
      filters/
        smooth.bs
  bob/
    src/
      index.bs
      __runtime.bs
      clock.bs
      filters/
        smooth.bs
```

An import names a file relative to `src/index.cbs` (spec [§5.19](#import-declarations)), and BlueScript
resolves the same name relative to the program, so the name finds the copy.
A copy holds the source file's text unchanged. The compiler checks only the
source files the program imports, and only as spec [§7.21](#imported-signatures) says; the rest are
copied without being looked into. A source file may itself import from other
source files and from packages (spec [§2.6](#bluescript-packages)), which BlueScript resolves from its copy.

### 2.6 BlueScript Packages <a id="bluescript-packages"></a>

An endpoint can use BlueScript packages: BlueScript projects kept in git
repositories, which `bscript project install` downloads into a project's
`packages/` directory. The packages each endpoint uses are listed under its
`dependencies` in `choreobs.json` (spec [§2.2](#choreobs-json)):

```json
{
  "name": "greenhouse",
  "endpoints": [
    {
      "name": "sensor",
      "board": "esp32",
      "dependencies": { "thermo": "https://github.com/example/bs-thermo.git#v1.0.0" }
    },
    { "name": "host", "board": "host" }
  ]
}
```

`choreobs.json` is the record of them. The workspace is not kept with the
project, and is made again from `choreobs.json` by `choreobs add-endpoint` and
`choreobs install` (spec [§2.4](#commands)). Each endpoint's project holds the packages its
entry lists, and no others:

* Its `bsconfig.json` lists the same packages under `dependencies`, each with
  the same string, as `bscript project install` writes it there.
* Each package is installed in `workspace/<endpoint>/packages/<name>/`, as a
  package whose `projectName` is `<name>`. A package that a listed package
  depends on is installed beside it, and is not listed.
* Each package is one for the endpoint's board: `bscript` builds an `"esp32"`
  project only with `"esp32"` packages, and a `"host"` project only with
  `"host"` ones.

`choreobs compile` checks all three before it writes anything (spec [§2.3](#output-files)).
`choreobs install` puts the first two right; for the third, `choreobs.json` must
list another package.

#### Importing a Package <a id="importing-a-package"></a>

A package is imported by a BlueScript source file (spec [§2.5](#bluescript-source-files)), as BlueScript
imports one: with the package's name, which names its entry file, or with the
name followed by a path below the package's `srcDir`. The program imports what
the source file exports:

```ts
// src/hardware/thermo@sensor.bs
import { Thermometer } from 'thermo';

const thermometer = new Thermometer(4);

export function readCelsius(): float {
  return thermometer.read();
}
```

```ts
// src/index.cbs
import@sensor { readCelsius } from "./hardware/thermo@sensor";

let t: float@sensor = readCelsius();
```

* The program does not import a package itself (spec [§16.61](#invalid-module-path)). A package
  mostly exports classes and enums, which the program cannot import
  (spec [§7.21](#imported-signatures)); a source file turns them into the functions and constants it can.
* The compiler does not look into a package, nor into any file a source file
  imports (spec [§7.21](#imported-signatures)). BlueScript resolves the import when the endpoint's
  program is built, and reports a package the endpoint's project does not have.
* A source file that imports a package is best made specific to an endpoint
  that lists the package, as `thermo@sensor.bs` is. A shared one is copied to
  every endpoint (spec [§2.5](#bluescript-source-files)), but BlueScript builds only the files a program
  imports, so the copy does no harm at an endpoint that does not import it.

***

## 3. Endpoints and Locations <a id="endpoints-and-locations"></a>

### 3.1 Endpoints <a id="endpoints"></a>

An **endpoint** is an agent that executes a program. The endpoints taking part in a
choreography are declared by the `endpoints` field of `choreobs.json` (spec [§2.2](#choreobs-json)).

A choreography is a single global program. The compiler projects it, by Endpoint
Projection (spec [§12](#endpoint-projection)), into one BlueScript program per endpoint.

### 3.2 Locations <a id="locations"></a>

A location denotes where a value is placed. ChoreoBS has the following kinds of
locations:

```text
Location           ::= ConcreteLocation | dyn
ConcreteLocation   ::= IndividualLocation | every
IndividualLocation ::= endpoint name
```

An **individual location** names exactly one endpoint. A **concrete location** is
either an individual location or `every`. The **dynamic location** `dyn` is the
one location that is not concrete: a value located at `dyn` has its location
decided at run time (spec [§3.5](#dyn)).

`every` and the individual locations are independent kinds of location. `every` is
not an individual location, and it does not name any particular endpoint.

Examples of concrete locations:

```text
alice
bob
sensor1
Controller
every
```

Of these, `alice`, `bob`, `sensor1`, and `Controller` are individual locations, and
`every` is not. `dyn` is a location, but not a concrete one.

### 3.3 Individual Locations <a id="individual-locations"></a>

Individual locations are defined by the `endpoints` field in `choreobs.json`.

```json
{
  "name": "example",
  "endpoints": [
    { "name": "alice", "board": "host" },
    { "name": "bob", "board": "host" },
    { "name": "sensor", "board": "host" }
  ]
}
```

In this example, the individual locations are:

```text
alice
bob
sensor
```

### 3.4 `every` <a id="every"></a>

`every` is a special location.

A value of type `T@every` means:

> All endpoints locally hold the same value of type `T`.

A `T@every` value is not a value at any individual location. It cannot be used
where a `T@alice` value is required; use `<-` to copy it to `alice` (spec [§7.6](#location-matching-and-residency),
[§11.4](#local-copy)).

Example:

```ts
let c: boolean@every = true@every;
```

This means all endpoints locally hold `c = true`.

For mutable arrays, `T[]@every` means that each endpoint has an independent local mutable array with the same contents. It is not shared memory.

A local copy of an `@every` array with `<-` creates a fresh mutable array at the destination (spec [§11.4](#local-copy)).

### 3.5 `dyn` <a id="dyn"></a>

`dyn` is the **dynamic location**. A value of type `T@dyn` is a **dynamically
located value**: where it is located is not fixed by the program text, but
decided while the program runs.

```ts
let x: integer@dyn = 3@dyn;
let y: integer@alice = x;      // checked at run time: binds x to alice
```

The base type of a `dyn` value is static like any other: only the location
component is gradual. Base type compatibility, array invariance and operator
applicability are checked at compile time exactly as for any value
(spec [§7.5](#subtyping), [§7.14](#operators), [§7.16](#array-typing)).

The payload of a `dyn` value is a BlueScript `any` (spec [§14.9](#dyn-val)), and the
dynamic operations work on it as an `any`. A `dyn` value, and every result of a
dynamic operation, is therefore limited as an array element is, and its `===`
and `!==` compare as an element's do (spec [§7.1.1](#array-types)).

In a choreography context, a `dyn` value may be placed wherever a location is
required, and a value at any location may be placed where `dyn` is required, as
long as the base types agree (spec [§7.7](#location-consistency-and-join)). Each such place is a coercion (spec [§7.8](#coercion)).
Placing a `dyn` value at a concrete location is a run-time location check — a
static location check deferred to run time — while placing a static value at
`dyn` only records where it is. A local function holds no `dyn` at all
(spec [§8.4](#local-function-strict-location-rule)).

#### Location Variables and Binding <a id="dyn-binding"></a>

At run time a dynamically located value is a **payload** together with a
**location variable** (spec [§14.9](#dyn-val)).

* A location variable is **bound** when it holds a concrete location, and
  **unbound** otherwise.
* Equality constraints between location variables are kept by union-find
  (spec [§14.7](#location-variables)). Two `dyn` values that meet in one operation are placed at one
  location: their classes become one, unless both are already bound, which
  they must then be to the same location. Binding one value of a class binds
  the whole class. This is what lets arrays and other compound uses of `dyn`
  stay gradual.
* A constraint that would place one class at two different concrete locations
  is a **location error**, and stops the program (spec [§7.9](#dynamic-operations), [§14.8](#location-errors)).

Which endpoints hold a meaningful payload depends on the state of the location
variable:

* bound to an individual location `p`: `p` alone is the logical owner and the
  only endpoint that uses the payload. The payload at any other endpoint is
  unspecified — `null` or a stale value — and is never read;
* bound to `every`: every endpoint holds its own, independent payload with the
  same contents, as for a `T@every` value (spec [§3.4](#every));
* unbound: every endpoint holds a copy of the same payload. The value is not
  logically at `every`, however; it has not been placed anywhere yet.

A payload that does not exist is `null`.

The payload is a BlueScript `any` (spec [§14.9](#dyn-val)) that always holds a value of the
value's **static** base type: the **representation** of that type, as later
sections call it. Values only ever flow between the same base type (spec [§7.5](#subtyping)), and a numeric
conversion produces a value of its target type (spec [§7.15](#numeric-conversion)), so this holds by
construction.

#### Location Dispatch <a id="location-dispatch"></a>

An operation that involves a `dyn` value is a **dynamic operation**
(spec [§7.9](#dynamic-operations)). It is emitted, in the same form, into every endpoint program, and
the endpoint that performs it is found at run time from the location variables
involved. Endpoint projection and cleanup never remove a dynamic operation
(spec [§12.2](#dyn-lowering)).

Every endpoint performs the same dynamic operations, in the same order and the
same number of times:

1. every branch condition in a choreography context is at `every` — a `dyn`
   condition is cast there (spec [§7.12](#if-condition-typing)) — so every endpoint takes the same branch;
2. a local function holds no `dyn` at all (spec [§8.4](#local-function-strict-location-rule));
3. endpoint projection keeps every dynamic operation at every endpoint.

Location variables are therefore never sent between endpoints, and need no
identity that endpoints agree on: the location variables that corresponding
operations create at different endpoints simply correspond.

### 3.6 Location Names <a id="location-names"></a>

* Location names follow the same lexical rules as ordinary identifiers.
* Location names may contain uppercase letters.
* A location name is held in the value namespace for the whole program, so no function, variable or parameter may take it (spec [§6.1](#namespaces), [§16.53](#err-name-already-held)).
* `every` and `dyn` are reserved.

***

## 4. Lexical Specification <a id="lexical-specification"></a>

### 4.1 Whitespace <a id="whitespace"></a>

The following characters are treated as whitespace:

```text
space
tab
carriage return
line feed
```

### 4.2 Comments <a id="comments"></a>

ChoreoBS supports TypeScript-style comments.

```ts
// line comment

/* block comment */
```

### 4.3 Identifiers <a id="identifiers"></a>

Identifiers have the following form:

```text
Identifier ::= [A-Za-z_][A-Za-z0-9_]*
```

Reserved words cannot be used as ordinary identifiers, and identifiers beginning
with two underscores are reserved for the compiler (spec [§6.2](#function-names)).

### 4.4 Keywords <a id="keywords"></a>

The following words are reserved:

```text
function
let
const
if
else
while
for
return
true
false
null
every
dyn
integer
float
boolean
string
void
as
import
```

The following words are reserved as well. The features they name are not
supported in v1 (spec [§17](#non-goals-and-future-extensions)), but the words are still keywords, so using one is
reported as an unsupported feature rather than as an undefined name:

```text
break
continue
any
undefined
async
await
class
export
```

`from` is not reserved. It is read as `from` only where an import declaration
expects it (spec [§5.19](#import-declarations)), and is an ordinary identifier everywhere else.

### 4.5 Literals <a id="literals"></a>

#### Integer Literal <a id="integer-literal"></a>

```text
IntegerLiteral ::= [0-9]+
```

Examples:

```ts
123
0
42
```

#### Float Literal <a id="float-literal"></a>

```text
FloatLiteral ::= [0-9]+ "." [0-9]+
```

Examples:

```ts
1.0
3.14
0.5
```

#### Boolean Literal <a id="boolean-literal"></a>

```ts
true
false
```

#### String Literal <a id="string-literal"></a>

String literals use double quotes.

```ts
"hello"
"alice"
```

#### Null Literal <a id="null-literal"></a>

```ts
null
```

### 4.6 Operators and Punctuation <a id="operators-and-punctuation"></a>

The lexer recognizes the following tokens:

```text
+
-
*
/
%
<
<=
>
>=
===
!==
&&
||
!
=
<-
@
:
;
,
.
(
)
{
}
[
]
```

`==` and `!=` are not supported in v1.

`.` introduces the two array operations, `xs.length` and `xs.push(v)`
(spec [§5.15](#expressions)). It is not general property access: those two names are the whole
set, and ChoreoBS has no objects to access fields of (spec [§17.2](#typescript-javascript-features)).

A float literal's dot is consumed by the literal rule (spec [§4.5](#literals)), which takes
`.` only when a digit follows, so `xs.length` lexes as three tokens and `1.5` as
one.

#### Maximal Munch and `<-` <a id="maximal-munch-and-transfer"></a>

Tokens are formed by maximal munch over the raw character stream, so the
character immediately following `<` decides the token. `a<-b` is therefore a
transfer, not a comparison against `-b`. Write a space to compare against a
negated operand:

```ts
a <- b      // transfer
a < -b      // comparison with -b
```

***

## 5. Syntax <a id="syntax"></a>

This section defines the grammar in an EBNF-like notation.

### 5.1 Program <a id="program"></a>

```ebnf
Program ::= ImportDeclaration* TopLevelItem*
```

```ebnf
TopLevelItem ::= FunctionDeclaration
               | Statement
```

Top-level statements are executed in an implicit choreography context.
Import declarations come before every function declaration and statement
(spec [§5.19](#import-declarations)).

### 5.2 Types <a id="types"></a>

```ebnf
Type ::= NonLocatedType LocationAnnotation?
```

A type written without its `LocationAnnotation` takes its location from an
initializer where there is one (spec [§7.20.1](#let-type-inference)) or, as the return type of a
choreography function, from its `return` statements (spec [§7.20.4](#function-return-type-inference)). Inside a local
function it otherwise takes the function's location (spec [§7.20.8](#local-function-location-inference)). Elsewhere it is
otherwise `dyn`, or an error in strict mode (spec [§8.2](#omitted-locations)).

```ebnf
NonLocatedType ::= BaseType
                 | ArrayType
```

```ebnf
BaseType ::= "integer"
           | "float"
           | "boolean"
           | "string"
           | "null"
           | "void"
```

```ebnf
ArrayType ::= BaseType "[" "]"
```

The grammar admits an array of any base type, and admits only one `[` `]`: a
nested array is rejected by the grammar (spec [§16.30](#nested-array)). Which element types are
actually supported is a typing rule, not a syntactic one, so `string[]`,
`null[]` and `void[]` parse and are then rejected by the type checker
(spec [§7.1.1](#array-types), [§16.29](#unsupported-array-element-type)). Keeping it here would only turn a clear type error into a
syntax error.

```ebnf
LocationAnnotation ::= "@" Location
```

```ebnf
Location ::= Identifier | "every" | "dyn"
```

`void` is the one base type that takes no `LocationAnnotation`, `@dyn` included,
and it may only appear as a function return type (spec [§7.3](#void), [§16.43](#invalid-use-of-void)).

Arrays are mutable reference values. ChoreoBS v1 supports only one-dimensional arrays whose element type is `integer`, `float`, or `boolean`.

The following array types are not supported:

```text
string[]
null[]
void[]
integer[][]
float[][]
boolean[][]
```

### 5.3 Function Declaration <a id="function-declaration"></a>

```ebnf
FunctionDeclaration ::=
  "function" Identifier ("@" Location)? "(" ParameterList? ")" FunctionReturnType? Block
```

```ebnf
FunctionReturnType ::= ":" Type
```

The two forms of the production are the two kinds of function (spec [§10.1](#function-kinds)): a
declaration carrying a location is a local function, and one carrying none is a
choreography function. A function location must be an individual location:
neither `@every` nor `@dyn` is one (spec [§16.41](#every-on-a-function-declaration), [§16.42](#dyn-on-a-function-declaration)). A declaration
without a location is a choreography function, never a `dyn` one.

The return type annotation may be omitted. When omitted, the return type is inferred according to [Section 7.20](#type-inference).
A choreography function may also write the base type of its return type and omit only
the location, which is then inferred from its `return` statements (spec [§7.20.4](#function-return-type-inference)).

```ebnf
ParameterList ::= Parameter ("," Parameter)*
```

```ebnf
Parameter ::= Identifier ":" Type
```

Examples:

```ts
function add@alice(a: integer@alice, b: integer@alice): integer@alice {
    return a + b;
}
```

```ts
function addInferred@alice(a: integer@alice, b: integer@alice) {
    return a + b;
}
```

```ts
function main(x: integer@alice): void {
    return;
}
```

### 5.4 Blocks <a id="blocks"></a>

```ebnf
Block ::= "{" Statement* "}"
```

### 5.5 Statements <a id="statements"></a>

```ebnf
Statement ::= LetStatement
            | ConstStatement
            | AssignmentStatement
            | TransferStatement
            | IfStatement
            | WhileStatement
            | ForStatement
            | ReturnStatement
            | ExpressionStatement
```

### 5.6 Let Statement <a id="let-statement"></a>

```ebnf
LetStatement ::= "let" Identifier TypeAnnotation? "=" Expression ";"
               | "let" Identifier ":" Type "<-" Expression ";"
TypeAnnotation ::= ":" Type
```

Uninitialized `let` declarations are not allowed in v1.

For ordinary initialized `let` declarations using `=`, the type annotation may be omitted and inferred from the right-hand side according to [Section 7.20](#type-inference).

For transfer declarations using `<-`, the type annotation is still required. The
destination type and location of a transfer declaration are never inferred from
its source (spec [§7.20.3](#transfer-let-does-not-infer-destination-type)); a destination written without its location is
`dyn` (spec [§8.2](#omitted-locations)), or the function's location inside a local function
(spec [§7.20.8](#local-function-location-inference)).

Allowed:

```ts
let x: integer@alice = 1@alice;
let y = x + 1@alice;
let z: integer@bob <- x;
let w: integer <- x;        // w : integer@dyn
```

In strict mode `w` is an error (spec [§8.3](#strict-mode)).

Disallowed:

```ts
let x: integer@alice;
let y <- x;
```

### 5.7 Const Statement <a id="const-statement"></a>

```ebnf
ConstStatement ::= "const" Identifier TypeAnnotation? "=" Expression ";"
                 | "const" Identifier ":" Type "<-" Expression ";"
```

A `const` declaration declares a variable that is never stored into again. In
every other respect it is a `let` declaration: it must be initialized, its type
annotation may be omitted under the same rules (spec [§7.20](#type-inference)), a transfer declaration
with `<-` still requires one (spec [§7.20.3](#transfer-let-does-not-infer-destination-type)), and it is scoped (spec [§6.4](#variable-scope)) and
projected (spec [§12.9](#let-projection)) as a `let` is. What this specification says of a `let`
declaration it says of a `const` declaration too, unless it names `const`.

One rule does: a `const` declared by a top-level statement is a top-level
constant, which function bodies see as well (spec [§6.6](#top-level-let)), while a top-level `let`
is seen at top level only. A function may not be called before a top-level
constant it uses is initialized (spec [§6.7](#top-level-constant-initialization-order)).

A `const` variable may not be the target of an assignment, in an assignment
statement (spec [§5.8](#assignment-statement)) or in a `for` header (spec [§5.12](#for-statement)), nor the destination of a
transfer statement (spec [§5.9](#transfer-statement)). Either is a compile-time error (spec [§16.56](#assignment-to-a-constant)).

Only the binding is constant. An array held in a `const` variable is the same
mutable array value as any other (spec [§7.1.1](#array-types)), so its elements may still be assigned
and pushed to.

There are no literal types: `const x = 1@alice;` declares `x : integer@alice`,
as `let x = 1@alice;` does.

A `for` header declares its variable with `let` only (spec [§5.12](#for-statement)).

Allowed:

```ts
const x: integer@alice = 1@alice;
const y = x + 1@alice;
const z: integer@bob <- x;
const xs: integer[]@alice = [1, 2]@alice;
xs[0@alice] = 10@alice;
xs.push(3@alice);
```

Disallowed:

```ts
const x: integer@alice = 1@alice;
x = 2@alice;
```

```ts
const x: integer@alice;
```

### 5.8 Assignment Statement <a id="assignment-statement"></a>

```ebnf
AssignmentStatement ::= AssignmentTarget "=" Expression ";"
```

```ebnf
AssignmentTarget ::= Identifier
                   | Identifier "[" Expression "]"
```

The left-hand side must be either an identifier or a single-level array element target of the form `Identifier[Expression]`.

An identifier target must not name a `const` variable (spec [§5.7](#const-statement)). An element target
may: the array changes, not the variable that holds it.

General lvalues such as `f()[i]`, `xs[i][j]`, and property assignments are not supported.

```ts
x = y + 1@alice;
xs[0@alice] = 10@alice;
```

### 5.9 Transfer Statement <a id="transfer-statement"></a>

```ebnf
TransferStatement ::= Identifier "<-" Expression ";"
```

```ts
y <- x;
```

The destination must not be a `const` variable (spec [§5.7](#const-statement)).

### 5.10 If Statement <a id="if-statement"></a>

```ebnf
IfStatement ::= "if" "(" Expression ")" Block ("else" Block)?
```

`if` is a statement, not an expression.

### 5.11 While Statement <a id="while-statement"></a>

```ebnf
WhileStatement ::= "while" "(" Expression ")" Block
```

### 5.12 For Statement <a id="for-statement"></a>

Only C-style `for` loops are supported in v1.

```ebnf
ForStatement ::=
  "for" "(" ForInit? ";" Expression ";" ForUpdate? ")" Block
```

The condition is required. An omitted one would have to mean an implicit `true`,
and outside a local function a literal takes no location from its context
(spec [§8.1](#explicit-location-annotations)): it would be `true@dyn`, which turns a plain loop into one checked at
run time on every iteration. `while (true@every)` expresses an unbounded loop
explicitly instead.

```ebnf
ForInit ::= LetStatementNoSemicolon
          | AssignmentStatementNoSemicolon
```

```ebnf
ForUpdate ::= AssignmentStatementNoSemicolon
```

```ebnf
LetStatementNoSemicolon ::=
  "let" Identifier TypeAnnotation? "=" Expression
```

A `for` header declares its variable with `let` only; `const` is not allowed
there (spec [§16.57](#const-in-a-for-header)). The update is where a header's variable changes, and it
could not assign a `const` one (spec [§5.7](#const-statement)).

```ebnf
AssignmentStatementNoSemicolon ::=
  AssignmentTarget "=" Expression
```

An assignment in a `for` header takes the same targets an assignment statement
does (spec [§5.8](#assignment-statement)), so an array element may be assigned there too:

```ts
let xs: integer[]@every = [1, 2, 3]@every;
for (let i = xs.length; i > 0@every; xs[i] = 0@every) {
    i = i - 1@every;
}
```

Example:

```ts
for (let i = 0@every; i < 10@every; i = i + 1@every) {
    // body
}
```

The type annotation in a `for` initializer `let` may be omitted and inferred from the initializer expression according to [Section 7.20](#type-inference).

The following forms are not supported in v1:

```ts
for (x of xs) {
}
```

```ts
for (k in obj) {
}
```

### 5.13 Return Statement <a id="return-statement"></a>

```ebnf
ReturnStatement ::= "return" Expression? ";"
```

`return;` is allowed only when the function return type is `void`, or when an omitted function return type is inferred as `void`.

`return` may appear only inside a function body. The implicit top-level context
(spec [§6.5](#top-level-statements)) has nothing to return from, so a top-level `return` is an error even
though that context behaves like a `void` function in every other respect.

### 5.14 Expression Statement <a id="expression-statement"></a>

```ebnf
ExpressionStatement ::= Expression ";"
```

### 5.15 Expressions <a id="expressions"></a>

```ebnf
Expression ::= LogicalOrExpression
```

```ebnf
LogicalOrExpression ::= 
  LogicalAndExpression ("||" LogicalAndExpression)*
```

```ebnf
LogicalAndExpression ::= 
  EqualityExpression ("&&" EqualityExpression)*
```

```ebnf
EqualityExpression ::= 
  RelationalExpression (("===" | "!==") RelationalExpression)*
```

```ebnf
RelationalExpression ::= 
  AdditiveExpression (RelationalTail | ConversionTail)*
```

```ebnf
RelationalTail ::= ("<" | "<=" | ">" | ">=") AdditiveExpression
```

```ebnf
ConversionTail ::= 
  "as" NumericType (("*" | "/" | "%") UnaryExpression)* (("+" | "-") MultiplicativeExpression)*
```

```ebnf
NumericType ::= "integer" | "float"
```

`as` is a numeric conversion (spec [§7.15](#numeric-conversion)). As in TypeScript, it shares the
level of the relational operators and associates to the left, so `a + b as float`
is `(a + b) as float` and `x as float < y` is `(x as float) < y`. Also as in
TypeScript, a conversion is the left operand of any `* / %` and then `+ -` that
follow it: `x as float * 2.0 + 1.0` is `((x as float) * 2.0) + 1.0`. What follows
`as` is a bare numeric base type: `x as float[]`, `x as float@bob` and
`x as boolean` are syntax errors (spec [§16.54](#invalid-numeric-conversion)).

```ebnf
AdditiveExpression ::= 
  MultiplicativeExpression (("+" | "-") MultiplicativeExpression)*
```

```ebnf
MultiplicativeExpression ::= 
  UnaryExpression (("*" | "/" | "%") UnaryExpression)*
```

```ebnf
UnaryExpression ::= ("!" | "-") UnaryExpression
                  | PostfixExpression
```

```ebnf
PostfixExpression ::= PrimaryExpression PostfixOp*
```

```ebnf
PostfixOp ::= "[" Expression "]"
```

```ebnf
PrimaryExpression ::= Literal
                    | ArrayLiteral
                    | LengthExpression
                    | PushExpression
                    | PrintExpression
                    | Identifier
                    | FunctionCall
                    | "(" Expression ")"
```

```ebnf
LengthExpression ::= Identifier "." "length"
```

```ebnf
PushExpression ::= Identifier "." "push" "(" Expression ")"
```

`.length` and `.push` are the two array member operations, not postfix
operators: the receiver of each is an `Identifier`. `f().length`,
`xs.length.length`, `(xs).push(v)` and `xs[0].push(v)` are therefore syntax
errors, and so is any other member name (spec [§16.48](#invalid-array-operation-syntax)).

`xs.length` yields the length; `xs.push(v)` appends and yields nothing, so its
type is `void` (spec [§7.16](#array-typing)). Like a call to a `void` function, it can only
stand as an expression statement — every value position rejects it
(spec [§7.2](#located-types), [§16.43](#invalid-use-of-void)).

```ts
xs.push(1@alice);            // valid
let n = xs.push(1@alice);    // invalid — produces no value
```

```ebnf
PrintExpression ::= "print" "(" Expression ")"
```

`print(e)` writes the value of `e` to the output of the endpoints that hold it
(spec [§7.18](#print-typing)). It is a compiler-known operation, not a call: `print` followed by
`(` is always a `PrintExpression`, never a `FunctionCall`. `print` is not a
keyword, but it is a reserved name (spec [§6.2](#function-names)), so no function, variable or
parameter can take it. It takes exactly one argument; `print()` and
`print(a, b)` are syntax errors (spec [§16.55](#invalid-print-call)). Like `xs.push(v)`, it yields
nothing, and can only stand as an expression statement.

```ts
print(1@alice);              // valid
let n = print(1@alice);      // invalid — produces no value
```

```ebnf
FunctionCall ::= Identifier "(" ArgumentList? ")"
```

```ebnf
ArgumentList ::= Expression ("," Expression)*
```

```ebnf
ArrayLiteral ::= "[" ArgumentList? "]" LocationAnnotation?
```

### 5.16 Located Literals <a id="located-literals"></a>

Literals may have location annotations. A literal without one is located at `dyn`
(spec [§8.2](#omitted-locations)), unless it is a direct element of an annotated array literal
(spec [§5.17](#array-literals)); in strict mode it is an error instead. Inside a local function it is
located at the function's location (spec [§7.20.8](#local-function-location-inference)), in either mode.

```ebnf
Literal ::= RawLiteral LocationAnnotation?
```

```ebnf
RawLiteral ::= IntegerLiteral
             | FloatLiteral
             | StringLiteral
             | BooleanLiteral
             | NullLiteral
```

Examples:

```ts
1@alice
3.14@bob
"hello"@alice
true@every
null@alice
3@dyn
3                 // 3@dyn
```

### 5.17 Array Literals <a id="array-literals"></a>

Array literals are produced by the `ArrayLiteral` rule of [§5.15](#expressions).
This section gives their typing and elaboration rules.

Examples:

```ts
[1, 2, 3]@alice
[true, false]@bob
[]@alice
```

If an array literal has an explicit location annotation `@L`, unlocated literal
elements inside the array literal are elaborated as located at `L`.

This reaches the literal elements **directly** inside the brackets, and nothing
else. An element that is a compound expression is not elaborated, so a literal
inside it is an ordinary unlocated literal: `@dyn` (spec [§8.2](#omitted-locations)), or the function's
location inside a local function (spec [§7.20.8](#local-function-location-inference)):

```ts
[1, 2]@alice                   // static: both elements are direct literals
[1 + 0, 2]@alice               // `1 + 0` is 1@dyn + 0@dyn, cast to alice at run time
[1@alice + 0@alice, 2]@alice   // static
```

In strict mode the second literal is an error, since its `1` and `0` have no
location (spec [§8.3](#strict-mode)).

Example:

```ts
[1, 2, 3]@alice
```

is elaborated as:

```ts
[1@alice, 2@alice, 3@alice]@alice
```

**An array literal without a location annotation is located at `dyn`**, and its
direct literal elements are `@dyn` with it — except inside a local function,
where it is located at the function's location, and its elements with it
(spec [§7.20.8](#local-function-location-inference)). Its location is never taken from anywhere else: the
expected type of a `let` declaration, an assignment, a function argument or a
return does not supply one, and neither do the elements, even when they are all
located at the same place.

```ts
let arr: integer[]@alice = [1, 2, 3]@alice;   // static
let brr: integer[]@alice = [1, 3, 5];         // [1, 3, 5]@dyn, cast to alice

let a: integer@alice = 1@alice;
let b: integer@alice = 2@alice;
let xs = [a, b];                     // xs : integer[]@dyn, bound to alice at run time
let ys = [a, b]@alice;               // ys : integer[]@alice, static
```

The reason not to look at the elements, even in the case of `xs`, is that an
array is a value in its own right — it has a location of its own, not one
computed from what happens to be inside it — and outside a local function a
location is never inferred from context (spec [§8.1](#explicit-location-annotations)). Leaving the location out
therefore leaves it to run time. In strict mode an array literal without its
own annotation is an error (spec [§16.31](#array-literal-without-required-location)). A local function is different
because every value in it is at the function's location (spec [§8.4](#local-function-strict-location-rule)), so
an omission there leaves nothing open.

The element locations and the array's location must be pairwise consistent
(spec [§7.7](#location-consistency-and-join)): an element at `dyn` may stand in an array at a concrete location, and
the other way round, but two different concrete locations may not meet in one
literal (spec [§16.32](#array-literal-elements-across-locations)):

```ts
[a, d]@alice            // valid if d : integer@dyn — d is cast to alice
[1@alice, 2@bob]@dyn    // invalid: alice and bob in one literal
```

***

### 5.18 Evaluation Order <a id="evaluation-order"></a>

Evaluation is eager and left to right.

* The operands of a binary operator are evaluated left first, and both are
  always evaluated. This includes `&&` and `||`.
* The arguments of a call are evaluated left to right, and all of them before
  the call itself.
* In `xs[i]`, `xs` is evaluated before `i`.
* In an array literal, elements are evaluated left to right.
* In a simple assignment `x = e` and in a transfer, the right-hand side is
  evaluated before the store.
* In an array element assignment `xs[i] = e`, the receiver `xs` is evaluated
  first, then `i`, then `e`, and the store happens last. In v1 the
  receiver is always an identifier, so evaluating it has no effect of its own,
  but the order is defined this way for when it is generalized.
* In `xs.push(e)`, the receiver is evaluated first, then the argument, then the
  mutation. The expression itself yields nothing (spec [§7.16](#array-typing)).
* A `for` header evaluates its initializer once, then, on each iteration, the
  condition before the body and the body before the update.
* The arguments of the compiler-generated `nothing(...)` (spec [§14.1](#nothing)) are
  evaluated left to right, and each exactly once.
* A dynamic operation is a call to the runtime (spec [§12.2](#dyn-lowering)), and its arguments
  are the operands in the order above: `xs[i] = v` with `dyn` involved becomes
  `__dynArraySet(xs, i, v)`, and a `dyn` array literal appends its elements left
  to right.

There are no short-circuiting operators in v1. Unlike JavaScript and
BlueScript, `&&` and `||` evaluate their right operand even when the left one
already decides the result (spec [§7.14](#operators)). A guard such as

```ts
i < xs.length && xs[i] > 0@alice
```

therefore still evaluates `xs[i]` when `i` is out of range. A short circuit
would decide from a value that lives at one location whether the right operand
runs, and an endpoint that does not hold that value could not follow the
decision; evaluating both operands everywhere is what lets every endpoint agree
on which calls are made.

Order matters here more than it does in a single-endpoint language: an
expression may contain a call whose body communicates, so two endpoints that
evaluated the same expression in different orders would exchange messages in
different orders. The same holds for dynamic operations, which every endpoint
must perform in one order to add the same location constraints (spec [§3.5](#dyn)).
Every endpoint program therefore preserves this one order
(spec [§12.4](#expression-projection)). The dynamic `&&` and `||` do not short-circuit either
(spec [§14.12](#dyn-operators)).

### 5.19 Import Declarations <a id="import-declarations"></a>

```ebnf
ImportDeclaration ::=
  "import" "@" Location "{" ImportSpecifier ("," ImportSpecifier)* "}" "from" StringLiteral ";"
```

```ebnf
ImportSpecifier ::= ImportedName ("as" Identifier)?
```

```ebnf
ImportedName ::= Identifier | Keyword
```

An import declaration imports functions and constants from one of the
project's BlueScript source files (spec [§2.5](#bluescript-source-files)) to one endpoint. What it imports
belongs to that endpoint, as a local function does (spec [§6.8](#imported-names)).

```ts
import@alice { readSensor, threshold as limit } from "./sensor@alice";
import@bob { now as nowAtBob } from "./clock";
```

* The location names the endpoint, and must be an individual location, written
  after `import` as it is after `function` (spec [§5.3](#function-declaration)). An import with no
  location, or at `every` or `dyn`, is an error (spec [§16.60](#invalid-import-location)): an imported
  function runs at one endpoint, and an imported module is initialized at the
  endpoints that import it.
* Each specifier names a function or constant that the file exports
  (spec [§7.21](#imported-signatures)) and binds it to a name of the program: `name` binds it under its own
  name, `name as local` under `local`. The bound name must be an identifier. An
  exported name that is a ChoreoBS reserved word, such as `every`, can be
  imported only with `as`.
* The braces hold at least one specifier, and no comma follows the last.
* `from` is not a reserved word (spec [§4.4](#keywords)): it means `from` here only.
* The string names the file relative to `src/index.cbs`: `./`, then the names
  of the directories and of the file, separated by `/`, without `.bs`
  (spec [§16.61](#invalid-module-path)). BlueScript adds `.bs` to a module name itself, so `"./clock.bs"`
  would name `clock.bs.bs`. A name may not be empty, `.` or `..`: `src/index.cbs`
  is at the top of `src/`, so a path through `..` would leave it.
* A BlueScript package is not named here: a source file imports it, and the
  program imports from that source file (spec [§2.6](#bluescript-packages)).
* The file must exist, with every name in the case the string writes it
  (spec [§16.62](#imported-file-not-found)).
* An endpoint-specific file is named with its endpoint, `"./sensor@alice"` for
  `sensor@alice.bs`, and only an import at that endpoint may name it
  (spec [§16.63](#importing-another-endpoints-file)).
* No import declaration follows a function declaration or a statement, and
  none is written in a block (spec [§16.59](#misplaced-import-declaration)). BlueScript initializes every
  imported module before the program that imports it runs (spec [§6.8](#imported-names)), so the
  program reads in the order it runs.

***

## 6. Namespaces and Scopes <a id="namespaces-and-scopes"></a>

### 6.1 Namespaces <a id="namespaces"></a>

ChoreoBS has two namespaces:

* the **value namespace**, which holds location names, function names, and
  variable and parameter names together;
* type names / keywords, which are reserved words (spec [§4.4](#keywords)) and so can never
  be written as an identifier at all.

There is one value namespace rather than three because the generated code has
one. BlueScript keeps the source name (spec [§13.8](#codegen-function-names)), so a variable emitted
beside a function of the same name shadows it, and the call the program meant
to make would reach the variable instead. This is the same reasoning that
reserves the runtime names in spec [§6.2](#function-names), applied to the program's own names.

#### What holds a name, and for how long <a id="what-holds-a-name-and-for-how-long"></a>

* An **endpoint name** is declared in `choreobs.json` (spec [§2.2](#choreobs-json)) and holds its
  name for the whole program, whether or not the source ever writes `@` with
  it.
* A **function name** is global and hoisted (spec [§6.2](#function-names), [§6.3](#function-declaration-hoisting)), so it too holds
  its name for the whole program. So does the name of an imported function
  (spec [§6.8](#imported-names)).
* An **imported constant** is a top-level constant (spec [§6.8](#imported-names)): it holds its name
  as a variable does, below.
* A **variable or parameter name** is block-scoped (spec [§6.4](#variable-scope)). It may shadow
  another variable or parameter, but it may not take a name an endpoint or a
  function already holds. The scope of a top-level constant takes in every
  function body as well (spec [§6.6](#top-level-let)).

So the following are errors (spec [§16.53](#err-name-already-held)):

```ts
function alice@alice(): void {   // `alice` is an endpoint name
    return;
}
```

```ts
let bob: integer@alice = 1@alice;   // `bob` is an endpoint name
```

```ts
function g@alice(): integer@alice { return 1@alice; }

function h@alice(): integer@alice {
    let g: integer@alice = 5@alice;   // `g` is a function name
    return g + g();
}
```

The last one is the case the single namespace exists to prevent: with separate
namespaces `g` would read as the variable and `g()` as the function, and the
projection would emit a BlueScript body in which `g` is a number and `g()` is
not callable.

The rule is stated over the whole program, not over each generated file. A
function and a variable that would never be projected to the same endpoint are
still an error, on the same terms as the reserved runtime names of spec [§6.2](#function-names),
which are reserved everywhere and not only where the compiler happens to call
them.

Allowed — shadowing between variables is unaffected (spec [§6.4](#variable-scope)), and a name
merely resembling a held one is an ordinary name:

```ts
function alice2@alice(): integer@alice { return 1@alice; }

let aliceCount: integer@alice = alice2();
```

### 6.2 Function Names <a id="function-names"></a>

* Function overloading is not supported in v1.
* Function names are global: a name may be defined only once, whatever the functions' locations, and a choreography function may not share a name with a local one. An imported function (spec [§6.8](#imported-names)) is defined by its import, and its name may not be defined again.
* A function name is held in the value namespace (spec [§6.1](#namespaces)), so no variable or parameter may take it, and it may not be an endpoint name either.
* The **reserved runtime names** listed below cannot be used as a function name, a variable name, or a parameter name.

#### Reserved Runtime Names <a id="reserved-runtime-names"></a>

Generated BlueScript keeps the original ChoreoBS name (spec [§13.8](#codegen-function-names)), so a user
identifier that matches a name the generated code itself calls would capture
that call. The following are therefore reserved in every one of the three
positions:

* every communication API name (spec [§13.14](#communication-api)). These are
  `sendInteger`, `receiveInteger` and `broadcastInteger`, and the corresponding
  names for `Float`, `Boolean`, `String`, `Null` and `Array`. One `Array` API
  serves every array type (spec [§13.1](#type-mapping)), so names such as `sendIntegerArray` are
  not reserved. The copy helper is `__copyArray`, covered by the `__` prefix
  below, so `copyArray` is an ordinary name;
* `print` — BlueScript's output function, which the generated code calls for
  `print(e)` (spec [§7.18](#print-typing)). A program's own `print` would be emitted next to that
  call and capture it, as a program's own `sendInteger` would;
* `__array` and `__push` — compiler-internal call sentinels;
* every identifier beginning with `__`. EPP introduces names of its own, such as the `__transfer_N` temporaries that keep a transfer source to a single evaluation (spec [§7.11](#transfer-typing), [§12.10](#transfer-projection)), and reserving the prefix lets it do so without consulting the program. Every name in the runtime file is covered by the same prefix (spec [§2.3](#output-files)): the core helpers `__nothing1` to `__nothing5`, `__and`, `__or` and `__copyArray` (spec [§14.1](#nothing), [§14.3](#and-or-helpers), [§14.4](#copy-array-helper)), and the names of the dynamic-location runtime — `__DynVal`, `__LocVar`, `__inject`, `__cast`, the `__dyn…` operations, the location and kind constants `__loc_…` and `__kind_…`, `__here` and the runtime's internal helpers (spec [§14.5](#dyn-runtime), [§14.6](#location-and-kind-codes)).

These are reserved for variables and parameters too, not only for functions: a
variable emitted into the same BlueScript scope shadows the runtime function
just as a function of that name would replace it.

`length` and `push` are **not** reserved. They name array operations only after
a `.` (spec [§5.15](#expressions)), so nothing stops a program from also using them as
ordinary names:

```ts
function length@alice(xs: integer[]@alice): integer@alice {
    return xs.length;   // the operation, not a recursive call
}
```

`nothing` is **not** reserved either. The compiler's `nothing(...)` artifact is
emitted as the `__nothing…` helpers (spec [§13.7](#nothing-code-generation)), so a program's own `nothing` cannot
capture it.

Disallowed:

```ts
function __and@alice(): void { return; }     // takes the compiler's prefix
let sendInteger: integer@alice = 1@alice;    // shadows the runtime API
function f@alice(receiveFloat: integer@alice): void { return; }
function print@alice(): void { return; }     // captures `print(e)`
```

Disallowed:

```ts
function f@alice(): void {
    return;
}

function f@bob(): void {
    return;
}
```

### 6.3 Function Declaration Hoisting <a id="function-declaration-hoisting"></a>

Function declarations are visible throughout the whole file.

```ts
let x: integer@alice = f();

function f@alice(): integer@alice {
    return 1@alice;
}
```

This is allowed.

### 6.4 Variable Scope <a id="variable-scope"></a>

`let` and `const` variables are block-scoped.

```ts
if (c) {
    let x: integer@alice = 1@alice;
}
```

`x` is not visible outside the `if` block.

The same variable name must not be defined more than once in the same scope.

Disallowed:

```ts
let x: integer@alice = 1@alice;
let x: integer@alice = 2@alice;
```

A declaration in an inner block may shadow one from an outer block, and a `let`
or `const` in a function body may shadow a parameter. A parameter, or a `let`
or `const` in a function body, may likewise shadow a top-level constant
(spec [§6.6](#top-level-let)). Whether the shadowed
variable is a `const` does not matter: the inner declaration is a new variable,
and only its own keyword decides whether it may be assigned (spec [§5.7](#const-statement)).

Shadowing reaches variables and parameters only. A `let` or `const` may not shadow a
function name or an endpoint name: those are held for the whole program
(spec [§6.1](#namespaces)).

```ts
let x: integer@alice = 1@alice;

if (c) {
    let x: integer@alice = 2@alice;   // shadows the outer `x`
}
```

### 6.5 Top-Level Statements <a id="top-level-statements"></a>

Non-function top-level statements are treated as the body of an implicit choreography context.

Example:

```ts
let x: integer@alice = 1@alice;
let y: integer@bob <- x;
```

Conceptually, this is similar to:

```ts
function __top(): void {
    let x: integer@alice = 1@alice;
    let y: integer@bob <- x;
}
```

The implementation does not need to generate an actual function named `__top`.

The analogy stops at `return`: there is no function to return from, so `return`
is not allowed at top level (spec [§5.13](#return-statement)). It stops at top-level constants too:
function bodies see the constants the top level declares (spec [§6.6](#top-level-let)), as no
function could see the locals of a function `__top`.

### 6.6 Top-Level Let and Const <a id="top-level-let"></a>

Top-level statements declare the variables of the implicit top-level context
(spec [§6.5](#top-level-statements)). A top-level `let` variable belongs to that context alone: it is
not visible from functions.

A **top-level constant** is a variable that a top-level statement itself
declares with `const`, by `const x … = e;` or by `const x: T <- e;`. It is visible
in the body of every function as well, local and choreography alike. The
top-level scope encloses each body, outside its parameters, so a parameter or a
`let` or `const` in the body that has the same name shadows the constant
(spec [§6.4](#variable-scope)). A `const` declared in a block of a top-level statement, such as
the body of a top-level `if`, is not a top-level constant: it is scoped to its
block.

A function uses a top-level constant as any `const`: it may read it, and assign
or push to the elements of an array it holds, but not store into it
(spec [§5.7](#const-statement)). A local function at `P` may use only a constant located at `P`
(spec [§8.4](#local-function-strict-location-rule)). No function may be called before a constant it uses is
initialized (spec [§6.7](#top-level-constant-initialization-order)).

An imported constant is a top-level constant as well (spec [§6.8](#imported-names)), declared by
its import rather than by a statement.

Allowed:

```ts
const limit: integer@alice = 10@alice;
const rounds: integer@every = 3@every;

function clamp@alice(x: integer@alice): integer@alice {
    if (x > limit) {
        return limit;
    }
    return x;
}

function total(): integer@alice {
    let sum: integer@alice = 0@alice;
    for (let i: integer@every = 0@every; i < rounds; i = i + 1@every) {
        sum = sum + clamp(20@alice);
    }
    return sum;
}

let result: integer@alice = total();
```

Allowed — the parameter shadows the constant:

```ts
const n: integer@alice = 1@alice;

function f@alice(n: integer@alice): integer@alice {
    return n;
}
```

Disallowed — a top-level `let` is not visible from a function:

```ts
let x: integer@alice = 1@alice;

function f@alice(): integer@alice {
    return x;
}
```

### 6.7 Initialization Order of Top-Level Constants <a id="top-level-constant-initialization-order"></a>

Function declarations are hoisted (spec [§6.3](#function-declaration-hoisting)), but a top-level constant holds a
value only once its declaration has run. A function could therefore be called
before a constant it uses is initialized. The program text alone decides
whether that can happen, and it is a compile-time error
(spec [§16.58](#constant-used-before-initialization)):

* A function **uses** a top-level constant when a name in its body refers to it
  (spec [§6.6](#top-level-let)): to read it, to read or assign one of its elements, to push to it,
  or to take its length.
* A function **reaches** a top-level constant when it uses it, or when its body
  calls a function that reaches it. Every call in the body counts, whether or
  not it would run: these are the calls of the call graph of spec [§10.4](#recursion).
* A top-level statement must not call a function that reaches a top-level
  constant declared by that statement or by a later one. Every call in the
  statement counts, in the blocks it holds too, and so does a call in the
  initializer of the constant's own declaration.

Only top-level statements are restricted. A function runs only when it is
called, and every call that runs is made by a top-level statement or by a
function that such a call ran, so the calls the rule allows never run a body
before the constants it reaches. Where a function is declared does not matter.

An imported constant is initialized before the first top-level statement runs
(spec [§6.8](#imported-names)), so it counts as declared before every statement, and the rule
never rejects a call that reaches it. An imported function reaches no
constant: its body is BlueScript, which cannot name the program's constants.

Disallowed — `f` would run before `limit` is initialized:

```ts
let y: integer@alice = f();
const limit: integer@alice = 10@alice;

function f@alice(): integer@alice {
    return limit;
}
```

Allowed — `f` is called after:

```ts
const limit: integer@alice = 10@alice;
let y: integer@alice = f();

function f@alice(): integer@alice {
    return limit;
}
```

The rule is conservative: a call is rejected even when the use it reaches is in
a branch that would not run. TypeScript accepts such a program and throws a
`ReferenceError` only if the use runs. BlueScript checks nothing of the kind:
a global read before its initialization yields `0`, `0.0`, `false` or `null`,
with no error (spec [§17.8](#unverified-bluescript-assumptions)). Rejecting the call is what keeps an endpoint from
running on such a value.

The rule also orders type checking. A function's return type may be inferred
from a top-level constant it uses (spec [§7.20.4](#function-return-type-inference)), and that constant's type from
its initializer, which may call other functions. A function a top-level
statement calls reaches only constants declared before the statement, so the
top level can be checked in source order, each return type inferred when a call
first needs it, and no type depends on itself.

### 6.8 Imported Names <a id="imported-names"></a>

An import declaration at an endpoint `P` (spec [§5.19](#import-declarations)) binds each name it imports
to a function or a constant of a BlueScript source file, with the type the file
gives it, located at `P` (spec [§7.21](#imported-signatures)).

An **imported function** is a local function at `P` (spec [§10.1](#function-kinds)) whose body is
BlueScript:

* It is called as a local function at `P` is: from a choreography context,
  where the endpoints other than `P` keep only its arguments
  (spec [§10.2](#calling-local-from-choreography), [§12.12](#function-projection)), and from a local function at `P` (spec [§10.3](#calling-functions-from-a-local-context)).
* Its name is a function name: global, held for the whole program, and taken by
  no variable or parameter (spec [§6.1](#namespaces), [§6.2](#function-names)).
* It calls no function of the program, so it is never part of a recursion
  (spec [§10.4](#recursion)) and reaches no top-level constant (spec [§6.7](#top-level-constant-initialization-order)).

An **imported constant** is a top-level constant located at `P`
(spec [§6.6](#top-level-let)):

* It is visible at the top level and in every function body. A local function
  may use it only if the function is at `P` (spec [§8.4](#local-function-strict-location-rule)).
* It is never stored into (spec [§5.7](#const-statement)). A parameter, or a `let` or `const` in a
  block or a function body, may shadow it, as any top-level constant
  (spec [§6.4](#variable-scope)). A top-level statement may not declare a variable of its name.
* BlueScript initializes an imported module before the module that imports it,
  so the constant has its value before the first top-level statement runs
  (spec [§6.7](#top-level-constant-initialization-order)).

Imported names follow the rules of the value namespace (spec [§6.1](#namespaces)). An imported
name may not be an endpoint name or a reserved runtime name (spec [§6.2](#function-names)), nor the
name of a function the program declares. One name may be imported more than
once only when every import binds it to the same thing: the same export of the
same file, at the same endpoint. One export may also be imported under two
names; each is a function or constant of its own, with the same body or value.

```ts
import@alice { now } from "./clock";
import@alice { now, now as t } from "./clock";   // `now` again, and `t`
```

A name bound to two different things is an error (spec [§16.68](#conflicting-imports)), and so is
one export imported at two endpoints under one name. A function name is held
once, whatever its location (spec [§6.2](#function-names)), and a call names no location
(spec [§7.17](#function-call-typing)), so nothing would say which of the two a call means:

```ts
import@alice { now } from "./clock";
import@bob { now } from "./clock";               // error: import it `as nowAtBob`
```

***

## 7. Type System <a id="type-system"></a>

### 7.1 Base Types <a id="base-types"></a>

The base types in v1 are:

```text
integer
float
boolean
string
null
void
```

`any` and `undefined` do not exist in v1. (The BlueScript output holds each
array element, and each `dyn` payload, in a BlueScript `any` (spec [§7.1.1](#array-types), [§14.9](#dyn-val));
that is not a source type.)

An integer literal such as `1` has type `integer`, and a float literal such as
`1.0` has type `float` (spec [§4.5](#literals)). The two types are unrelated (spec [§7.5](#subtyping)), so a
`float` literal is always written with a fractional part: `1@alice` is never a
`float`, though `1@alice as float` is one (spec [§7.15](#numeric-conversion)).

#### 7.1.1 Array Types <a id="array-types"></a>

The mutable array extension adds the following array types:

```text
T[]
```

where `T` is one of:

```text
integer
float
boolean
```

Examples:

```text
integer[]@alice
float[]@bob
boolean[]@every
```

The following array types are not supported:

```text
string[]
null[]
void[]
integer[][]
float[][]
boolean[][]
```

Arrays are mutable reference values. That includes an array held in a `const`
variable: `const` fixes the variable, not the array (spec [§5.7](#const-statement)).

Within the same location, array assignment, function argument passing, and function return preserve array identity. Therefore, two variables may refer to the same mutable array. The same holds across `dyn`: an inject or a cast never copies its payload (spec [§7.8](#coercion)), so an array that is made dynamically located, or static again, is the same array.

Example:

```ts
let xs: integer[]@alice = [1, 2]@alice;
let ys: integer[]@alice = xs;
ys[0@alice] = 99@alice;
```

After the element assignment, `xs[0]` is also `99` at `alice`.

A transfer moves array contents by serialized value. The receiver obtains a fresh mutable array that does not share identity with the sender's array. For broadcast to `@every`, the sender-side binding is also a fresh mutable array copy.

A value of type `T[]@every` means that each endpoint has an independent local mutable array with the same contents. It is not shared memory.

The element type does not reach the BlueScript output. There every array is an
`any[]` (spec [§13.1](#type-mapping)), so each element is held as a BlueScript `any`, and an
element can hold only what an `any` can:

* an `integer` element holds an integer from −2^29 to 2^29 − 1;
* a `float` element holds `0.0`, `-0.0`, `NaN`, and a value whose magnitude is at
  least 2^−30 and below 2^32.

Storing any other value in an element gives an unspecified result.

An operation on a value read from an element is BlueScript's operation on
`any`, not the static one:

* an arithmetic result is itself held as an `any`, with the same limits: a
  result outside them is unspecified, even where the static type could hold it;
* `===` and `!==` compare the two values as they are held. For `float` this
  differs from the static comparison: `NaN === NaN` is true, and `0.0 === -0.0`
  is false.

Apart from these, an operation on an `any` gives the static result: BlueScript
applies the operation for the type of the value the `any` holds.
`integer / integer` is still integer division, `%` still takes two integers, and
a `<` compares two numbers as the static `<` does.

A value at `dyn` has the same limits, since its payload is an `any` too
(spec [§3.5](#dyn)).

Converting a value read from a static array to its own type gives it back its
static type, and every operation on the converted value is the static one
(spec [§13.5](#numeric-conversion-code-generation)):

```ts
let xs: integer[]@alice = [400000000, 400000000]@alice;
let a: integer@alice = xs[0@alice] + xs[1@alice];                            // unspecified
let b: integer@alice = (xs[0@alice] as integer) + (xs[1@alice] as integer);  // 800000000
```

### 7.2 Located Types <a id="located-types"></a>

Expressions fall into two kinds, and most rules in this specification are about
the first:

```text
Gamma |- e : T@L      a value expression
Gamma |- e : void     a void computation
```

A **value expression** produces a value, and that value has a located type:

```text
T@L
```

A **void computation** produces no value. v1 has three: a call to a function whose
return type is `void`, `xs.push(v)` (spec [§7.16](#array-typing)), and `print(e)` (spec [§7.18](#print-typing)). Having no value, it has no location (spec [§7.3](#void)) — but it still
has to run *somewhere*, and where that is comes from the operation itself, not
from a location on its type:

* a call to a local function at `P` runs at `P`;
* a call to a choreography function runs at every endpoint;
* a print runs where the printed value is located — at every endpoint when that
  is `every`;
* a dynamic push or print runs at every endpoint, which dispatches on the
  location of the array or of the printed value at run time (spec [§7.9](#dynamic-operations)).

Every rule stated for `T@L` — location consistency ([§7.7](#location-consistency-and-join)), assignment ([§7.10](#assignment-typing)),
transfer ([§7.11](#transfer-typing)), conditions ([§7.12](#if-condition-typing)) and the Local Function Strict Location Rule
([§8.4](#local-function-strict-location-rule)) — applies to value expressions. A void computation satisfies none of them
and needs none of them: it may appear only as an expression statement, where
there is no value to place.

Wherever a value is required, a void computation is an error (spec [§16.43](#invalid-use-of-void)).
Type inference is no exception: an omitted annotation infers the initializer's
type, so a `let` initialized by a void call is rejected just as the written form
`let x: void = f();` is. The same applies to a `for` initializer and to an array
literal element.

```ts
function f@alice(): void { return; }

f();                       // valid — a statement
let x = f();               // invalid: the initializer produces no value
let xs = [f()]@alice;      // invalid: an element produces no value
```

Examples:

```text
integer@alice
float@bob
boolean@every
string@sensor
integer@dyn
```

### 7.3 Void <a id="void"></a>

`void` is the return type of a function that does not return a value.

Unlike every other type, **`void` has no location**. A location says where a
value is; `void` has no value, so there is nothing to place. Writing one is an
error (spec [§16.43](#invalid-use-of-void)):

```ts
function f@alice(): void { ... }         // valid
function f@alice(): void@alice { ... }   // invalid
```

For the same reason `void` is not a value type: it may appear only as a function
return type, never as a variable type, a parameter type, a transfer destination,
or an array element type (spec [§16.43](#invalid-use-of-void)).

```ts
function f(): void {
    return;
}
```

After EPP, at every endpoint — a `void` return type is kept everywhere, because
there is no value that could be absent at one of them (spec [§12.3](#type-projection)):

```ts
function f(): void {
    return;
}
```

`void` is distinct from `null` (spec [§7.4](#null)), which is an ordinary value type and
does carry a location.

A function whose omitted return type is inferred as `void` has return type
`void`, never `void@dyn`: there is no value whose location could be left to run
time (spec [§7.20.4](#function-return-type-inference)).

### 7.4 Null <a id="null"></a>

`null` is a singleton type.

```text
null is the only value of type null.
null is not a subtype of integer, float, boolean, string, or void.
```

Allowed:

```ts
let x: null@alice = null@alice;
```

Disallowed:

```ts
let x: integer@alice = null@alice;
```

### 7.5 Subtyping <a id="subtyping"></a>

The base type subtyping relation is reflexivity alone:

```text
T <: T
```

There are no other base type subtyping relations. In particular, `integer` and
`float` are unrelated: neither is a subtype of the other, so an `integer` is
never accepted where a `float` is expected, nor the other way round. There is no
implicit conversion between them; a value is converted explicitly with `as`
(spec [§7.15](#numeric-conversion)).

This holds with `dyn` as well. `dyn` relaxes the location of a type and nothing
else, so there is no implicit conversion at the boundary between a static and a
dynamic location either:

```ts
let valAlice: integer@alice = 1@alice;
let f1: float@dyn = valAlice;            // invalid (spec §type-mismatch)
let f2: float@dyn = valAlice as float;   // valid
```

### 7.6 Location Matching and Residency <a id="location-matching-and-residency"></a>

Two distinct relations on locations are used in this specification: matching,
on concrete locations, and residency, on every location, `dyn` included. They
must not be confused. A third, location consistency, extends matching to `dyn`
(spec [§7.7](#location-consistency-and-join)).

#### Location Matching (type system) <a id="location-matching-type-system"></a>

A value located at `Lvalue` may be used where a value at `Luse` is required only
when the two locations are the same:

```text
match(L, L) = true
match(every, P) = false  where P is an individual location
match(P, every) = false  where P is an individual location
match(P, Q) = false      where P and Q are individual locations and P != Q
```

`every` and the individual locations are independent (spec [§3.2](#locations)): neither
subsumes the other. In particular, a value of type `T@every` may **not** be used
as a `T@P` value, and a value of type `T@P` may **not** be used as a `T@every`
value. To move a value between two different locations, use the transfer
operator `<-` (spec [§7.11](#transfer-typing)).

Examples:

```text
integer@alice matches alice
integer@alice does not match bob
integer@every does not match alice
integer@alice does not match an every context
```

This rule applies uniformly to scalars and to mutable arrays. On concrete
locations it is the location rule of assignment ([§7.10](#assignment-typing)), function arguments ([§7.17](#function-call-typing)),
and return values ([§7.19](#return-typing)); those rules state it as consistency, `~`, which is
matching extended to `dyn` (spec [§7.7](#location-consistency-and-join)). Inside `function f@P` the required
location is `P`, so a value at `every` or at another individual location is
rejected by the same rule, and `dyn`, which would be consistent with `P`, is not
allowed there at all. The additional restrictions specific to local function
declarations are stated in [§8.4](#local-function-strict-location-rule).

#### Location Residency (endpoint projection) <a id="location-residency-endpoint-projection"></a>

Endpoint Projection needs a different question answered: which endpoints
physically hold a copy of a value? Define `residesAt(L, P)`, where `P` is an
endpoint:

```text
residesAt(P, P) = true
residesAt(every, P) = true
residesAt(dyn, P) = true
residesAt(Q, P) = false  where Q is an individual location and Q != P
```

A value at `every` resides at every endpoint, because every endpoint holds its
own copy (spec [§3.4](#every)). This is why `T@every` declarations are projected into every
endpoint program rather than becoming `absent` (spec [§12.3](#type-projection)).

A value at `dyn` resides at every endpoint too, but only in the sense of its
representation: every endpoint holds a `__DynVal` for it (spec [§12.3](#type-projection)). Which
endpoint logically owns it is decided at run time (spec [§3.5](#dyn)).

Residency does **not** imply matching. That an endpoint `alice` holds a copy of a
`T@every` value does not make that value usable as a `T@alice` value; an explicit
`<-` transfer is still required. `residesAt` is used only by [§12](#endpoint-projection) and must
never be used as a typing rule.

### 7.7 Location Consistency and Join <a id="location-consistency-and-join"></a>

Matching (spec [§7.6](#location-matching-and-residency)) is too strict where `dyn` is involved: the location of a
`dyn` value is not known until run time. The type system therefore uses the
**consistency** relation `~` in its place, and the **join** `⊔` to locate the
result of an operation:

```text
L1 ~ L2   iff  L1 = dyn  or  L2 = dyn  or  match(L1, L2)

L1 ⊔ L2   =  L1    if L1 = L2
             dyn   if L1 = dyn or L2 = dyn
```

`⊔` is used only on consistent pairs. On two concrete locations `~` is `match`
and `⊔` is the location itself, so nothing about static code changes.

`~` is not transitive: `alice ~ dyn` and `dyn ~ bob` both hold, but `alice ~ bob`
does not. A construct that involves more than two locations therefore requires
them to be **pairwise consistent**: at most one concrete location may be among
them, however many `dyn`s there are. Two different concrete locations in one
construct are a compile-time error even with `dyn` between them
(spec [§16.32](#array-literal-elements-across-locations), [§16.39](#element-assignment-across-locations)).

Examples:

```text
integer@dyn ~ alice
integer@alice ~ dyn
alice is not ~ bob
alice ⊔ dyn   = dyn
alice ⊔ alice = alice
```

The rules below replace matching with `~` in each construct. Base type rules are
unchanged; each is stated in its own section.

| Construct | Location condition | Result |
|---|---|---|
| assignment `a = b` (`a : T1@L1`, `b : T2@L2`) | `L2 ~ L1` | |
| argument (parameter `Ti@Li`, argument `Si@Mi`) | `Mi ~ Li` | |
| `return e` (return type `T@L`) | the location of `e` `~ L` | |
| `if` / `while` / `for` condition, choreography context | `boolean@L`, `L ~ every` | |
| binary operation `e1 op e2` | `L1 ~ L2` | `T@(L1 ⊔ L2)` |
| unary operation `op e` | | `T@L` |
| numeric conversion `e as T` (`e : S@L`) | | `T@L` |
| `xs[i]` | `Li ~ Lxs` | `T@(Lxs ⊔ Li)` |
| `xs[i] = v` | `Lxs`, `Li` and `Lv` pairwise `~` | |
| `xs.length` | | `integer@Lxs` |
| `xs.push(v)` | `Lv ~ Lxs` | `void` |
| array literal `[e1, …, en]@L` | each `Lei` and `L` pairwise `~` | `T[]@L` |
| transfer `a <- b` | none (spec [§7.11](#transfer-typing)) | |

An element assignment and a push are dynamic operations when the join of the
locations involved is `dyn`, and static otherwise (spec [§7.9](#dynamic-operations)): even
`arrAlice[iAlice] = valDyn` is dynamic.

Where `~` holds but the locations differ, the compiler inserts a coercion
(spec [§7.8](#coercion)). Inside a local function none of this arises: `dyn` is not allowed
there (spec [§8.4](#local-function-strict-location-rule)), and locations must match exactly.

### 7.8 Coercion <a id="coercion"></a>

When an expression `e : S@L` stands where a `T@L'` is required and `L ~ L'`, the
compiler inserts a **coercion** `coerce(e : S@L → T@L')`, where `S <: T` — that
is, `S = T` (spec [§7.5](#subtyping)):

```text
L  = L'              =>  e
L  = q,   L' = dyn   =>  inj<q>(e)
L  = dyn, L' = q     =>  cast<q>(e)
```

where `q` is a concrete location.

* `inj<q>` — **inject** — makes a statically located value dynamically located.
  It does not copy the payload: the value itself is paired with a fresh location
  variable bound to `q`, so an array keeps its identity.
* `cast<q>` makes a dynamically located value statically located. It binds the
  value's location variable to `q`, or checks that it is already bound there —
  a location error otherwise (spec [§7.9](#dynamic-operations)) — and then yields the payload. An
  endpoint that does not own the value at `q` gets `null`, even if it holds a
  copy of the payload.

A coercion changes only the location. It never changes the base type: `integer`
and `float` meet only through an explicit `as` (spec [§7.15](#numeric-conversion)).

Coercions are inserted at:

* the initializer of a `let`, including a `for` initializer `let`;
* the right-hand side of an assignment;
* each argument of a function call, towards its parameter's type;
* the value of a `return`, towards the function's return type;
* a condition, towards `boolean@every` in a choreography context;
* the value of an element assignment and of a push, towards the array's element
  type — at `dyn` when the operation is dynamic;
* each element of an array literal, towards the element type at the array's
  location;
* the source of a dynamic transfer, towards `T@dyn`, and its result, towards a
  concrete destination (spec [§11.5](#dynamic-transfer)).

Where the join of a binary operation or an array operation is `dyn`, each static
operand is injected, `coerce(e → T@dyn)`.

Examples:

```ts
let valDyn: integer@dyn = 3@dyn;
let valAlice: integer@alice = 3@alice;
let a: integer@dyn = valAlice;     // inj<alice>(valAlice)
let b: integer@alice = valDyn;     // cast<alice>(valDyn)
let c: integer@alice = 5@dyn;      // cast<alice>(5@dyn)
```

Going through `dyn` does not get round a static rule. This compiles, but the
inject binds `d` to `every`, so the cast to `alice` is a location error at run
time:

```ts
let c: boolean@every = true@every;
let d: boolean@dyn = c;
let e: boolean@alice = d;
```

A numeric conversion changes only the base type, and a coercion only the
location, so the two compose independently (spec [§7.15](#numeric-conversion)):

| Flow | Form |
|---|---|
| `integer@q` converted, into a `float@dyn` position | `inj<q>(e as float)` |
| `integer@dyn` converted, into a `float@q` position | `cast<q>(__dynIntegerToFloat(e))` |
| `integer@dyn` converted, into a `float@dyn` position | `__dynIntegerToFloat(e)` |
| a `dyn` literal `c` converted, into a `float@dyn` position | `__dynIntegerToFloat(__dynUnbound(c))` |

The compiler represents `inj<q>` and `cast<q>` as calls of the runtime functions
`__inject(e, __loc_q)` and `__cast(e, __loc_q)`, where `__loc_q` is the
runtime's constant for `q` (spec [§12.2](#dyn-lowering), [§14.6](#location-and-kind-codes), [§14.11](#inject-and-cast)).

### 7.9 Dynamic Operations <a id="dynamic-operations"></a>

An operation is **dynamic** when a `dyn` location takes part in it:

* an operator whose operand is at `dyn`, or whose join is `dyn`
  (spec [§7.7](#location-consistency-and-join));
* a numeric conversion of a `dyn` operand to the other numeric type. One to the
  operand's own type changes nothing, and is dropped (spec [§7.15](#numeric-conversion));
* an index access, element assignment, `.length` or push whose join is `dyn`;
* a print of a `dyn` value (spec [§7.18](#print-typing));
* a `dyn` literal or array literal (spec [§8.6](#dyn-literals), [§5.17](#array-literals));
* an inject or a cast (spec [§7.8](#coercion));
* a transfer with `dyn` on either side (spec [§11.5](#dynamic-transfer)).

A dynamic operation is emitted, in the same form, into every endpoint program and
performed by location dispatch (spec [§3.5](#dyn)). It first unifies or binds the
location variables involved, and then operates on the payload only at the
endpoints that hold it: every endpoint while the value is unbound or at `every`,
and the owner alone once it is bound to an individual location. The other
endpoints produce a `null` payload with the same location variable.

The result of a dynamic operator shares a location variable with its operands,
so it is wherever they turn out to be.

#### Location Errors <a id="location-error-semantics"></a>

A dynamic operation that would place one location class at two different
concrete locations is a **location error**. The endpoint that detects it stops
executing at that operation.

Every endpoint adds the same constraints in the same order (spec [§3.5](#dyn)), so
every endpoint detects the same error at the same operation and stops there. No
coordination between endpoints is needed. How an endpoint stops is given in
spec [§14.8](#location-errors).

```ts
let d: integer@dyn = 1@dyn;
let a: integer@alice = d;      // binds d to alice
let b: integer@bob = d;        // location error: d is at alice
```

### 7.10 Assignment Typing <a id="assignment-typing"></a>

Assignment:

```ts
a = b;
```

is valid if:

```text
a : T1@L1
b : T2@L2

T2 <: T1
L2 ~ L1
```

with a coercion inserted on `b` when the locations differ (spec [§7.8](#coercion)).

When `a = b` is an assignment statement or an assignment in a `for` header, `a`
must also not be a `const` variable (spec [§5.7](#const-statement), [§16.56](#assignment-to-a-constant)). The initializer of a
`const` declaration is checked by the rule above like that of a `let`.

For mutable arrays, compatibility is checked by array invariance as defined in [Section 7.16](#array-typing). Therefore, `T1[]` and `T2[]` are compatible only when `T1` and `T2` are the same element type.

Example:

```ts
let x: integer@alice = 1@alice;
let y: integer@alice = x;
```

Disallowed:

```ts
let x: integer@alice = 1@alice;
let y: integer@bob = x;
```

Disallowed:

```ts
let c: boolean@every = true@every;
let d: boolean@alice = c;
```

A transfer must be used instead. `every` and `alice` are different locations,
so the copy has to be explicit:

```ts
let d: boolean@alice <- c;
```

The same applies to mutable arrays, by the same rule:

```ts
let xs: float[]@every = [1.1, 2.2]@every;
let ys: float[]@alice = xs;      // invalid
let ys2: float[]@alice <- xs;    // valid: local copy
```

With `dyn` on either side, the locations are consistent, and the assignment is
checked at run time instead (spec [§7.8](#coercion)):

```ts
let valDyn: integer@dyn = 3@dyn;
let valAlice: integer@alice = 3@alice;
let a: integer@dyn = 32@alice;   // inj<alice>
valDyn = 4@alice;                // inj<alice>
valAlice = 5@dyn;                // cast<alice>
```

#### Assigning to a `dyn` Variable <a id="assigning-to-a-dyn-variable"></a>

A location variable belongs to a dynamically located **value**, not to a
variable (spec [§14.9](#dyn-val)). Assigning to a `dyn` variable replaces the value it refers
to; the previous value, and the location constraints on it, are left as they
were. The new value brings its own location variable, so `valDyn = 4@alice;`
does not bind whatever `valDyn` held before to `alice`.

An alias made with `=`, such as `let a: integer@dyn = b;` where `b : integer@dyn`,
shares the one value and so shares its location variable: binding one binds the
other.

### 7.11 Transfer Typing <a id="transfer-typing"></a>

The transfer operator:

```ts
a <- b;
```

evaluates `b` at its own location and copies the resulting value to the location
of `a`, storing it in `a`.

When `a <- b` is a transfer statement, `a` must not be a `const` variable
(spec [§5.7](#const-statement), [§16.56](#assignment-to-a-constant)). A transfer declaration may declare one: `const a: T@L <- b;`.

#### Base Type Rule <a id="base-type-rule"></a>

For `a : T1@p` and `b : T2@q`, the transfer is well typed only when

```text
T2 <: T1
```

that is, the source base type must be a subtype of the destination base type
(spec [§7.5](#subtyping)). Since subtyping is reflexivity alone, this means the two base
types must be the same. Locations play no part in this rule.

Every value type may be transferred: `integer`, `float`, `boolean`, `string`,
`null`, and the array types. Each scalar type has its own entry in the
communication API, and the array types share the one `Array` entry
(spec [§13.14](#communication-api)). The two sides of a transfer have the same base type, so the
sender and the receivers always use the same entry, and no payload is ever sent
through a channel of the wrong type. A
`null` transfer carries no data — it is a synchronisation signal — but it is an
ordinary transfer in every other respect. `void` is not a value type at all and
cannot appear on either side (spec [§7.3](#void), [§16.43](#invalid-use-of-void)).

Allowed — the same base type:

```ts
let y: integer@alice = 1@alice;
let x: integer@bob <- y;
```

Disallowed — `integer` and `float` are unrelated, in either direction:

```ts
let y: integer@alice = 1@alice;
let x: float@bob <- y;
```

```ts
let y: float@alice = 1.5@alice;
let x: integer@bob <- y;
```

Convert explicitly instead, on whichever side should do the work
(spec [§7.15](#numeric-conversion)):

```ts
let y: integer@alice = 1@alice;
let x: float@bob <- y as float;
```

Disallowed — any other pair of different base types:

```ts
let y: float@alice = 1.5@alice;
let x: string@bob <- y;
```

Arrays follow the same rule: for `T[]`, the element types must be exactly the
same (spec [§7.16](#array-typing)).

Disallowed:

```ts
let xs: integer[]@every = [1, 2]@every;
let ys: float[]@alice <- xs;
```

With `dyn` on either side the rule is the same — the base types must agree —
so `integer` is not transferred as `float` there either:

```ts
let valDyn1: integer@dyn = 4@dyn;
let fb: float@bob <- valDyn1;            // invalid
let fb2: float@bob <- valDyn1 as float;  // valid
```

#### Location Rule <a id="location-rule"></a>

There is none. Any location, `dyn` included, may appear as the source or the
destination, in any combination. What the locations decide is not whether the
transfer is legal, but how it is carried out. For concrete locations:

| source | destination | behaviour |
|---|---|---|
| `p` | `p` | local copy |
| `p` | `q`, `q != p` | endpoint-to-endpoint communication |
| `p` | `every` | broadcast; the sender also makes a local copy |
| `every` | `p` | local copy |
| `every` | `every` | local copy at every endpoint |

The unifying rule is residency (spec [§7.6](#location-matching-and-residency)). At an endpoint `E` that the
destination resides at, the transfer is a local copy when the source also
resides at `E`, and a receive otherwise. A transfer is therefore a pure local
copy exactly when every endpoint the destination resides at already holds the
source payload — that is, when the source is `@every`, or when the source and
destination locations are the same.

A transfer that performs no communication is ordinary and expected; it is not an
error.

A transfer with `dyn` on either side is a **dynamic transfer** (spec [§11.5](#dynamic-transfer)). How
it is carried out is decided at run time, from where the source turns out to be.
`dyn -> dyn` is a dynamic transfer, not a local copy, although both sides are
written the same.

#### The Source Is Evaluated Once <a id="the-source-is-evaluated-once"></a>

The source of a transfer is an arbitrary expression and may call a function, so
how many times it is evaluated is observable:

> The source expression of a transfer is evaluated exactly once at each endpoint
> where it is evaluated at all.

This needs saying because a broadcast uses the source value twice at the sender
— once as the payload and once for the sender's own binding (spec [§11.3](#broadcast-communication)). Those
two uses must be the same value. Where the generated code needs the value more
than once, EPP binds it to a temporary first (spec [§12.10](#transfer-projection)).

#### Local Copy Is Always a Fresh Copy <a id="local-copy-is-always-a-fresh-copy"></a>

Whenever a transfer results in a local copy, the destination receives a **fresh**
value, for scalars and for mutable arrays alike. For a mutable array this means
the destination does not share identity with the source.

This is what distinguishes `<-` from `=` at one and the same location:

```ts
let xs: float[]@alice = [1.1, 2.2]@alice;
let alias: float[]@alice = xs;   // same array
let copy: float[]@alice <- xs;   // fresh array
```

For scalars the two are equivalent, since a scalar assignment already copies the
value.

Example:

```ts
let x: integer@alice = 1@alice;
let y: integer@bob <- x;
```

This is direct communication from `alice` to `bob`.

Example:

```ts
let x: integer@every = 1@every;
let y: integer@alice <- x;
```

This is a local copy at `alice`.

### 7.12 If Condition Typing <a id="if-condition-typing"></a>

An `if` condition must be a `boolean` whose location is consistent (`~`) with the
current context's location.

Let the current context be `C`.

```text
cond : boolean@L
L ~ C
```

#### Choreography Context <a id="if-condition-choreography-context"></a>

In a choreography function or at top level, the condition must be `boolean@every`
or `boolean@dyn`. The same applies to `while` and `for` conditions (spec [§7.13](#while-and-for-condition-typing)).

```ts
let c: boolean@every = true@every;

if (c) {
}
```

A `boolean@dyn` condition is cast to `every` (spec [§7.8](#coercion)). Every endpoint therefore
gets the condition's value, and takes the same branch; a condition bound to an
individual location is a location error at run time (spec [§7.9](#dynamic-operations)).

```ts
let boolDyn: boolean@dyn = true@dyn;
if (boolDyn) {}                       // cast<every>(boolDyn)
```

#### Local Context <a id="if-condition-local-context"></a>

Inside `function@alice`, the condition must be `boolean@alice`.

A condition of type `boolean@every` is not allowed inside a local function: `every` does not match `alice` (spec [§7.6](#location-matching-and-residency)).

Allowed:

```cbs
function f@alice(c: boolean@alice): void {
    if (c) {
        return;
    }
}
```

Disallowed:

```cbs
function f@alice(c: boolean@every): void {
    if (c) {
        return;
    }
}
```

### 7.13 While and For Condition Typing <a id="while-and-for-condition-typing"></a>

The termination conditions of `while` and `for` follow the same rule as `if`.

* In a choreography context, the condition must be `boolean@every` or `boolean@dyn`, and a `dyn` one is cast to `every`.
* In a local `@p` context, the condition must be `boolean@p`. `boolean@every` is not allowed inside local functions.

```ts
for (let i = 0; i < 10; i = i + 1) {}
```

Here `i`, `0`, `10` and `1` are all `@dyn` (spec [§8.2](#omitted-locations)). The first evaluation of
the condition casts `i < 10` to `every`, which binds `i`'s location variable to
`every`; `i + 1` shares that variable, so `i` stays at `every` for the whole loop.

### 7.14 Operators <a id="operators"></a>

Every operator requires its operands to be scalars: no operator, and no numeric
conversion (spec [§7.15](#numeric-conversion)), is defined over array types (spec [§7.16](#array-typing)).
[§7.14](#operators), [§7.15](#numeric-conversion) and [§7.16](#array-typing) together cover all of them.

#### Arithmetic Operators <a id="arithmetic-operators"></a>

```text
+ - * / %
```

These operators are available for `integer` and `float`. `boolean`, `null`,
`string` (apart from the concatenation below) and array operands are rejected
(spec [§16.47](#invalid-arithmetic-or-logical-operand)).

Both operands must have the same numeric type. `integer` and `float` are
unrelated (spec [§7.5](#subtyping)), so there is no promotion, and an `integer` operand
mixed with a `float` one is rejected (spec [§16.47](#invalid-arithmetic-or-logical-operand)). Convert one of
them explicitly instead (spec [§7.15](#numeric-conversion)).

The inferred result base type is:

```text
integer op integer => integer
float   op float   => float
```

```ts
1@alice + 2@alice                // valid: integer@alice
1.5@alice * 2.0@alice            // valid: float@alice
1@alice + 1.5@alice              // invalid
(1@alice as float) + 1.5@alice   // valid: float@alice
```

The operand locations must be consistent, `L1 ~ L2`, and the result is located at
`L1 ⊔ L2` (spec [§7.7](#location-consistency-and-join)). On concrete locations this means both operands are at
the same location and the result is there too; mixing an `@every` operand with an
individual-location operand is a compile-time error. With a `dyn` operand the
result is `dyn`, the other operand is injected, and the operation is dynamic
(spec [§7.9](#dynamic-operations)):

```ts
let valDyn: integer@dyn = 3@dyn;
let valAlice: integer@alice = 5@alice;
valDyn + valAlice      // integer@dyn: inj<alice>(valAlice), then a dynamic +
valAlice + 2@bob       // invalid: alice and bob
valDyn + 1.5@dyn       // invalid: integer and float, dyn or not
```

On a value read from an array, or at `dyn`, the operation is BlueScript's
operation on `any`, whose result is limited as an array element is
(spec [§7.1.1](#array-types)).

#### String Concatenation <a id="string-concatenation"></a>

`string + string` is allowed.

```ts
let s: string@alice = "hello "@alice + "world"@alice;
```

The inferred result type is `string` at the join of the operand locations.

#### Comparison Operators <a id="comparison-operators"></a>

```text
< <= > >=
```

These operators are available for numeric values — `integer` and `float` only.
`string`, `boolean`, `null` and array operands are rejected (spec [§16.46](#invalid-comparison-or-equality-operands)).

Like the arithmetic operators, they require both operands to have the same
numeric type: an `integer` is not compared with a `float` (spec [§7.5](#subtyping)).

```ts
1@alice < 2@alice       // valid
1.0@alice < 1.5@alice   // valid
1@alice < 1.5@alice     // invalid
```

The operand locations must be consistent, and the result is a `boolean` at their
join (spec [§7.7](#location-consistency-and-join)).

Example:

```ts
let x: integer@alice = 1@alice;
let c = x < 10@alice;
```

`c` is inferred as `boolean@alice`.

#### Equality Operators <a id="equality-operators"></a>

```text
===
!==
```

These operators are available for values of **exactly** the same base type.
Like the arithmetic and relational operators, they do not mix the two numeric
types: `integer === float` is rejected (spec [§16.46](#invalid-comparison-or-equality-operands)).

```ts
1@alice === 1.0@alice   // invalid
1@alice === 2@alice     // valid
```

The operand locations must be consistent, and the result is a `boolean` at their
join (spec [§7.7](#location-consistency-and-join)). Since a `dyn` payload always holds the representation of its
static base type (spec [§3.5](#dyn)), a dynamic `===` compares like with like. On a
value read from an array, or at `dyn`, `===` and `!==` compare the values as
BlueScript's `any` holds them: for `float`, `NaN === NaN` is true and
`0.0 === -0.0` is false (spec [§7.1.1](#array-types)).

`==` and `!=` are not allowed.

Array types are not base types. The equality operators `===` and `!==` are not defined for array types.

Nor is `void`. A void computation produces no value (spec [§7.2](#located-types)), so there is
nothing for `===` to compare — and `void === void` would otherwise slip past
the same-base-type rule above (spec [§16.46](#invalid-comparison-or-equality-operands)).

#### Logical Operators <a id="logical-operators"></a>

```text
&&
||
```

These operators are available for `boolean` alone. Any other operand, a
`boolean[]` among them, is rejected (spec [§16.47](#invalid-arithmetic-or-logical-operand)).

The operand locations must be consistent, and the result is a `boolean` at their
join (spec [§7.7](#location-consistency-and-join)).

They do **not** short-circuit: both operands are always evaluated, left first,
like those of every other binary operator (spec [§5.18](#evaluation-order)). Beyond the rules
above, an operand may be any well-typed expression, including one that calls a
choreography function:

```cbs
function ping(): boolean@alice {
    let b: integer@bob = 1@bob;
    let c: integer@alice <- b;
    return true@alice;
}

let c: boolean@alice = false@alice;
let d: boolean@alice = c && ping();   // ping() runs although c is false
```

Their projection is that of any other binary operator (spec [§12.8](#binary-and-unary-operation-projection)). With a
`dyn` operand they are dynamic operations, which do not short-circuit either
(spec [§14.12](#dyn-operators)).

#### Unary Operators <a id="unary-operators"></a>

```text
-  !
```

`-` requires an `integer` or a `float` operand; the result has the operand's own
base type. `!` requires a `boolean` operand; the result is `boolean`.

In both cases the result is located where the operand is:

```text
e : T@L
-e : T@L      where T is integer or float
!e : boolean@L    where e : boolean@L
```

A unary expression is evaluated wherever its operand is, so it introduces no
location constraint of its own beyond the one the operand already carries: in a
local function at `P` the operand must be at `P` like any other expression
(spec [§8.4](#local-function-strict-location-rule)), and in a choreography context the operand may be at any single
location, `dyn` included. On a `dyn` operand the operator is dynamic
(spec [§7.9](#dynamic-operations)).

Examples:

```ts
let x: integer@alice = 1@alice;
let y = -x;               // y : integer@alice
let c = !(x < 10@alice);  // c : boolean@alice
```

Neither operator accepts an array operand, even when the element type would fit
(spec [§16.45](#invalid-unary-operand)):

```ts
let xs: boolean[]@alice = [true]@alice;
let bad = !xs;            // invalid
```

Unary operators bind tighter than every binary operator and than `as`, and are
right associative (spec [§5.15](#expressions)), so `-a * b` is `(-a) * b`, `-a as float` is
`(-a) as float`, and `!!c` is `!(!c)`.

### 7.15 Numeric Conversion <a id="numeric-conversion"></a>

```text
e as integer
e as float
```

A numeric conversion changes the base type of a numeric value. `integer` and
`float` are unrelated (spec [§7.5](#subtyping)), so this is the only way to use a value of one
where the other is expected.

```text
e : S@L          where S is integer or float
(e as T) : T@L   where T is integer or float
```

* The operand must be an `integer` or `float` scalar. `boolean`, `string`,
  `null`, `void` and array operands are rejected (spec [§16.54](#invalid-numeric-conversion)).
* Only the base type changes. The result is located where the operand is, and
  the target carries no location: moving a value between locations is what `<-`
  is for (spec [§7.11](#transfer-typing)). As for a unary operator, the operand must be
  usable in the current context (spec [§8.4](#local-function-strict-location-rule)).
* `T` may be the operand's own type, in which case the value does not change.
  On a value read from a static array, or computed from one, it gives the value
  back its static type, so that what follows is the static operation
  (spec [§7.1.1](#array-types)). On a `dyn` operand it is dropped (see below).
* The conversion is carried out by BlueScript's `as` (spec [§13.5](#numeric-conversion-code-generation)), which also
  decides how a `float` becomes an `integer`. On a `dyn` operand it is a dynamic
  operation instead (see below).
* It is a conversion and not a TypeScript type assertion: no other type may
  follow `as` (spec [§17.2](#typescript-javascript-features)).

Examples:

```ts
let n: integer@alice = 3@alice;
let x: float@alice = n as float;          // x : float@alice
let y = 1.5@alice + (n as float);         // y : float@alice
let m: integer@alice = x as integer;      // m : integer@alice
let bad = 1.5@alice + n as float;         // invalid: (1.5@alice + n) as float
```

The parentheses in `y` are needed because `as` binds more loosely than `+`
(spec [§5.15](#expressions)).

A conversion runs where its operand is. Combined with a transfer, the order of
the two decides which endpoint converts:

```ts
let n: integer@alice = 3@alice;
let x: float@bob <- n as float;       // alice converts, then sends a float

let k: integer@bob <- n;
let y: float@bob = k as float;        // bob converts after receiving an integer
```

#### Converting a `dyn` Operand <a id="converting-a-dyn-operand"></a>

The form of a conversion depends on the operand's location `L` and on the pair of
types `S` and `T`:

| Operand | Form |
|---|---|
| `L` is concrete | a static conversion, `e as T` |
| `L = dyn`, `S = integer`, `T = float` | `__dynIntegerToFloat(e)` (spec [§14.13](#dyn-numeric-conversion)) |
| `L = dyn`, `S = float`, `T = integer` | `__dynFloatToInteger(e)` |
| `L = dyn`, `S = T` | nothing: `e` itself |

A conversion of a `dyn` operand to the other numeric type is a dynamic
operation, performed at every endpoint (spec [§7.9](#dynamic-operations)). Only the endpoints that hold the payload convert it; the
result shares the operand's location variable. A same-type conversion of a `dyn`
operand changes nothing, since the payload is already in its type's
representation, so it is dropped altogether.

Converting and moving between locations compose independently (spec [§7.8](#coercion)):

```ts
let valAlice: integer@alice = 1@alice;
let iDyn: integer@dyn = 2@dyn;
let f1: float@dyn = valAlice as float;     // static conversion, then inj<alice>
let f2: float@alice = iDyn as float;       // __dynIntegerToFloat, then cast<alice>
let f3: float@dyn = iDyn as float;         // __dynIntegerToFloat
let f4: float@dyn = 3 as float;            // 3 is 3@dyn: __dynIntegerToFloat(__dynUnbound(3))
let i1: integer@dyn = iDyn as integer;     // nothing
```

An unlocated literal inside `as` gets no special treatment: like any other
unlocated literal it is `c@dyn` (spec [§8.2](#omitted-locations)), and is converted as a `dyn` value —
or, inside a local function, it is at the function's location
(spec [§7.20.8](#local-function-location-inference)).

`as` is only ever applied where a value exists. A static conversion is projected
only where its operand resides (spec [§12.8](#binary-and-unary-operation-projection)), so `inj<q>(e as float)` converts at
`q` and passes `null` elsewhere; and a dynamic conversion leaves the payload alone
at an endpoint that does not hold it (spec [§14.13](#dyn-numeric-conversion)). `null as float` is never
evaluated.

### 7.16 Array Typing <a id="array-typing"></a>

#### Array Invariance <a id="array-invariance"></a>

Array types are invariant. `T1[]` is compatible with `T2[]` only when `T1` and `T2` are the same element type.

Therefore, `integer[]` is not compatible with `float[]`.

Disallowed:

```ts
let xs: integer[]@alice = [1, 2]@alice;
let ys: float[]@alice = xs;
```

An array literal is no exception. It is typed on its own, by the array literal typing rule below, and the resulting array type is then checked against the annotation by the same invariance rule.

Disallowed:

```ts
let xs: float[]@alice = [1, 2]@alice;
```

`[1, 2]@alice` is an `integer[]@alice`, and `integer[]` is not compatible with `float[]`. An annotation does not push an expected element type into the literal's elements; write the elements at the element type instead:

```ts
let xs: float[]@alice = [1.0, 2.0]@alice;
```

The one expression that does take its element type from the type it is checked against is the empty array literal, which has no element type of its own (see Array Literal Typing below).

#### Array Literal Typing <a id="array-literal-typing"></a>

For an array literal `[e1, ..., en]@L`, the element locations and `L` must be pairwise consistent (spec [§7.7](#location-consistency-and-join)), and each element is coerced to the element type at `L` (spec [§7.8](#coercion)). Unlocated literal elements are elaborated to `@L` before type checking. Only unlocated literal elements are elaborated to `@L`; other expressions keep their inferred located types. An array literal without an annotation is at `dyn`, or at the function's location inside a local function (spec [§5.17](#array-literals)).

The inferred element type of a non-empty array literal is the base type shared by all of its elements. Elements of different base types are invalid; this includes mixing `integer` and `float`, which are unrelated (spec [§7.5](#subtyping)).

Examples:

```ts
let xs = [1, 2, 3]@alice;
// xs : integer[]@alice

let ys = [1.0, 2.5]@alice;
// ys : float[]@alice

let zs = [true, false]@alice;
// zs : boolean[]@alice
```

Disallowed:

```ts
let bad = [1, true]@alice;
let mixed = [1, 2.5]@alice;
```

Write the elements at one type, converting where needed (spec [§7.15](#numeric-conversion)). Only an
element that is itself a bare literal takes the array's location, so a literal
inside a conversion is an ordinary unlocated literal, at `dyn` outside a local
function (spec [§8.2](#omitted-locations)):

```ts
let ys = [1.0, 2.5]@alice;
let zs = [1@alice as float, 2.5]@alice;   // static
let ws = [1 as float, 2.5]@alice;         // `1` is 1@dyn: __cast(__dynIntegerToFloat(__dynUnbound(1)), __loc_alice)
```

To keep such an element static, write its location, as in `zs`, or write `1.0`.
In strict mode `ws` is an error (spec [§8.3](#strict-mode)).

An empty array literal cannot infer its element type. It is allowed only where it
is checked against an explicit array type, which supplies the element type:

* the initializer of a `let`, or of a `for` initializer `let`, annotated with an
  array type;
* the right-hand side of an assignment to an array variable;
* an argument, towards its parameter's type;
* the value of a `return` in a function whose return type is written, if only as
  its base type (spec [§7.20.4](#function-return-type-inference));
* the source of a transfer, towards the destination's type.

Where no array type is expected of it — the initializer of an unannotated `let`,
a `return` in a function whose return type is omitted altogether, an expression
statement, the receiver of an index — nothing supplies its element type, and it
is an error (spec [§16.33](#cannot-infer-empty-array-element-type)). Parentheses around the literal make no difference.

The literal keeps its own location — `dyn` when it has no annotation — and is
checked against the expected location like any other value.

Allowed:

```ts
let xs: integer[]@alice = []@alice;
let ys: integer[]@alice = [];        // [] is integer[]@dyn, cast to alice
let zs: float[]@dyn = [];            // built as an empty array (spec §dyn-lowering)

let fs: float[]@alice = [1.5]@alice;
fs = []@alice;
fs = [];                             // __cast(__dynArrayNew(), __loc_alice)

function count@alice(bs: boolean[]@alice): integer@alice {
    return bs.length;
}
let n: integer@alice = count([]@alice);

function none(): float[] {           // returns float[]@alice
    return []@alice;
}

let gs: float[]@bob <- []@alice;
```

In strict mode `ys`, `zs` and the second assignment to `fs` are errors, since
their `[]` has no location (spec [§8.3](#strict-mode)).

Disallowed:

```ts
let xs = []@alice;
let ys: integer[]@alice = []@bob;

function f@alice() {
    return []@alice;
}
[]@alice;
let x: integer@alice = []@alice[0@alice];
```

#### Index Access <a id="index-access"></a>

For an index expression `xs[i]`:

```text
xs : T[]@L
i  : integer@M
M ~ L
```

then:

```text
xs[i] : T@(L ⊔ M)
```

With a `dyn` array or index, the access is dynamic and the static side is injected
(spec [§7.9](#dynamic-operations)).

The index expression must have type `integer`. Bounds checking is a runtime responsibility of BlueScript.

#### Array Element Assignment <a id="array-element-assignment"></a>

For an array element assignment `xs[i] = v;`:

```text
xs : T[]@L
i  : integer@Li
v  : S@Lv
S <: T
L, Li and Lv pairwise ~
```

then the assignment is valid. It is dynamic when the join of `L`, `Li` and `Lv` is
`dyn`, which includes `arrAlice[iAlice] = valDyn` (spec [§7.9](#dynamic-operations)). Two different
concrete locations among the three are an error, `dyn` or not
(spec [§16.39](#element-assignment-across-locations)):

```ts
arrDyn[iAlice] = valBob;      // invalid: alice and bob
```

Only assignment targets of the form `Identifier[Expression]` are supported. General lvalues such as `f()[i]`, `xs[i][j]`, and property assignments are not supported.

#### `.length` <a id="array-length"></a>

`xs.length` is a compiler-known array operation (spec [§5.15](#expressions)).

```text
xs : T[]@L
```

then:

```text
xs.length : integer@L
```

In this rule, `T` must be `integer`, `float`, or `boolean`. In particular
`.length` is **not** defined on `string`: v1 has no string operations at all
(spec [§17.2](#typescript-javascript-features)).

#### `.push` <a id="array-push"></a>

`xs.push(v)` is a compiler-known expression (spec [§5.15](#expressions)).

```text
xs : T[]@L
v  : S@M
S <: T
M ~ L
```

then:

```text
xs.push(v) : void
```

The push is dynamic when `L ⊔ M` is `dyn` (spec [§7.9](#dynamic-operations)).

Appending produces no value, so the result is `void` and carries no location a
program can write or observe (spec [§7.3](#void)). It is a void computation (spec [§7.2](#located-types)):
the only place it can stand is an expression statement, and every value
position rejects it exactly as it rejects a call to a `void` function
(spec [§16.43](#invalid-use-of-void)).

```ts
xs.push(1@alice);            // valid
let n = xs.push(1@alice);    // invalid (spec §invalid-use-of-void)
```

Internally the result still travels with the join of the array's and the
value's locations, `L ⊔ M`, which is what decides the endpoints that perform the
append (spec [§12.16](#array-projection)). A
dynamic push is performed at every endpoint and dispatched at run time.

In this rule, `T` must be `integer`, `float`, or `boolean`.

#### `@every` Arrays Are Not Special <a id="every-arrays-are-not-special"></a>

The location rule of [§7.6](#location-matching-and-residency) applies to arrays exactly as it does to scalars; there
is no array-specific restriction. This section only spells the rule out for
arrays, because the shared-memory reading of `T[]@every` is the one people
reach for. `T[]@every` is *not* shared memory: each endpoint has its own array
(spec [§3.4](#every)), so there is nothing an individual location could borrow.

An `@every` array therefore cannot be used where an individual-location array is
required, for the same reason a `boolean@every` cannot be used as a
`boolean@alice` (spec [§7.10](#assignment-typing), [§16.7](#invalid-assignment-across-locations)).

Disallowed:

```ts
let xs: integer[]@every = [1, 2, 3]@every;
let ys: integer[]@alice = xs;
```

Similarly, a value of type `T[]@every` must not be passed to a function parameter of type `T[]@P` where `P` is an individual location. This restriction applies to all functions, not only local functions.

Disallowed:

```ts
function f@alice(xs: integer[]@alice): void {
    return;
}
let xs: integer[]@every = [1, 2, 3]@every;
f(xs);
```

To create an individual-location mutable array from an `@every` array, transfer it with `<-`:

```ts
let xs: integer[]@every = [1, 2, 3]@every;
let ys: integer[]@alice <- xs;
```

This creates a fresh mutable copy at `alice`.

To create an `@every` array from an individual-location array, use broadcast:

```ts
let xs: integer[]@alice = [1, 2, 3]@alice;
let ys: integer[]@every <- xs;
```

#### Array Equality <a id="array-equality"></a>

The equality operators `===` and `!==` are not defined for array types.

Disallowed:

```ts
let xs: integer[]@alice = [1]@alice;
xs === xs;
```

### 7.17 Function Call Typing <a id="function-call-typing"></a>

Function calls do not specify locations at the call site.

```ts
add(1@alice, 2@alice)
```

Whether a function call is valid depends on the location of the function definition.

The inferred type of a function call expression is the declared or inferred return type of the called function.


#### Function Argument Typing <a id="function-argument-typing"></a>

For a function call:

```cbs
f(arg1, ..., argN)
```

let the corresponding parameter types be:

```text
p1 : T1@L1, ..., pN : TN@LN
```

and let the argument expression types be:

```text
arg1 : S1@M1, ..., argN : SN@MN
```

Each argument is valid if:

```text
Si <: Ti
Mi ~ Li
```

and a coercion is inserted on the argument where the two locations differ
(spec [§7.8](#coercion)). Between concrete locations, the argument location must be the same
as the parameter location. A value of type `T@every` is therefore **not** accepted
by a parameter of type `T@P`, where `P` is an individual location; copy it first
with `<-` (spec [§7.6](#location-matching-and-residency)).

With `dyn` on either side the argument is accepted and checked at run time:

```ts
let valDyn: integer@dyn = 5@dyn;
let valAlice: integer@alice = 5@alice;
function funcDyn(a: integer) {}            // a : integer@dyn
function funcAlice(a: integer@alice) {}
funcDyn(valAlice);                         // inj<alice>(valAlice)
funcAlice(valDyn);                         // cast<alice>(valDyn)
```

For mutable array parameters, array invariance applies. A parameter of type `T[]@L` accepts an argument of type `T[]@M` only when the element types are exactly the same and the location rule is satisfied.

Disallowed:

```cbs
function add@alice(a: integer@alice): integer@alice {
    return a;
}

add(10@every);
```

Use an argument already located at `alice`:

```cbs
add(10@alice);
```

Or, when the value only exists at `every`, localize it first:

```ts
let arr: float[]@every = [1.1, 2.2]@every;
let arrAlice: float[]@alice <- arr;
average(arrAlice);
```

A local function parameter explicitly declared as `T@every` is invalid for a
separate reason, stated in [§8.4](#local-function-strict-location-rule).

#### In a Choreography Context <a id="call-in-a-choreography-context"></a>

The following function calls are allowed:

* calls to choreography functions;
* calls to local functions.

#### In a Local Context <a id="call-in-a-local-context"></a>

Inside `function@alice`, only `@alice` local functions may be called.

The following are disallowed:

* calls to local functions at other endpoints;
* calls to choreography functions.

`.length` and `.push` are array operations, and `print` is a compiler-known
operation, not calls (spec [§5.15](#expressions)), so this rule does not reach them: they may be
used in any context, local or choreography.

### 7.18 Print Typing <a id="print-typing"></a>

`print(e)` writes the value of `e` to the output of the endpoints that hold it
(spec [§5.15](#expressions)).

```text
e : T@L
---------------
print(e) : void
```

`T` may be any value type: `integer`, `float`, `boolean`, `string`, `null`, or
an array type (spec [§7.1](#base-types)). There is no `any` type behind this. The rule accepts
each type as it is, and `print` has no parameter that a coercion could aim at
(spec [§7.8](#coercion)).

`print` does not move a value. It runs where its argument is located:

| `L` | Printed at |
|---|---|
| an individual location `p` | `p` alone |
| `every` | every endpoint, each printing its own copy (spec [§3.4](#every)) |
| `dyn` | every endpoint that holds the payload (spec [§3.5](#dyn)) |

To print at `bob` a value that is at `alice`, transfer it first:

```ts
let x: integer@alice = 10@alice;
print(x);                    // printed at alice
let y: integer@bob <- x;
print(y);                    // printed at bob
print("ready"@every);        // printed at every endpoint
```

A print of a `dyn` value is a dynamic operation (spec [§7.9](#dynamic-operations)). Every endpoint
performs it, and the endpoints that hold the payload print it: the owner once
the value is bound to an individual location, and every endpoint while it is
bound to `every` or still unbound (spec [§3.5](#dyn)). A print adds no constraint and
binds nothing: printing a value does not decide where it is. Outside strict
mode, then, `print(1);` at top level prints at every endpoint, since the omitted
location makes `1` an unbound `1@dyn` (spec [§8.2](#omitted-locations)). Inside a local function at
`P` it prints at `P` only, in either mode: there `1` is `1@P`
(spec [§7.20.8](#local-function-location-inference)).

Internally the result travels with the argument's location `L`, which tells
endpoint projection where the print happens (spec [§12.17](#print-projection)), as a push's does
(spec [§7.16](#array-typing)). Like the location of any `void`, it is never written or shown
(spec [§7.3](#void)).

`print` is not a call (spec [§5.15](#expressions)). What a local context may call (spec [§7.17](#function-call-typing))
does not limit it, so it may be used in a local function as well as in a
choreography context. In `function f@alice` every value is at `alice`
(spec [§8.4](#local-function-strict-location-rule)), so a print there always prints at `alice`.

`print(e)` is a void computation (spec [§7.2](#located-types)): it can only stand as an expression
statement, and every value position rejects it (spec [§16.43](#invalid-use-of-void)). Its argument is a
value position, so a void computation is rejected there too. So is `[]`, which
has no array type there to take its element type from (spec [§16.33](#cannot-infer-empty-array-element-type)).

```ts
function g@alice(): void { return; }

print(g());                  // invalid: g() produces no value
print([]@alice);             // invalid: cannot infer the element type
```

What `print` writes is what BlueScript's own `print` writes for the value.
BlueScript's `print` takes an `any`, so the value is held as an `any` on the
way, with the limits of spec [§7.1.1](#array-types): printing an `integer` outside −2^29 to
2^29 − 1, or a `float` that an `any` cannot hold, gives an unspecified result.
The format — the line break after each value, and how a string, `null` or an
array looks — is BlueScript's, and is not specified here.

Each endpoint prints in its own program order. Between endpoints there is no
order: two prints at different endpoints may appear in either order, whatever
their order in the program.

### 7.19 Return Typing <a id="return-typing"></a>

When a function has an explicit return type:

```ts
return expr;
```

is allowed if the type of `expr` is compatible with the function return type,
by the same rule as assignment (spec [§7.10](#assignment-typing)): its base type must be a subtype of
the return base type, and its location must be consistent with the return
location (spec [§7.7](#location-consistency-and-join)). So a function declared to return `float@alice` cannot
`return 1@alice;`; it can `return 1@alice as float;` (spec [§7.15](#numeric-conversion)).

A function whose return type is at `dyn` injects a static value it returns, and a
function with a static return type casts a `dyn` value it returns:

```ts
function toAlice(a: integer@dyn): integer@alice {
    return a;                    // cast<alice>(a)
}
```

```ts
return;
```

is allowed only if the function return type is `void`.

When a function omits its return type, the return type is inferred according to [Section 7.20](#type-inference).

#### Return Coverage <a id="return-coverage"></a>

A function whose return type is not `void` must return a value on every
execution path. This holds whether the return type is written or inferred, and
is checked by the same conservative syntactic analysis in both cases
(spec [§7.20.6](#return-coverage-for-non-void-functions), [§16.44](#missing-return-in-a-non-void-function)).

```ts
function bad@alice(c: boolean@alice): integer@alice {   // invalid (spec §missing-return-in-a-non-void-function)
    if (c) {
        return 1@alice;
    }
}
```

A `void` function needs no coverage: falling off the end is the same as
`return;`.

### 7.20 Type Inference <a id="type-inference"></a>

ChoreoBS v1 supports simple, local type inference. This feature does not perform general location inference. It only uses types and locations already determined by literals, identifiers, function signatures, expression typing, and the location of the local function being checked (spec [§7.20.8](#local-function-location-inference)). Where it determines no location, the location is `dyn`, or an error in strict mode (spec [§8.2](#omitted-locations), [§8.3](#strict-mode)). Inference itself works the same way in both modes.

The compiler should elaborate inferred constructs into a fully typed AST before Endpoint Projection.

#### 7.20.1 Let Type Inference <a id="let-type-inference"></a>

For an ordinary initialized `let` declaration:

```ts
let x = expr;
```

if:

```text
expr : T@L
```

then:

```text
x : T@L
```

Examples:

```ts
let x = 1@alice;          // x : integer@alice
let y = x + 2@alice;      // y : integer@alice
let c = y < 10@alice;     // c : boolean@alice
let e = true@every;       // e : boolean@every
let a = 32;               // a : integer@dyn — the literal is 32@dyn
```

A `let` declaration with a fully explicit type annotation is still checked using the normal assignment typing rule.

```ts
let x: float@alice = 1.0@alice;
```

The annotation does not convert the initializer. `let x: float@alice = 1@alice;`
is invalid, because `integer` is not a subtype of `float` (spec [§16.6](#type-mismatch)); the
conversion has to be written: `let x: float@alice = 1@alice as float;`
(spec [§7.15](#numeric-conversion)).

#### Partial Annotations <a id="partial-annotations"></a>

The location may be omitted from the type annotation of an initialized `let`. It
is then taken from the initializer, while the base type comes from the
annotation:

```ts
let a: integer = 3@mcu;   // a : integer@mcu
let b: float = 3.0@mcu;   // b : float@mcu
```

The annotated base type is still checked against the initializer by the
assignment rule (spec [§7.10](#assignment-typing)), so it does not convert the initializer either:

```ts
let b: float = 3@mcu;     // invalid (spec §type-mismatch)
```

A written location always wins, so a mismatch is still reported:

```ts
let c: integer@server = 3@mcu;   // invalid (spec §invalid-assignment-across-locations)
```

This applies to a `for` initializer `let` as well (spec [§7.20.2](#for-initializer-let-type-inference)). Where there is
no initializer to read the location from, a type written without its location
is `dyn` instead (spec [§8.2](#omitted-locations)): a function parameter, and the destination of a
transfer `let`, which never takes the source's location
(spec [§7.20.3](#transfer-let-does-not-infer-destination-type)). A return type written without its location takes it
from the `return` statements (spec [§7.20.4](#function-return-type-inference)). Inside a local function, each of these
takes the function's location instead (spec [§7.20.8](#local-function-location-inference)).

#### 7.20.2 For Initializer Let Type Inference <a id="for-initializer-let-type-inference"></a>

For a C-style `for` initializer:

```ts
for (let i = expr; cond; update) {
    ...
}
```

if:

```text
expr : T@L
```

then:

```text
i : T@L
```

#### 7.20.3 Transfer Let Does Not Infer Destination Type <a id="transfer-let-does-not-infer-destination-type"></a>

Transfer declarations keep the existing syntax:

```ts
let y: integer@bob <- x;
```

The type annotation is required. Unlike an initialized `let`
(spec [§7.20.1](#let-type-inference)), the location is **not** taken from the right-hand side: the
destination location is the whole point of a transfer, and inferring it from the
source would make every transfer a no-op local copy. A destination written
without its location is `dyn` instead (spec [§8.2](#omitted-locations)), which makes the transfer
dynamic (spec [§11.5](#dynamic-transfer)):

```ts
let y: integer <- x;      // y : integer@dyn
```

In strict mode that omission is an error (spec [§8.3](#strict-mode)). Inside a local function the
destination takes the function's location (spec [§7.20.8](#local-function-location-inference)), in either mode; that is
not inference from the source, and a transfer there is a local copy anyway
(spec [§11.4](#local-copy)). A transfer `let` without
a type remains invalid in either mode, since its base type is needed
(spec [§16.18](#transfer-let-without-type-annotation)):

```ts
let y <- x;
```

#### 7.20.4 Function Return Type Inference <a id="function-return-type-inference"></a>

A function declaration may omit its return type:

```ts
function f@L(params) {
    body
}
```

The compiler infers the function return type from `return` statements in the body.

What a body returns may be a top-level constant it uses (spec [§6.6](#top-level-let)), so the type can
depend on that constant's. Spec [§6.7](#top-level-constant-initialization-order) is what keeps this from going in a circle: the
constants a function reaches are declared before any top-level statement that
calls it.

```ts
const limit = 10@alice;

function cap() {        // returns integer@alice, the type of `limit`
    return limit;
}
```

If all returns are bare `return;`, or if there are no return statements, the inferred return type is `void`, which carries no location (spec [§7.3](#void)).

For `return expr;`, the return candidate is the type of `expr`.

For multiple return candidates, the compiler computes their least upper bound using the following rules.

For base types:

```text
lub(T, T) = T
```

All other base type combinations are invalid. In particular, `integer` and
`float` have no LUB, since neither is a subtype of the other (spec [§7.5](#subtyping)).

For array types, return type inference uses array invariance:

```text
lub(T[], T[]) = T[]
```

All other array type combinations are invalid. In particular, `integer[]` and `float[]` do not have a LUB for inferred return types.

For locations, the least upper bound is the join (spec [§7.7](#location-consistency-and-join)), extended to
concrete locations that differ:

```text
lub_location(L, L)     = L
lub_location(L, dyn)   = dyn
lub_location(dyn, L)   = dyn
lub_location(p, q)     = dyn    where p and q are different concrete locations
```

The last case has no location to agree on, so it is `dyn`; in strict mode it is
an error instead (spec [§16.22](#incompatible-inferred-return-locations)). The other cases are the same in both modes, so a
function that returns an explicit `dyn` value has a `dyn` return type in strict
mode too. The values returned are then coerced to the inferred return type
(spec [§7.8](#coercion)):

```ts
function boo(flag: boolean@every) {    // returns integer@dyn
    if (flag) { return 3@alice; }      // inj<alice>(3@alice)
    else { return 4@every; }           // inj<every>(4@every)
}
```

A local function holds no `dyn` (spec [§8.4](#local-function-strict-location-rule)), so in a local function two different
locations among the returns are always an error.

Example:

```ts
function f@alice(c: boolean@alice) {
    if (c) {
        return 1.5@alice;
    } else {
        return 2.5@alice;
    }
}
```

The return type is inferred as `float@alice`. Had the first branch returned
`1@alice`, the candidates would be `integer@alice` and `float@alice`, which have no
LUB, and the function would be rejected (spec [§16.21](#incompatible-inferred-return-types)); returning
`1@alice as float` there would be accepted (spec [§7.15](#numeric-conversion)).

#### Partial Return Annotations <a id="partial-return-annotations"></a>

A choreography function may write the base type of its return type and leave out
its location:

```ts
function bar(): integer {      // returns integer@alice
    return 3@alice;
}
```

As with a partial annotation on a `let` (spec [§7.20.1](#let-type-inference)), the base type comes from
the annotation and the location from inference: the location is the
`lub_location` of the values returned, as above, and the returns are then
checked against the resulting type like those of a written one. A function with
no value to return takes no location from it, and is reported by the return
checks instead (spec [§7.19](#return-typing)).

The location is inferred in strict mode too. A local function's return type
written without its location is not inferred from its returns: it is at the
function's location, like any other location left out there
(spec [§7.20.8](#local-function-location-inference)).

#### 7.20.5 Mixing `return;` and `return expr;` <a id="mixing-return-and-return-expr"></a>

A function with an omitted return type must not mix bare `return;` and value-returning `return expr;`.

#### 7.20.6 Return Coverage for Non-`void` Functions <a id="return-coverage-for-non-void-functions"></a>

If a function with an omitted return type contains any `return expr;`, then all execution paths must return a value. The same requirement applies to a function with a written non-`void` return type (spec [§7.19](#return-typing)).

ChoreoBS v1 requires only a conservative syntactic return coverage analysis. At minimum, an implementation must accept:

- a final `return expr;` statement in the function body;
- an `if (...) { ... } else { ... }` statement where both branches are definitely returning;
- nested combinations of the above.

The compiler may reject programs whose totality is not proven by this conservative analysis.

#### 7.20.7 Parameter Types Are Not Inferred <a id="parameter-types-are-not-inferred"></a>

Function parameter types are not inferred in ChoreoBS v1. A parameter must
always write its base type; only its location may be left out. In a choreography
function it is then `dyn` (spec [§8.2](#omitted-locations)), or an error in strict mode (spec [§8.3](#strict-mode)); in a
local function it is the function's location (spec [§7.20.8](#local-function-location-inference)).

Disallowed:

```ts
function add@alice(a, b) {
    return a + b;
}
```

Allowed:

```ts
function add@alice(a: integer@alice, b: integer@alice) {
    return a + b;
}

function add2@alice(a: integer, b: integer) {   // a, b : integer@alice
    return a + b;
}
```

#### 7.20.8 Local Function Location Inference <a id="local-function-location-inference"></a>

Inside a local function declared at an individual location `P`
(spec [§10.1](#function-kinds)), a location that is left out, and that nothing else determines,
is `P`. These are the omissions that [§8.2](#omitted-locations) makes `dyn` elsewhere, as they occur
in a local function:

* a literal, and an array literal together with its unlocated literal elements;
* a parameter type;
* the destination of a transfer `let`;
* a return type written without its location.

The type of a `let` or a `for` initializer `let` needs no rule of its own: it
takes its location from its initializer (spec [§7.20.1](#let-type-inference)), which is at `P`.

```ts
function sum@alice(a: integer, b: integer): integer {
    let xs: integer[] = [a, b];
    let c: integer <- a;
    return xs[0] + xs[1] + c + 1;
}
```

is the same function as

```ts
function sum@alice(a: integer@alice, b: integer@alice): integer@alice {
    let xs: integer[]@alice = [a, b]@alice;
    let c: integer@alice <- a;
    return xs[0@alice] + xs[1@alice] + c + 1@alice;
}
```

Every value in a local function is at `P`, and `dyn` is not allowed there
(spec [§8.4](#local-function-strict-location-rule)), so `P` is the only location an omission there could stand for. It is
therefore inferred, not left to run time: an omission in a local function is
never `dyn`, and it is not an error in strict mode (spec [§8.3](#strict-mode)). It means the same
in both modes.

The other sources of a location come first: a written location, the
initializer of a `let` (spec [§7.20.1](#let-type-inference)), the `return` statements of a function
whose return type is omitted altogether (spec [§7.20.4](#function-return-type-inference)), and an annotated array
literal for its elements (spec [§5.17](#array-literals)). In a function that type-checks, each
of these is `P` as well, so the order changes no location; a value at another
location is reported where it occurs (spec [§8.4](#local-function-strict-location-rule)).

A return type written without its location, `function f@P(): integer`, is at
`P` like any other omission. It is not a partial annotation
(spec [§7.20.4](#function-return-type-inference)): nothing is inferred from the returns, so the return type is
known before the body is checked, and a recursive local function may write it
(spec [§7.20.9](#inference-and-recursion)).

None of this reaches beyond local functions. The location of a function
declaration is never an omission: without one, `function f(...)` is a
choreography function (spec [§10.1](#function-kinds)). In a choreography function and at top
level the context still supplies no location (spec [§8.1](#explicit-location-annotations)), and an omission
that nothing infers is `dyn` (spec [§8.2](#omitted-locations)). Nor does it admit `dyn` into a local
function: writing it there remains an error (spec [§16.4](#dyn-in-a-local-function)).

#### 7.20.9 Inference and Recursion <a id="inference-and-recursion"></a>

Local function recursion is allowed, but recursive local functions must write their return type in ChoreoBS v1. Its location may be left out (spec [§7.20.8](#local-function-location-inference)); its base type may not.

Therefore:

- direct or indirect recursive local functions with omitted return types are compile-time errors;
- direct or indirect recursive local functions with written return types, with or without their location, are allowed;
- choreography recursion remains unsupported.

### 7.21 Imported Signatures <a id="imported-signatures"></a>

The compiler reads each source file an import declaration names
(spec [§5.19](#import-declarations)), as BlueScript reads it — as a TypeScript module — and takes from it
the type of each name imported from it. It checks the file only as this section
says. Anything else wrong with the file, such as a type error in a function
body, is reported by BlueScript when the endpoint's program is built.

An error about a file is reported at the import that names it, with the file,
line and column in the message.

#### Exports <a id="imported-exports"></a>

A name can be imported when the file declares it at top level with `export`,
in one of two forms:

```ts
export function name(p1: T1, ..., pn: Tn): R { ... }
export const name: T = e;
```

* A function writes a type on every parameter, and its return type. A
  parameter is a plain name: no `?`, no default value, no `...`. The function
  is not `async` and not a generator, takes no type parameters, and has a body.
* A constant writes its type, or has a literal initializer that gives it one
  (below). Only `const` declares a constant: an `export let` can be changed by
  its own module, and cannot be imported.
* A class, and a `const` holding a function, cannot be imported.
* `export { name }`, a list without a declaration, does not export `name`.
  BlueScript ignores such a list, so a name is exported only by `export` on its
  declaration.

Importing any other declaration is an error (spec [§16.67](#unsupported-export)), and so is importing
a name the file does not export (spec [§16.66](#name-not-exported)). A declaration that no import
names is not looked at.

#### Types <a id="imported-types"></a>

Each type of an imported signature is read as BlueScript reads it, and must be
one ChoreoBS has:

| Written in the file | Type in ChoreoBS |
|---|---|
| `integer`, `number` | `integer` |
| `float` | `float` |
| `boolean` | `boolean` |
| `string` | `string` |
| `null`, `undefined` | `null` |
| `void`, as a return type | `void` |

Every type is located at the import's endpoint. `function f(x: integer): float`,
imported at `alice`, is `f@alice(x: integer@alice): float@alice`.

Any other type is an error (spec [§16.67](#unsupported-export)): `any`, `int32`, a union, a function
type, a class, and **every array type**. ChoreoBS emits every array as
BlueScript's `any[]` (spec [§13.1](#type-mapping)). BlueScript accepts an `any[]` where an
`integer[]` is expected, but checks the array when the call runs, and an
`any[]` fails that check: the call would stop the program. A file's own
`any[]` would get the right array, but then nothing would say what its elements
are.

A constant written without a type takes its initializer's type when the
initializer is a literal, as BlueScript gives it:

* a number written only with digits, hexadecimal digits and `x` — `10`, `0x1F`,
  `1e3` — is an `integer`, and any other number, such as `1.5`, is a `float`;
* `-` before a number gives the number's type;
* a string literal is a `string`, `true` and `false` are `boolean`, and `null`
  is `null`.

Any other initializer needs the type written.

#### What an Imported File May Not Do <a id="imported-file-restrictions"></a>

Each of these is an error (spec [§16.65](#unsupported-imported-file)), whatever the file's import names:

* A syntax error.
* An `export ... from`. BlueScript exports nothing through
  `export { a } from "./m"`, and does not accept `export * from "./m"`, so a
  name the file seems to export this way is not exported. Nor does BlueScript
  accept `import ... =`.
* A use of the name of a communication API function, such as `sendInteger`,
  `receiveFloat` or `broadcastArray` (spec [§13.14](#communication-api)). A program's communications
  are the transfers of its choreography (spec [§11](#transfer-semantics)), each projected to a send at
  one endpoint and a receive at another. A message sent from inside an imported
  function would have no receive in any endpoint's program.

A file may import from other source files and from packages (spec [§2.6](#bluescript-packages)). The
compiler does not follow those imports: it neither reads the files they name
nor checks that they exist, which BlueScript does when the endpoint's program
is built. Nor does it look into C code that a file writes in a `code` template.
A communication made in either place is just as unpaired, and the compiler
cannot see it.

***

## 8. Location Annotation Rules <a id="location-annotation-rules"></a>

### 8.1 Explicit Location Annotations <a id="explicit-location-annotations"></a>

A location is written as a location annotation on a type or a literal. Where it
is left out, it is taken from the program itself — from the initializer of a
`let` (spec [§7.20.1](#let-type-inference)), from the `return` statements of a function
(spec [§7.20.4](#function-return-type-inference)), or, inside a local function, from the function's own location
(spec [§7.20.8](#local-function-location-inference)) — and where nothing determines it, it is `dyn` (spec [§8.2](#omitted-locations)).

In strict mode (spec [§8.3](#strict-mode)), that last case is an error instead: every type
annotation and every literal must carry its own location annotation unless one
is inferred. Inside a local function the last case does not arise.

`void` is outside this rule rather than an exception to it: it has no value to
place, so it takes no location annotation at all, and writing one is an error
(spec [§7.3](#void), [§16.43](#invalid-use-of-void)).

Outside a local function, a location is **never** inferred from the surrounding
*context*: an omitted location becomes `dyn`, not the location of the code
around it. The `let` case is not a context rule — the location comes from the
declaration's own right-hand side. A local function is the one context that
does supply a location, because every value in it must be at the function's
location anyway (spec [§8.4](#local-function-strict-location-rule)).

Allowed, in a local function, in either mode — the two declarations mean the
same:

```ts
function add@alice(a: integer, b: integer): integer {
    return a + b + 1;
}

function add2@alice(
    a: integer@alice,
    b: integer@alice
): integer@alice {
    return a + b + 1@alice;
}
```

In a choreography function and at top level, an omission that nothing infers is
`dyn`:

```ts
function f(): void {
    let x: integer = 1;              // x : integer@dyn — the literal is 1@dyn
    let y: integer = 1@alice;        // y : integer@alice (§let-type-inference)
    let z: integer@alice = 1@alice;  // valid
}
```

```ts
let x = 1;                       // x : integer@dyn
let y: integer = 1;              // y : integer@dyn
let z: integer = 1@alice;        // z : integer@alice
let w: integer@alice = 1@alice;  // valid
```

In strict mode `x` and `y` are errors (spec [§16.3](#location-annotation-omission)). Note that in
`let y: integer = 1;` it is the **literal** that is missing its location, not the
type annotation: the annotation takes its location from the initializer, and the
initializer has none.

This rule is about the location annotation on a **type or literal**. It does not
reach a **function declaration** at all. There, the presence of a location
selects the kind of function — a location declares a local function, no location
declares a choreography function (spec [§10.1](#function-kinds)) — so neither form is an omission.

This rule governs location annotations only. It does not affect **type**
inference ([§7.20](#type-inference)), which is a separate mechanism:

```ts
let x = 1@alice;   // valid: `x : integer@alice` is inferred from the initializer
```

and a function may still omit its return type entirely, in which case the return
type — including its location — is inferred from the `return` statements ([§7.20.4](#function-return-type-inference)).

```ts
function f@alice(a: integer@alice) {   // valid: returns integer@alice
    return a;
}
```

Nor does it affect the filling of unlocated literal elements of an array literal
from that literal's **own** annotation ([§5.17](#array-literals)), which reads no context:

```ts
let xs: integer[]@alice = [1, 2, 3]@alice;   // valid
```

### 8.2 Omitted Locations <a id="omitted-locations"></a>

Where a location is omitted and simple inference (spec [§7.20](#type-inference)) does not
determine it, it is `dyn`:

* a literal without a location annotation (spec [§5.16](#located-literals));
* a parameter type without a location, in a choreography function;
* the destination of a transfer `let` written without a location
  (spec [§7.20.3](#transfer-let-does-not-infer-destination-type));
* an array literal without an annotation, whose elements are not consulted
  (spec [§5.17](#array-literals));
* a return type whose location the `return` statements do not determine
  (spec [§7.20.4](#function-return-type-inference)).

Inside a local function, simple inference always determines it: an omission
there is the function's location (spec [§7.20.8](#local-function-location-inference)), never `dyn`, so this list
applies to choreography functions and the top level only.

A variable whose initializer is at `dyn` is at `dyn` as well, but by inference
(spec [§7.20.1](#let-type-inference)), not by omission: the location is determined, and the variable is
`dyn` in strict mode too.

A function declaration's location is not the location of a value.
`function f(...)` without one is a choreography function (spec [§10.1](#function-kinds)), never a
`dyn` one.

Some things cannot be omitted, in either mode:

* the initializer of a `let`: an uninitialized `let` remains an error
  (spec [§16.5](#uninitialized-let)). Initialize a variable that every branch assigns with a
  `dyn` value, such as `let raw: float@dyn = 0.0@dyn;`; the initial value is
  unbound, and each branch replaces it, so this means the same;
* the type of a transfer `let`, since its base type is needed
  (spec [§16.18](#transfer-let-without-type-annotation)): `let y <- x;` remains an error.

The omitted locations of this program:

```ts
3;
let a = 32;
let b: integer <- 32@alice;
function foo(a: integer) {}
function boo(flag: boolean@every) {
    if (flag) { return 3@alice; }
    else { return 4@every; }
}
function bar(): integer {
    return 3@alice;
}
function baz@bob(x: integer) {
    return x + 1;
}
```

are completed as:

```ts
3@dyn;
let a: integer@dyn = 32@dyn;
let b: integer@dyn <- 32@alice;
function foo(a: integer@dyn): void {}
function boo(flag: boolean@every): integer@dyn {
    if (flag) { return 3@alice; }
    else { return 4@every; }
}
function bar(): integer@alice {
    return 3@alice;
}
function baz@bob(x: integer@bob): integer@bob {
    return x + 1@bob;
}
```

A written `@dyn` is the same location as an omitted one: `let a: integer@dyn = 32@alice;`
declares `a` at `dyn`, whatever its initializer.

### 8.3 Strict Mode <a id="strict-mode"></a>

With `"implicitDyn": false` in `choreobs.json` (spec [§2.2](#choreobs-json)), an omitted location
that simple inference does not determine is an error instead of `dyn`. Only a
location written as `@dyn`, or inferred from one, is dynamic.

```json
{
  "name": "example",
  "implicitDyn": false,
  "endpoints": [
    { "name": "alice", "board": "host" },
    { "name": "bob", "board": "host" }
  ]
}
```

* The default is `true`: an omission is `dyn` (spec [§8.2](#omitted-locations)).
* Under `false`, each omission of [§8.2](#omitted-locations) is reported instead:
  * a literal, a type, or a parameter type without its location
    (spec [§16.3](#location-annotation-omission));
  * an array literal without its annotation (spec [§16.31](#array-literal-without-required-location));
  * a transfer `let` without a destination location
    (spec [§7.20.3](#transfer-let-does-not-infer-destination-type));
  * returns at two different concrete locations (spec [§16.22](#incompatible-inferred-return-locations)).
* Simple inference works exactly as in the default mode (spec [§7.20](#type-inference)): a
  partial annotation on a `let` takes its location from the initializer, a
  partial return annotation takes it from the returns, a written `dyn` among
  the returns makes the return type `dyn`, and a location left out inside a
  local function is the function's location.

A program that writes every location means the same in both modes.

Strict mode is unrelated to the Local Function Strict Location Rule
(spec [§8.4](#local-function-strict-location-rule)): inside a local function, an omission is the function's location
in either mode (spec [§7.20.8](#local-function-location-inference)), and `dyn` is not allowed at all.

### 8.4 Local Function Strict Location Rule <a id="local-function-strict-location-rule"></a>

For a local function declared at an individual location `P`:

```cbs
function f@P(...) {
    ...
}
```

all parameters, return values, and expressions evaluated in the function body must be located at `P`.

Rules:

- Every parameter type must be located at `P`.
- A parameter type explicitly located at another individual location `Q`, where `Q != P`, is a compile-time error.
- A parameter type explicitly located at `every` is a compile-time error.
- The explicit or inferred return type of a local function must be located at `P`, unless it is `void`, which has no location (spec [§7.3](#void)) and is allowed in a local function like any other.
- A return type explicitly or implicitly located at another individual location `Q`, where `Q != P`, is a compile-time error.
- A return type explicitly or implicitly located at `every` is a compile-time error.
- Every **value** expression evaluated inside the local function body must have a type located at `P`. A void computation has no location to check (spec [§7.2](#located-types)); a call to a local `void` function is instead governed by [§10.3](#calling-functions-from-a-local-context), which already restricts a local body to calling local functions at `P`.
- Every variable declared in the local function body must have a type located at `P`. This includes the destination type of a transfer `let`, which is a declaration and not an expression.
- Values located at `every` are not allowed inside local function bodies.
- Values located at another individual location are not allowed inside local function bodies.
- A transfer inside a local function has the function's own location on both sides, so it is always a local copy (spec [§11.4](#local-copy)). This follows from the rules above rather than being a separate restriction: the source must be an expression at `P`, and the destination must be a variable at `P`.
- `dyn` is not allowed anywhere in a local function: not in a parameter type, the return type, a variable type, a literal or an array literal, nor as the location of any value evaluated in the body (spec [§16.4](#dyn-in-a-local-function)). Since `dyn ~ P` holds (spec [§7.7](#location-consistency-and-join)), the rules above would otherwise accept it.
- No location is left to `dyn` in a local function, in either mode: each one is written or inferred, and a location that nothing else determines is `P` (spec [§7.20.8](#local-function-location-inference)). Under the rules above `P` is the only location it could be.

`dyn` is excluded because a local function runs at one endpoint only. A dynamic
operation in its body would be performed at that endpoint alone, and the
endpoints would no longer add the same location constraints in the same order
(spec [§3.5](#dyn)).

Allowed:

```cbs
function add@bob(a: integer@bob, b: integer@bob): integer@bob {
    return a + b;
}
```

Allowed — the locations left out are `bob` (spec [§7.20.8](#local-function-location-inference)):

```cbs
function add@bob(a: integer, b: integer): integer {
    return a + b + 1;
}
```

Disallowed:

```cbs
function bad@bob(a: integer@alice, b: integer@bob): integer@bob {
    return a;
}
```

Disallowed:

```cbs
function bad@bob(x: integer@every): integer@bob {
    return x;
}
```

Disallowed:

```cbs
function bad@bob(): integer@every {
    return 1@every;
}
```

Disallowed:

```cbs
function bad@bob(): integer@alice {
    return 1@alice;
}
```

Disallowed:

```cbs
function bad@bob(): integer@bob {
    let x = 1@every;
    return x;
}
```

Disallowed — the destination of a transfer is a variable of this body, so it
must be at `bob`. Were this accepted, `bob` would send from inside a function
that only `bob` runs, and `alice` would have no matching receive:

```cbs
function bad@bob(x: integer@bob): integer@bob {
    let y: integer@alice <- x;
    return x;
}
```

Disallowed — `dyn`, written; an omitted location is `bob` instead:

```cbs
function bad@bob(a: integer@dyn): void {}

function bad@bob(): void {
    let x: integer@bob = 1@dyn;
}

function bad@bob(): void {
    [1]@dyn;
}
```

The same holds of a top-level constant the body uses (spec [§6.6](#top-level-let)): it is a value
the body evaluates, so it must be at `bob`. A constant at `every`, at another
endpoint or at `dyn` cannot be used there at all, not even to assign or push to
the elements of an array it holds. A constant whose location is left out to
`dyn`, such as `const n = 32;` outside strict mode (spec [§8.2](#omitted-locations)), is one of these.

Disallowed — constants at `every`, at `alice` and at `dyn`:

```cbs
const k: integer@every = 1@every;
const a: integer@alice = 1@alice;
const xs: integer[]@dyn = [1, 2]@dyn;

function bad@bob(): integer@bob {
    return k;
}

function bad@bob(): integer@bob {
    return a;
}

function bad@bob(): void {
    xs[0@bob] = 3@bob;
}
```

Allowed:

```cbs
const b: integer@bob = 1@bob;

function ok@bob(): integer@bob {
    return b + 1;
}
```

This rule is intentionally stricter than ordinary location availability. In particular, neither `T@every` nor `T@dyn` is permitted in local function parameters, local function return types, or local function bodies.

### 8.5 `@every` Literals <a id="every-literals"></a>

`@every` literals are allowed in choreography contexts.

```ts
true@every
1@every
"ok"@every
null@every
```

`@every` literals are not allowed inside local function bodies, because local functions use the Local Function Strict Location Rule.

### 8.6 `@dyn` Literals <a id="dyn-literals"></a>

A literal at `dyn` — written `c@dyn`, or written with no location at all outside
a local function (spec [§8.2](#omitted-locations)) — is a fresh, unbound dynamically located value
(spec [§3.5](#dyn)):

```ts
3@dyn;
4.5@dyn;
true@dyn;
"Hello"@dyn;
null@dyn;
```

Every endpoint holds the same payload for it, with a location variable of its own,
and the value is placed wherever it is first used (spec [§7.8](#coercion)). Evaluating one
is a dynamic operation (spec [§7.9](#dynamic-operations)): it creates a location variable, so even a
`dyn` literal standing alone as a statement is kept at every endpoint
(spec [§12.2](#dyn-lowering)).

`@dyn` literals are allowed in choreography contexts. They are not allowed inside
local function bodies (spec [§8.4](#local-function-strict-location-rule)); a literal written with no location there is
not one, but is at the function's location (spec [§7.20.8](#local-function-location-inference)).

***

## 9. Statements and Expressions <a id="statements-and-expressions"></a>

### 9.1 Semicolons <a id="semicolons"></a>

In v1, statement-ending semicolons are required.

Required, inside a function at `alice`:

```ts
let x: integer = 1;
x = x + 1;
return x;
```

Not required after the closing brace of a compound construct:

```ts
function f@alice(): void {
    return;
}
```

```ts
function g@alice(c: boolean): void {
    if (c) {
        return;
    }

    while (c) {
        return;
    }

    for (let i = 0; i < 10; i = i + 1) {
        return;
    }
}
```

These are written inside functions because `return` only appears in one
(spec [§5.13](#return-statement)). The locations they leave out are `alice`, the function's own
(spec [§7.20.8](#local-function-location-inference)).

### 9.2 Let and Const Statements <a id="let-statements"></a>

Only initialized `let` and `const` declarations are allowed.

```ts
let x: integer@alice = 1@alice;
const k: integer@alice = 2@alice;
```

Transfer declarations are also allowed.

```ts
let y: integer@bob <- x;
const z: integer@bob <- x;
```

### 9.3 Assignment Statements <a id="assignment-statements"></a>

Assignment is a statement only.

```ts
x = y;
```

Assignments do not produce values.

### 9.4 Transfer Statements <a id="transfer-statements"></a>

A transfer is a statement only.

```ts
y <- x;
```

Transfer statements do not produce values.

### 9.5 If Statements <a id="if-statements"></a>

`else` is optional.

```ts
if (c) {
    return;
}
```

```ts
if (c) {
    return;
} else {
    return;
}
```

### 9.6 While Statements <a id="while-statements"></a>

`while` is a statement.

```ts
while (c) {
    // body
}
```

### 9.7 For Statements <a id="for-statements"></a>

Only C-style `for` loops are supported.

```ts
for (let i = 0@every; i < 10@every; i = i + 1@every) {
    // body
}
```

`for-of` and `for-in` are not supported.

### 9.8 Break and Continue <a id="break-and-continue"></a>

`break` and `continue` are not supported in v1.

### 9.9 Expression Statements <a id="expression-statements"></a>

Expression statements are allowed. The expression need not have an effect:
`xs[0@alice];` and `xs.length;` are legal, if pointless. v1 performs no
dead-code elimination (spec [§17.7](#future-cleanup-optimizations)) and singles out no expression form here.
A dynamic operation standing as a statement, such as `3;` — that is, `3@dyn;` —
is never removed: it creates a location variable at every endpoint
(spec [§12.2](#dyn-lowering)).

After EPP, expressions unrelated to the current endpoint may be transformed into `nothing(...)` or `null`.

These compiler-generated artifacts are cleaned up by the Projected AST Cleanup pass defined in [Section 13.15](#projected-ast-cleanup).

`xs.push(v);` is an expression statement like any other. Its expression is a
void computation (spec [§7.2](#located-types), [§7.16](#array-typing)), so this is the only position it may
stand in; using it as a subexpression or an initializer is a type error
(spec [§16.43](#invalid-use-of-void)).

***

## 10. Function Rules <a id="function-rules"></a>

### 10.1 Function Kinds <a id="function-kinds"></a>

ChoreoBS has two kinds of functions, distinguished by how many endpoints run
them.

A local function runs at the single endpoint named by its location. A
choreography function runs at **every** endpoint: each endpoint executes its own
projection of it (spec [§12.12](#function-projection)). The two are separate kinds, not one derived from
the other — a choreography function is not a local function with something left
out. Since it is not the function of any one endpoint, no single location names
it, and its declaration carries none.

#### Choreography Function <a id="choreography-function-kind"></a>

Declared with no location:

```ts
function f(...): T@L {
    ...
}
```

or, with inferred return type:

```ts
function f(...) {
    ...
}
```

- Describes choreography.
- May contain transfers.
- Is projected to all endpoints.
- May call choreography functions and local functions (spec [§10.2](#calling-local-from-choreography)).
- Allows return type inference.
- Recursion, direct or mutual, is not supported in v1 (spec [§10.4](#recursion)).
- Its parameters and return type may be at `dyn`: written, or, outside strict mode, through an omission that nothing infers (spec [§8.2](#omitted-locations), [§8.3](#strict-mode)).
- May use the top-level constants, at any location (spec [§6.6](#top-level-let)).

A location on a function declaration names the one endpoint that runs the
function, so it always declares a local function and must be an individual
location. Neither `@every` nor `@dyn` is a function location (spec [§16.41](#every-on-a-function-declaration),
[§16.42](#dyn-on-a-function-declaration)); both remain available as value locations, e.g. `boolean@every` and
`integer@dyn`. A declaration without a location is a choreography function; it is
not a `dyn` function, and there is no such thing.

#### Local Function <a id="local-function-kind"></a>

```ts
function f@alice(...): T@alice {
    ...
}
```

or, with inferred return type:

```ts
function f@alice(...) {
    ...
}
```

- Runs on a single endpoint; the location must be an individual location.
- Is generated only for the corresponding endpoint.
- May call only local functions at the same endpoint (spec [§10.3](#calling-functions-from-a-local-context)).
- May contain transfers, but both sides are necessarily at the function's own
  location, so a transfer there is always a local copy (spec [§11.4](#local-copy)).
- Holds no `dyn` (spec [§8.4](#local-function-strict-location-rule)); a location it leaves out is its own
  (spec [§7.20.8](#local-function-location-inference)).
- Allows return type inference.
- Recursion is allowed only when the recursive function writes its return type;
  the type's location may be left out (spec [§7.20.9](#inference-and-recursion)).
- May use the top-level constants located at its own location, and no others
  (spec [§6.6](#top-level-let), [§8.4](#local-function-strict-location-rule)).
- May be imported from a BlueScript source file instead of declared: an
  imported function is a local function whose body is BlueScript
  (spec [§6.8](#imported-names)).

### 10.2 Calling Local Functions from a Choreography Context <a id="calling-local-from-choreography"></a>

A choreography context may call local functions. At endpoints where the function's location does not match, the callee is not generated and the call projects to `nothing(...)` over its arguments (spec [§12.12](#function-projection)). It is removed by cleanup when none of those arguments holds a computation this endpoint owes (spec [§13.15](#projected-ast-cleanup)).

```ts
function add@alice(a: integer@alice, b: integer@alice): integer@alice {
    return a + b;
}

let x: integer@alice = add(1@alice, 2@alice);
```

EPP at `alice`:

```ts
function add(a: integer, b: integer): integer {
    return a + b;
}

let x: integer = add(1, 2);
```

EPP at `bob` — `add` is not generated there, so there is no call for `bob` to
make and the binding has nowhere to go (spec [§12.4](#expression-projection)):

```ts
// removed
```

An argument must be consistent with the parameter's location (spec [§7.17](#function-call-typing)). A
value at `@every` — a mutable array or otherwise — must be localized with `<-`
first. A `dyn` argument is accepted and cast to the parameter's location; the
cast stays at every endpoint, including those that do not generate the callee
(spec [§12.4](#expression-projection)):

```ts
function useAlice@alice(a: integer@alice): void {}
let valDyn: integer@dyn = 5@dyn;
useAlice(valDyn);
```

EPP at `alice`:

```ts
useAlice(__cast(valDyn, __loc_alice));
```

EPP at `bob`, which does not generate `useAlice`:

```ts
__nothing1(__cast(valDyn, __loc_alice));
```

```ts
function average@alice(arr: float[]@alice): float@alice {
    return 0.0@alice;
}

let arr: float[]@every = [1.1, 2.2]@every;
let arrAlice: float[]@alice <- arr;
let avg: float@alice = average(arrAlice);
```

### 10.3 Calling Functions from a Local Context <a id="calling-functions-from-a-local-context"></a>

Inside `function@alice`, only `@alice` local functions may be called.

Allowed:

```ts
function f@alice(): integer@alice {
    return 1@alice;
}

function g@alice(): integer@alice {
    return f();
}
```

Disallowed:

```ts
function f@bob(): integer@bob {
    return 1@bob;
}

function g@alice(): integer@alice {
    return f();
}
```

Disallowed:

```ts
function h(): void {
    return;
}

function g@alice(): void {
    h();
}
```

### 10.4 Recursion <a id="recursion"></a>

* Local function recursion is allowed.
* choreography function recursion is not supported in v1, whether direct or mutual;
* ChoreoBS v1 does not guarantee termination of local recursion.
* An imported function calls no function of the program (spec [§6.8](#imported-names)), so it is
  never part of a cycle. What its BlueScript body calls is BlueScript's affair.

Allowed:

```ts
function fact@alice(n: integer@alice): integer@alice {
    if (n <= 1@alice) {
        return 1@alice;
    } else {
        return n * fact(n - 1@alice);
    }
}
```

Disallowed:

```ts
function fact@alice(n: integer@alice) {
    if (n <= 1@alice) {
        return 1@alice;
    } else {
        return n * fact(n - 1@alice);
    }
}
```

Disallowed:

```ts
function loop(n: integer@every): void {
    if (n > 0@every) {
        loop(n - 1@every);
    }
    return;
}
```

***

## 11. Transfer Semantics <a id="transfer-semantics"></a>

### 11.1 Transfer Operator <a id="transfer-operator"></a>

```ts
a <- b;
```

means:

> Copy the value of `b` to the location of `a`, then store it in `a`.

Depending on the source and destination locations, this is one of:

* direct communication between two different individual locations;
* broadcast from one individual location to `@every`;
* a local copy, when the destination already holds the source payload
  (spec [§11.4](#local-copy));
* a dynamic transfer, when either location is `dyn`: which of the above it
  amounts to is decided at run time (spec [§11.5](#dynamic-transfer)).

Example:

```ts
let x: integer@alice = 1@alice;
let y: integer@bob <- x;
```

Meaning:

```text
alice -> bob: x
```

### 11.2 Direct Communication <a id="direct-communication"></a>

If the source and destination are statically known to be different individual locations, direct communication is used.

```ts
let x: integer@alice = 10@alice;
let y: integer@bob <- x;
```

EPP at `alice`:

```ts
let x: integer = 10;
sendInteger("bob", "__top_0", x);
```

EPP at `bob`:

```ts
let y: integer = receiveInteger("alice", "__top_0");
```

### 11.3 Broadcast Communication <a id="broadcast-communication"></a>

If the destination is `@every` and the source is statically an individual location, the communication is treated as a broadcast.

```ts
let x: boolean@alice = true@alice;
let c: boolean@every <- x;
```

EPP at `alice`:

```ts
let x: boolean = true;
broadcastBoolean("__top_0", x);
let c: boolean = x;
```

EPP at `bob`:

```ts
let c: boolean = receiveBoolean("alice", "__top_0");
```

For scalar broadcast, the sender-side `@every` binding may be initialized from the source value.

For array broadcast, the sender-side `@every` binding must be a fresh mutable copy of the source array.

```ts
let xs: float[]@alice = [1.1, 2.2]@alice;
let ys: float[]@every <- xs;
```

EPP at `alice`:

```ts
let xs: any[] = new Array<any>([1.1, 2.2]);
broadcastArray("__top_0", xs);
let ys: any[] = __copyArray(xs);
```

### 11.4 Local Copy <a id="local-copy"></a>

When the destination already holds the source payload, `<-` performs no network
communication. It is a local copy instead. This covers three cases (spec [§7.11](#transfer-typing)):

* `every -> P` — the value already exists at every endpoint, so `P` has it;
* `P -> P` — source and destination are the same individual location;
* `every -> every` — a local copy at every endpoint.

`dyn -> dyn` is not among them, although both sides are written the same: it is
a dynamic transfer (spec [§11.5](#dynamic-transfer)), which may still communicate at run time.

A local copy always produces a **fresh** value at the destination.

For scalar values, a local copy is ordinary local initialization or assignment,
which already copies the value.

```ts
let x: integer@every = 1@every;
let y: integer@alice <- x;
```

EPP at `alice`:

```ts
let x: integer = 1;
let y: integer = x;
```

For mutable arrays, a local copy creates a fresh mutable array at the
destination, so the two do not share identity.

```ts
let xs: float[]@every = [1.1, 2.2]@every;
let ys: float[]@alice <- xs;
```

EPP at `alice`:

```ts
let xs: any[] = new Array<any>([1.1, 2.2]);
let ys: any[] = __copyArray(xs);
```

An `every -> every` local copy is emitted at every endpoint:

```ts
let a: integer@every = 1@every;
let b: integer@every <- a;
```

EPP at `alice` and at `bob`:

```ts
let a: integer = 1;
let b: integer = a;
```

No `send`, `receive`, `broadcast`, or communication tag is generated for a local
copy.

### 11.5 Dynamic Transfer <a id="dynamic-transfer"></a>

A **dynamic transfer** is a transfer with `dyn` as its source location, its
destination location, or both. Its base types follow the ordinary rule
(spec [§7.11](#transfer-typing)); there is no location rule. How it is carried out — a send, a
broadcast, a receive, a local copy, or nothing at all at a given endpoint — is
decided at run time, from where the source turns out to be.

A dynamic transfer becomes a `let` or an assignment of the runtime call
`__dynTransfer` (spec [§12.2](#dyn-lowering)):

```text
a : T@q    <- e : T@q'    static transfer (spec §transfer-projection)
a : T@dyn  <- e : T@L     a ← __dynTransfer(tag, __kind_k, __loc_dyn, coerce(e → T@dyn))
a : T@q    <- e : T@dyn   a ← __cast(__dynTransfer(tag, __kind_k, __loc_q, coerce(e → T@dyn)), __loc_q)
```

Here `q` and `q'` are concrete locations, and `a ← …` stands for the `let` of a
transfer declaration or the `=` of a transfer assignment.

* `tag` is the transfer's communication tag (spec [§11.6](#communication-tags)), a string literal.
* `k` is the payload kind of the destination base type, one of the six names of
  the communication API: `integer`, `float`, `boolean`, `string`, `null` and
  `array`, the last for every array type (spec [§13.14](#communication-api)). It is passed as the
  runtime's constant `__kind_integer` … `__kind_array`, and the destination as
  `__loc_dyn` or `__loc_q` (spec [§14.6](#location-and-kind-codes)). A receiver has no payload to look at,
  so the kind cannot be read off the value: the compiler passes it, just as it
  picks the API by the destination type for a static transfer. The source has
  the same base type (spec [§7.11](#transfer-typing)), so the sender and the receivers choose the
  same API.
* No change of representation is involved: at the source, the payload already
  holds the destination base type's representation (spec [§3.5](#dyn)). To transfer an
  `integer` as a `float`, convert the source:
  `let fb: float@bob <- valDyn1 as float;`.

At run time:

* with a `dyn` destination, the result is fresh and unbound. When the source is
  bound to an individual location, its owner broadcasts the payload, so that
  every endpoint holds it;
* with a concrete destination, the result is fresh and bound to that location;
* either way the source's location variable is left as it is, and exactly one
  fresh location variable is created.

The case analysis in full, and the runtime function, are given in
spec [§14.14](#dyn-transfer-runtime).

Every endpoint makes the same `__dynTransfer` call. The rules of spec [§12.10](#transfer-projection) —
the split between sender, receivers and third parties, and the discarding of the
source at every endpoint but the sender — therefore do not apply: every
endpoint evaluates the source as an ordinary argument.

```ts
let valDyn1: integer@dyn = 4@dyn;
let valAlice: integer@alice = 6@alice;
let valDyn3: integer@dyn <- valDyn1;     // dynamic
let valDyn4: integer@dyn <- valAlice;    // dynamic: the source is injected
let valBob1: integer@bob <- valDyn1;     // dynamic: the result is cast to bob
let valBob2: integer@bob <- valAlice;    // static
```

The projections of these are given in spec [§15.11](#example-dynamic-transfer).

### 11.6 Communication Tags <a id="communication-tags"></a>

Each transfer that performs communication — that is, each `direct` or `broadcast` transfer — is assigned a static tag, and so is each dynamic transfer (spec [§11.5](#dynamic-transfer)), whether or not it turns out to communicate at run time. A local copy performs no communication and is given no tag (spec [§11.4](#local-copy)).

Tags have the following properties:

* They are unique within a compilation unit. Uniqueness within a function is not enough: two communications in different functions could otherwise share a tag and be in flight at the same time. The recommended format below achieves this because function names are global (spec [§6.2](#function-names)), and because the top-level scope name carries the compiler-reserved `__` prefix, which no function name may take (spec [§4.3](#identifiers), [§6.2](#function-names)). A scope name is therefore either a function's name or `__top`, and the two can never be the same.
* They are stable within the same compilation unit.
* Implementations may choose any string format.

A tag identifies a *communication in the program*, not a single message. The
same tag is reused by every execution of that communication — on each iteration
of a loop, and on each call of the function containing it (spec [§15.5](#example-while-with-transfer)).

Reusing a static tag this way is only sound under the execution model v1
assumes, so that model is stated here rather than left implicit:

> ChoreoBS v1 execution is synchronous. A choreography has one thread of
> control per endpoint, and a choreography function is never invoked
> concurrently with itself. Communications between a given pair of endpoints are
> matched in the order they are performed, so the runtime must deliver messages
> between that pair in FIFO order.

Under that model, two messages carrying the same tag can never be in flight
between the same pair of endpoints at once, and the receiver's `n`-th receive
for a tag pairs with the sender's `n`-th send for it.

A runtime that matched messages by tag alone and allowed overlapping
invocations would need something stronger — a dynamic invocation identifier, or
a tag scheme that distinguishes activations.

A dynamic transfer has one tag. Each execution of it either sends or broadcasts,
never both, so one tag is enough. Static and dynamic transfers are numbered by the
same counter per scope, in the source order of the transfers: tags are assigned
before dynamic location lowering (spec [§12.2](#dyn-lowering)) turns a dynamic transfer into a
call. A program without dynamic transfers is numbered exactly as it would be
without gradual locating.

Every endpoint calls `__dynTransfer` with a given tag once per execution of the
transfer, on the same control path, and with the same kind and destination. A tag
is never shared between a dynamic transfer and a static send, receive or
broadcast.

Recommended format:

```text
<scopeName>_<serial>
```

Examples:

```text
__top_0
__top_1
foo_0
foo_1
```

***

## 12. Endpoint Projection <a id="endpoint-projection"></a>

### 12.1 Definition <a id="epp-definition"></a>

Endpoint Projection, EPP, transforms a ChoreoBS program into a BlueScript program for each endpoint.

```text
EPP(program, endpoint) -> BlueScript program
```

Before EPP, all inferred types must be elaborated into explicit located types in the internal AST, with every omitted location resolved to an inferred location or to `dyn` (spec [§8.2](#omitted-locations)). The typed program is then lowered by dynamic location lowering (spec [§12.2](#dyn-lowering)), and EPP is defined on the lowered program: wherever this chapter speaks of an expression's location, it is a location in the lowered program.

### 12.2 Dynamic Location Lowering <a id="dyn-lowering"></a>

Dynamic location lowering turns every dynamic operation (spec [§7.9](#dynamic-operations)) of a typed
program into a call of a **runtime function**, and inserts every coercion
(spec [§7.8](#coercion)). It runs after communication tags are assigned (spec [§11.6](#communication-tags)) and
before endpoint projection:

```text
Typed AST
  -> Communication tag assignment
  -> Dynamic location lowering
  -> Endpoint Projection
```

What it produces obeys the static location rules everywhere. Every place where
two different locations met through `~` now holds an inject or a cast, every
operation whose join was `dyn` is now a runtime call, and every pair of locations
that the type rules compare is equal (spec [§7.6](#location-matching-and-residency)). A compiler should check this
before projecting. A program without `dyn` is left exactly as it is, so its
projection is the same as it would be without gradual locating.

#### Runtime Functions <a id="runtime-functions"></a>

A call of a runtime function is projected like a call of a choreography function:
every endpoint generates the callee (spec [§12.4](#expression-projection)). Its signature, in the terms
of the type system:

| Runtime function | Arguments | Result | Stands for |
|---|---|---|---|
| `__dynUnbound(c)` | `c : T@every` | `T@dyn` | the `dyn` literal `c@dyn` |
| `__inject(e, __loc_q)` | `e : T@q` | `T@dyn` | `inj<q>(e)` |
| `__cast(v, __loc_q)` | `v : T@dyn` | `T@q` | `cast<q>(v)` |
| `__dynIntegerToFloat(v)` | `v : integer@dyn` | `float@dyn` | `v as float` |
| `__dynFloatToInteger(v)` | `v : float@dyn` | `integer@dyn` | `v as integer` |
| `__dynPlus(a, b)` and the other binary operators | `a : T@dyn`, `b : T@dyn` | the operator's result type, at `dyn` (spec [§7.14](#operators)) | `a op b` |
| `__dynNot(v)` / `__dynNeg(v)` | `v : T@dyn` | `T@dyn` | `!v` / `-v` |
| `__dynArrayGet(xs, i)` | `xs : T[]@dyn`, `i : integer@dyn` | `T@dyn` | `xs[i]` |
| `__dynArraySet(xs, i, v)` | `xs : T[]@dyn`, `i : integer@dyn`, `v : T@dyn` | `void` | `xs[i] = v` |
| `__dynArrayPush(xs, v)` | `xs : T[]@dyn`, `v : T@dyn` | `void` | `xs.push(v)` |
| `__dynArrayLength(xs)` | `xs : T[]@dyn` | `integer@dyn` | `xs.length` |
| `__dynArrayNew()` | | `T[]@dyn` | an array literal at `dyn` |
| `__dynArrayAppend(xs, v)` | `xs : T[]@dyn`, `v : T@dyn` | `T[]@dyn` | an element of one |
| `__dynTransfer(tag, __kind_k, __loc_D, v)` | `v : T@dyn` | `T@dyn` | a dynamic transfer to `D` |
| `__dynPrint(v)` | `v : T@dyn` | `void` | `print(v)` |

The binary operators are `+ - * / %` — `__dynPlus`, `__dynSub`, `__dynMul`,
`__dynDiv`, `__dynMod`, with `string + string` under `__dynPlus` — `&& ||` —
`__dynAnd`, `__dynOr` — and `< <= > >= === !==` — `__dynLt`, `__dynLe`,
`__dynGt`, `__dynGe`, `__dynEq`, `__dynNeq`.

A location or kind argument is one of the runtime's constants `__loc_…` and
`__kind_…`, an identifier of type `integer@every` (spec [§14.6](#location-and-kind-codes)); the `tag`
argument is a `string@every` literal, as the communication API takes a tag as a
string. Both are the same at every endpoint. `__dynArraySet`, `__dynArrayPush`
and `__dynPrint` are `void`, and stand as expression statements. What each
function does is given in spec [§14.5](#dyn-runtime)–[§14.16](#dyn-print).

#### Rewriting <a id="dyn-lowering-rules"></a>

Lowering rewrites the typed AST bottom up:

* a literal `c@dyn` becomes `__dynUnbound(c)` (spec [§8.6](#dyn-literals));
* an operator, index access, `.length` or push whose result or join is `dyn`
  becomes its runtime function, with its static operands injected first;
* a print of a `dyn` value becomes `__dynPrint(v)` (spec [§7.18](#print-typing));
* a conversion of a `dyn` operand becomes `__dynIntegerToFloat` or
  `__dynFloatToInteger`, or its operand itself when the type does not change
  (spec [§7.15](#numeric-conversion));
* an element assignment `xs[i] = v` whose join is `dyn` becomes the expression
  statement `__dynArraySet(xs, i, v)`, each operand coerced to `dyn`. In a `for`
  header it stands as a bare expression in its slot (spec [§12.15](#for-projection));
* a dynamic transfer becomes a `let` or an assignment of `__dynTransfer`, cast to
  the destination when that is concrete (spec [§11.5](#dynamic-transfer)); its `tag` argument is the
  tag the transfer was given;
* a coercion is inserted at each position where a value is placed at a location
  it is not at (spec [§7.8](#coercion)), including a `dyn` condition, which is cast to `every`;
* parentheses around what became a runtime call are dropped, since a call needs
  none.

An array literal at `dyn`, `[e1, …, en]@dyn`, is built up from an empty array,
whatever its elements are:

| Elements | Lowered to |
|---|---|
| none (`[]@dyn`) | `__dynArrayNew()` |
| one or more | `__dynArrayAppend(…__dynArrayAppend(__dynArrayNew(), e1')…, en')` |

* `ei'` is `coerce(ei → T@dyn)`. An unlocated literal element is `c@dyn` and
  becomes `__dynUnbound(c)`; a static element is injected.
* `__dynArrayNew()` takes no kind. Every array is a BlueScript `any[]` whatever
  its element type (spec [§13.3](#array-operation-code-generation)), so one empty array serves them all. An
  empty literal still takes its element type from the array type it is checked
  against (spec [§7.16](#array-typing)): that is its static type.
* The elements are evaluated from `e1` to `en`, since arguments are evaluated
  left to right (spec [§5.18](#evaluation-order)).
* Each element costs a `__DynVal`, a location variable and a push, even in an
  array of literals. Building an all-literal array in one step is a possible
  later optimization (spec [§17.6](#future-work)).

An array literal at a concrete location stays a literal, and a `dyn` element in it
is cast: `[d]@alice` becomes `[__cast(d, __loc_alice)]`, which code generation writes
as `new Array<any>([__cast(d, __loc_alice)])` (spec [§13.3](#array-operation-code-generation)).

### 12.3 Type Projection <a id="type-projection"></a>

Projection of a located type `T@L` to endpoint `P` is:

```text
if residesAt(L, P):
    T
else:
    absent
```

`void` has no location (spec [§7.3](#void)) and is never absent: it projects to `void` at
every endpoint. A `void` return type therefore keeps its signature everywhere,
which is what makes the projected `return;` well formed.

```text
void projected to any endpoint -> void
```

A type at `dyn` resides at every endpoint (spec [§7.6](#location-matching-and-residency)), and projects to the runtime's
`__DynVal` there, array or not:

```text
T@dyn   projected to any endpoint -> __DynVal
T[]@dyn projected to any endpoint -> __DynVal
```

Examples:

```text
integer@alice projected to alice -> integer
integer@alice projected to bob   -> absent
integer@every projected to bob   -> integer
integer[]@alice projected to alice -> integer[]
void projected to bob            -> void
integer@dyn projected to bob     -> __DynVal
```

### 12.4 Expression Projection <a id="expression-projection"></a>

Two questions have to be kept apart, and conflating them is the single easiest
way to get EPP wrong:

* **where a value resides** — which endpoints hold a copy of the result; and
* **where a computation must execute** — which endpoints have to run it.

For most expression forms the two coincide. They come apart at a call: a
choreography function runs at every endpoint (spec [§12.12](#function-projection)), so `P` must execute
the call even when the result lives somewhere else entirely.

#### The Rule <a id="expression-projection-rule"></a>

Projection is a structural recursion over the expression, and it has two modes.
Which one applies is decided by whoever asks for the projection, not by the
expression:

```text
project_P(e)    the value projection: what P computes when it needs e's value
discard_P(e)    the evaluation-only projection: what P still runs when it does not
```

`project_P` is the one the source's own value positions use. For an expression
`e : T@L` at endpoint `P`:

```text
project_P(e : T@L) =
    if residesAt(L, P):  keep the form, projecting each subexpression with project_P
    else:                discard_P(e)
```

`discard_P` is the whole of the difference. `P` has no value to apply the
operator or the callee to, so neither is reproduced. What *is* reproduced is
the evaluation of the operands, structurally and in source order, collected in
a compiler-generated `nothing(...)` that evaluates each one exactly once,
discards their values and yields `null` (spec [§14.1](#nothing)).

**`discard_P` is defined on the form of `e` alone, and never consults
`residesAt`.** Once a result is being discarded, a subexpression whose value
happens to reside at `P` is still only evaluated, never handed back as a value.
A call's arguments are the one exception, since the call does want those
values: they are projected with `project_P`, and each then decides for itself.

```text
binary:               e1 op e2    =>  nothing(discard(e1), discard(e2))
unary:                op e        =>  nothing(discard(e))
conversion:           e as T      =>  discard(e)
parenthesized:        ( e )       =>  discard(e)
index:                xs[i]       =>  nothing(discard(xs), discard(i))
length:               xs.length   =>  nothing()
push:                 xs.push(v)  =>  nothing(discard(v))
print:                print(e)    =>  nothing(discard(e))
array literal:        [e1, ...]   =>  nothing(discard(e1), ...)
call, callee here:    f(e1, ...)  =>  f(project(e1), ...)
call, callee absent:  f(e1, ...)  =>  nothing(project(e1), ...)
runtime call:         f(e1, ...)  =>  f(project(e1), ...)
literal, identifier:                  absent
```

The statement forms that discard a result name `discard_P` directly: a `let`
whose binding is absent here ([§12.9](#let-projection)), an assignment whose
target is ([§12.11](#assignment-projection)), a `for` header slot
([§12.15](#for-projection)), and — the one case where the expression's own
residency is beside the point — the source of a transfer at every endpoint
that is not its sender ([§12.10](#transfer-projection)).

A statement that discards a single expression keeps that expression's
projection as it stands, which may itself be one of the `nothing(...)` forms
above. A statement adds a `nothing(...)` of its own only where two or more
expressions have to be held in one slot (spec [§12.11](#assignment-projection)). A form with no
operands left to hold — `xs.length`, `[]`, and a call to an absent function with
no arguments — leaves `nothing()`.

A call whose callee `P` does generate is kept as a call, not wrapped: the
projected callee returns `null` at `P` (spec [§12.3](#type-projection), [§13.13](#absent-finalization)), so the call already stands
in for the absent value wherever one is needed. A call of a runtime function
(spec [§12.2](#dyn-lowering)) is always of this kind, since every endpoint generates the callee.
Where its result is at an individual location that `P` is not — `__cast(v, __loc_alice)`
at `bob` — the runtime itself returns `null` (spec [§14.11](#inject-and-cast)). A call whose callee `P` does
not generate — a local function at another endpoint — disappears, but its
arguments do not: they are ordinary expressions that may contain choreography
calls of their own. With no arguments that leaves `nothing()`, which cleanup
removes (spec [§13.15](#projected-ast-cleanup)).

The binary row covers `&&` and `||` as well. They do not short-circuit
(spec [§5.18](#evaluation-order)), so hoisting both operands into one `nothing(...)` runs
exactly what the original runs.

`.length` drops its receiver where `xs[i]` keeps its own, because the two are
not the same kind of operand. The receiver of `.length` must be a variable
(spec [§5.15](#expressions)), so reading it cannot call anything and there is nothing to
preserve; that leaves `nothing()`, which cleanup removes (spec [§13.15](#projected-ast-cleanup)). The
receiver of `[]` is an arbitrary expression — `f()[i]` is well-formed — and may
hold a choreography call, so it is reproduced like any other operand.

`xs.push(v)` is `void`, so it never stands in a value position (spec
[§7.2](#located-types), [§16.43](#invalid-use-of-void)); the only place it occurs
is as an expression statement. Its result still travels with the array's
location (spec [§7.16](#array-typing)), so at an endpoint that does not hold the
array `project_P` falls through to the `push` row above — which is exactly the
statement rule [§12.11](#assignment-projection) states. It drops its receiver for
the same reason `.length` does.

`print(e)` is `void` too, and its result travels with the location of `e`
(spec [§7.18](#print-typing)). At an endpoint that does not hold `e`, `project_P` falls through to
the `print` row: the print is not performed, and only the evaluation of `e` is
left behind (spec [§12.17](#print-projection)).

Nested `nothing(...)` artifacts are left nested. Flattening them is not part of
v1 (spec [§13.15](#projected-ast-cleanup), [§17.7](#future-cleanup-optimizations)).

#### Why the Operands Are Enough <a id="why-the-operands-are-enough"></a>

Whenever a composite expression's result is absent at `P`, the subexpressions
that carry its value are absent at `P` too — the type rules leave no room for
anything else. This is a property of the **lowered** program (spec [§12.2](#dyn-lowering)). Before
lowering, `~` lets a `dyn` operand meet a static one; after it, every such meeting
is an inject or a cast, and every operation with a `dyn` result is a runtime call,
so the rules below hold throughout:

* both operands of a binary operator are at one location, and so is the result
  (spec [§7.14](#operators));
* the operand of a unary operator or of a numeric conversion is where the result
  is (spec [§7.14](#operators), [§7.15](#numeric-conversion));
* an index expression is at its array's location (spec [§16.38](#invalid-array-index-location));
* a local function's parameters are at its own endpoint (spec [§16.25](#invalid-local-function-parameter-location)), and
  arguments must match (spec [§16.28](#invalid-function-argument-location));
* a `let` and a simple assignment have one location on both sides (spec [§7.10](#assignment-typing)).

So a `nothing(...)` built this way holds only `absent` leaves and calls `P`
must make. Nothing resident is discarded, and cleanup's deliberately blunt rule
— fold only when every argument is syntactically `null` — loses nothing
(spec [§13.15](#projected-ast-cleanup)).

A transfer is the one place a location boundary is crossed on purpose, so its
source needs the rule stated separately; see [§12.10](#transfer-projection).

#### Calls Survive an Absent Result <a id="calls-survive-an-absent-result"></a>

An absent *value* does not mean absent *work*. A choreography function is
projected to every endpoint and its body may communicate, so `P` must still
call it even when the call's result is located elsewhere.

A runtime call must survive for a second reason: it creates, unifies or binds
location variables, and every endpoint has to add the same constraints in the same
order (spec [§3.5](#dyn)). Were `bob` to drop `__cast(valDyn, __loc_alice)` because its result
is at `alice`, `bob` would not bind `valDyn`'s class to `alice`, and the endpoints'
location dispatch would diverge from there on. So `nothing(__cast(valDyn, __loc_alice))`
and even a bare `__dynUnbound(3);` stay (spec [§13.15.6](#what-this-cleanup-pass-must-not-remove)).

```ts
function relay(a: integer@alice): integer@alice {
    let b: integer@bob <- a;
    let c: integer@alice <- b;
    return c;
}

let x: integer@alice = 1@alice;
let y: integer@alice = -relay(x);
```

EPP at `bob`:

```ts
function relay(a: null): null {
    let b: integer = receiveInteger("alice", "relay_0");
    sendInteger("alice", "relay_1", b);
    return null;
}

__nothing1(relay(null));
```

Erasing that statement at `bob` would leave `alice` blocked forever on the
matching receive.

Order is preserved along with the calls, because the `nothing(...)` tree mirrors
the source tree and both evaluate left to right. The helper calls code generation
turns it into keep its arguments in that order, even where more than five of them
are split up (spec [§13.7](#nothing-code-generation)):

```ts
get3() + get3() * get4();
```

at an endpoint where the result is absent:

```ts
__nothing2(get3(), __nothing2(get3(), get4()));
```

`get3`, `get3`, `get4` — the same order as the source, and each called once.

#### A Discarded Result Is Not a Discarded Call <a id="a-discarded-result-is-not-a-discarded-call"></a>

Where the projected expression sits in a statement whose value has nowhere to go
at `P`, the statement becomes an evaluation-only expression statement ([§12.9](#let-projection),
[§12.10](#transfer-projection), [§12.11](#assignment-projection)). No wrapper is added on top of what projection already produced:

```ts
function choose(c: boolean@every): integer@alice {
    if (c) {
        return 1@alice;
    } else {
        return 0@alice;
    }
}

let c: boolean@every = true@every;
let x: integer@alice = choose(c);
```

EPP at `bob`:

```ts
function choose(c: boolean): null {
    if (c) {
        return null;
    } else {
        return null;
    }
}

let c: boolean = true;
choose(c);
```

When such a statement holds nothing `P` must run, it simplifies to `null` and
disappears entirely (spec [§13.15](#projected-ast-cleanup)).

#### Positions With No Room for a Statement <a id="positions-with-no-room-for-a-statement"></a>

A call argument, a `return` value and a `for` header slot are expressions, not
statements. Nothing special is needed there: the projection of [§12.4](#expression-projection) is already
an expression that yields `null`, so it goes straight into the slot.

```ts
function get3(): integer@mcu {
    let a: integer@server <- 3@mcu;
    return 3@mcu;
}

function add(a: integer@mcu, b: integer@mcu): integer@mcu {
    let c: integer@server <- 3@mcu;
    return a + b;
}

add(3@mcu, get3());
```

EPP at `server`:

```ts
function get3(): null {
    let a: integer = receiveInteger("mcu", "get3_0");
    return null;
}

function add(a: null, b: null): null {
    let c: integer = receiveInteger("mcu", "add_0");
    return null;
}

add(null, get3());
```

`server` calls `get3` and `add` in the same order `mcu` does, so each receive
runs against the matching send. Projecting the argument `get3()` to a bare
`null` would drop that call, and `mcu` would block on the receive inside
`get3` forever.

### 12.5 Absent <a id="absent"></a>

`absent` is an internal intermediate representation used only during EPP.

* It does not exist in the source language.
* It is distinct from source-level `null`.
* It is never emitted to final BlueScript output.
* It is turned into `null` by absent finalization, a stage of its own that runs
  after EPP and before cleanup (spec [§13.13](#absent-finalization)).

`absent` and the compiler-generated `nothing(...)` (spec [§14.1](#nothing)) are different
artifacts and are kept apart. `absent` marks a value that does not exist here;
`nothing(...)` preserves computations whose result is discarded. EPP produces
both, finalization rewrites the first, and cleanup folds the second
(spec [§13.15](#projected-ast-cleanup)).

### 12.6 Literal Projection <a id="literal-projection"></a>

For a literal `c@L`, projection to endpoint `P` is:

```text
if residesAt(L, P):
    c
else:
    absent
```

A literal has no effect of its own, so an absent one leaves nothing to evaluate.
A literal statement where the literal is absent becomes `null;` in absent
finalization (spec [§13.13](#absent-finalization)), and cleanup removes it (spec [§13.15](#projected-ast-cleanup)):

```ts
14@alice;
"Hello"@alice;
true@every;
```

EPP at `alice`:

```ts
14;
"Hello";
true;
```

EPP at `bob`:

```ts
true;
```

A literal at `dyn` does not reach EPP as a literal: lowering has made it
`__dynUnbound(c)` (spec [§12.2](#dyn-lowering)), a runtime call projected alike at every endpoint.

```ts
3@dyn;
4.5@dyn;
true@dyn;
"Hello"@dyn;
null@dyn;
```

EPP at `alice` and at `bob`:

```ts
__dynUnbound(3);
__dynUnbound(4.5);
__dynUnbound(true);
__dynUnbound("Hello");
__dynUnbound(null);
```

### 12.7 Identifier Projection <a id="identifier-projection"></a>

For variable `x : T@L`, projection to endpoint `P` is:

```text
if residesAt(L, P):
    x
else:
    absent
```

### 12.8 Operator and Conversion Projection <a id="binary-and-unary-operation-projection"></a>

Every binary operator — `+ - * / %`, `< <= > >=`, `=== !==` and `&& ||` —
always evaluates both operands (spec [§5.18](#evaluation-order)). Where the result resides at
`P`, the operator is preserved:

```ts
let a: integer@alice = 1@alice;
let b: integer@alice = 2@alice;
let c: integer@alice = a + b;
```

EPP at `alice`:

```ts
let a: integer = 1;
let b: integer = 2;
let c: integer = a + b;
```

Where it does not, the operator is not applied at all; the operands are still
evaluated, in order (spec [§12.4](#expression-projection)):

```text
discard_P(e1 op e2) = nothing(discard_P(e1), discard_P(e2))
discard_P(op e)     = nothing(discard_P(e))
```

EPP at `bob` — both operands are variables absent there, so the statement simplifies to
`null` and disappears (spec [§13.15](#projected-ast-cleanup)):

```ts
// removed
```

With a call in one of them, it does not:

```ts
let y: integer@alice = -relay(x);
```

EPP at `bob`:

```ts
__nothing1(relay(null));
```

An operator whose result is at `dyn` is a runtime call by the time EPP sees it
(spec [§12.2](#dyn-lowering)), and is projected alike at every endpoint. Its static operand is
injected, and is `null` where it does not reside:

```ts
let valDyn: integer@dyn = 3@dyn;
let valAlice: integer@alice = 5@alice;
let valEvery: integer@every = 6@every;
valDyn + valDyn;
valDyn + valAlice;
valAlice + valAlice;
valDyn + valEvery;
```

EPP at `alice`:

```ts
let valDyn: __DynVal = __dynUnbound(3);
let valAlice: integer = 5;
let valEvery: integer = 6;
__dynPlus(valDyn, valDyn);
__dynPlus(valDyn, __inject(valAlice, __loc_alice));
valAlice + valAlice;
__dynPlus(valDyn, __inject(valEvery, __loc_every));
```

EPP at `bob` — the static `valAlice + valAlice` leaves `nothing(null, null)`,
which cleanup removes:

```ts
let valDyn: __DynVal = __dynUnbound(3);
let valEvery: integer = 6;
__dynPlus(valDyn, valDyn);
__dynPlus(valDyn, __inject(null, __loc_alice));
__dynPlus(valDyn, __inject(valEvery, __loc_every));
```

The unary operators are alike:

```ts
let a: boolean@dyn = false@dyn;
let n: integer@dyn = 1@dyn;
a = !a;
n = -n;
```

EPP at `alice` and at `bob`:

```ts
let a: __DynVal = __dynUnbound(false);
let n: __DynVal = __dynUnbound(1);
a = __dynNot(a);
n = __dynNeg(n);
```

#### Logical Operators <a id="logical-operator-projection"></a>

`&&` and `||` follow the rule above with no exception. Since they do not
short-circuit, hoisting both operands into `nothing(...)` where the result is
absent runs exactly what the original runs. Written out:

```text
project_P(e1 && e2 : boolean@L) =
    if residesAt(L, P):  project_P(e1) && project_P(e2)
    else:                nothing(discard_P(e1), discard_P(e2))

project_P(e1 || e2 : boolean@L) =
    if residesAt(L, P):  project_P(e1) || project_P(e2)
    else:                nothing(discard_P(e1), discard_P(e2))
```

The projected IR keeps the operator; code generation spells it `__and` or `__or`
(spec [§13.4](#logical-operator-code-generation)), as the examples below show.

There is one rule for every context. In a local function body every value
resides at the function's own endpoint (spec [§8.4](#local-function-strict-location-rule)), so the first
branch is the only one taken there.

An operand may call a choreography function (spec [§7.14](#operators)):

```cbs
function ping(): boolean@alice {
    let b: integer@bob = 1@bob;
    let c: integer@alice <- b;
    return true@alice;
}

let c: boolean@alice = false@alice;
let d: boolean@alice = c && ping();
```

EPP at `alice`:

```ts
let c: boolean = false;
let d: boolean = __and(c, ping());
```

EPP at `bob` — the binding is absent, but `ping()` still runs, so `bob` takes
part in the communication inside it:

```ts
__nothing2(null, ping());
```

With a `dyn` operand, `&&` and `||` are the runtime calls `__dynAnd` and `__dynOr`
(spec [§12.2](#dyn-lowering)) rather than `__and` and `__or`. They take both operands' values as
arguments, so they do not short-circuit either.

#### Numeric Conversion Projection <a id="numeric-conversion-projection"></a>

A static conversion is kept, as BlueScript's `as`, where its result resides.
Where it does not, nothing of the conversion is emitted — not even the
`nothing(...)` a unary operator leaves. Like parentheses, a conversion
contributes nothing of its own, so only the operand's evaluation remains
(spec [§12.4](#expression-projection)). A conversion of a `dyn` operand to the other numeric type
is a runtime call instead, projected alike at every endpoint, and one to its own
type is dropped (spec [§7.15](#numeric-conversion)).

```text
project_P(e as T : T@L) =
    if residesAt(L, P):  project_P(e) as T
    else:                discard_P(e)
```

The result is located where the operand is (spec [§7.15](#numeric-conversion)), so wherever the
result resides the operand does too, and a conversion is never applied to the
`null` that stands in for an absent value.

```cbs
function relay(v: integer@alice): integer@alice {
    let w: integer@bob <- v;
    let back: integer@alice <- w;
    return back;
}

let n: integer@alice = 3@alice;
let x: float@alice = n as float;
let y: float@alice = relay(n) as float;
```

EPP at `alice`:

```ts
let n: integer = 3;
let x: float = ((n as integer) as float);
let y: float = ((relay(n) as integer) as float);
```

EPP at `bob` — `x` disappears altogether, and of `y` only the call remains,
bare, where the unary `-relay(x)` above leaves `nothing(relay(null))`:

```ts
relay(null);
```

Static and dynamic conversions, with the coercions between them
(spec [§7.8](#coercion)):

```ts
let valAlice: integer@alice = 1@alice;
let iDyn: integer@dyn = 2@dyn;
let f1: float@dyn = valAlice as float;
let f2: float@alice = iDyn as float;
let f3: float@dyn = iDyn as float;
let f4: float@dyn = 3 as float;
let i1: integer@dyn = iDyn as integer;
```

EPP at `alice`:

```ts
let valAlice: integer = 1;
let iDyn: __DynVal = __dynUnbound(2);
let f1: __DynVal = __inject(((valAlice as integer) as float), __loc_alice);
let f2: float = __cast(__dynIntegerToFloat(iDyn), __loc_alice);
let f3: __DynVal = __dynIntegerToFloat(iDyn);
let f4: __DynVal = __dynIntegerToFloat(__dynUnbound(3));
let i1: __DynVal = iDyn;
```

EPP at `bob` — the static `valAlice as float` is absent, so `bob` injects `null`
and never evaluates `null as float`:

```ts
let iDyn: __DynVal = __dynUnbound(2);
let f1: __DynVal = __inject(null, __loc_alice);
__cast(__dynIntegerToFloat(iDyn), __loc_alice);
let f3: __DynVal = __dynIntegerToFloat(iDyn);
let f4: __DynVal = __dynIntegerToFloat(__dynUnbound(3));
let i1: __DynVal = iDyn;
```

And conversions of `dyn` operands alone:

```ts
let n: integer@dyn = 3@dyn;
let x: float@dyn = 1.5@dyn;
let a: float@dyn = n as float;
let b: integer@dyn = x as integer;
let c: integer@dyn = n as integer;
```

EPP at `alice` and at `bob`:

```ts
let n: __DynVal = __dynUnbound(3);
let x: __DynVal = __dynUnbound(1.5);
let a: __DynVal = __dynIntegerToFloat(n);
let b: __DynVal = __dynFloatToInteger(x);
let c: __DynVal = n;
```

### 12.9 Let Projection <a id="let-projection"></a>

```ts
let x = 1@alice;
```

After type inference, this is treated internally as:

```ts
let x: integer@alice = 1@alice;
```

EPP at `alice`:

```ts
let x: integer = 1;
```

Where the binding is absent at `P`, no binding is generated, but the
initializer is still evaluated — the store goes, the evaluation stays:

```text
project_P(let x = e;) = discard_P(e);
```

A `let` in a `for` header is the exception: it keeps its binding at every
endpoint, because the name has to stay declared for the rest of the header
(spec [§12.15](#for-projection)).

EPP at `bob` — the initializer is a literal, so the statement simplifies to
`null` and disappears (spec [§13.15](#projected-ast-cleanup)):

```ts
// removed
```

With a call in the initializer it survives as an evaluation-only statement:

```ts
let x: integer@alice = choreographyCall();
```

EPP at `bob`:

```ts
choreographyCall();
```

A `let` at `dyn` is present at every endpoint (spec [§12.3](#type-projection)). A `let` at a concrete
location initialized from a `dyn` value keeps its cast wherever the binding is
absent — the cast is a runtime call:

```ts
let valDyn1: integer@dyn = 3@dyn;
let valDyn2: integer@dyn = 3@alice;
let valAlice1: integer@alice = 3@dyn;
let valAlice2: integer@alice = 3@alice;
```

EPP at `alice`:

```ts
let valDyn1: __DynVal = __dynUnbound(3);
let valDyn2: __DynVal = __inject(3, __loc_alice);
let valAlice1: integer = __cast(__dynUnbound(3), __loc_alice);
let valAlice2: integer = 3;
```

EPP at `bob`:

```ts
let valDyn1: __DynVal = __dynUnbound(3);
let valDyn2: __DynVal = __inject(null, __loc_alice);
__cast(__dynUnbound(3), __loc_alice);
```

A `const` declaration projects exactly as a `let` does, here and in a transfer
(spec [§12.10](#transfer-projection)), and the binding it leaves keeps its keyword:

```ts
const x = 1@alice;
const y: integer@bob <- x;
```

EPP at `alice`:

```ts
const x: integer = 1;
sendInteger("bob", "__top_0", x);
```

EPP at `bob`:

```ts
const y: integer = receiveInteger("alice", "__top_0");
```

The output never stores into it again, since the source does not (spec [§5.7](#const-statement)). The
bindings EPP introduces itself, such as the `__transfer_N` temporaries
(spec [§12.10](#transfer-projection)), and the binding of a `for` header are always `let`.

### 12.10 Transfer Projection <a id="transfer-projection"></a>

This section is about static transfers. A dynamic transfer is a `let` or an
assignment of `__dynTransfer` by the time EPP sees it (spec [§11.5](#dynamic-transfer)), and is
projected by [§12.9](#let-projection) and [§12.11](#assignment-projection): every endpoint evaluates its source
with `project_P`, as an argument, and no temporary is needed.

#### The Source Is Evaluated at Every Endpoint <a id="the-source-is-evaluated-at-every-endpoint"></a>

A transfer crosses a location boundary on purpose, so [§12.4](#expression-projection)'s reasoning about
subexpressions does not carry over to it: the source expression belongs to the
sender's location, but the computations inside it may not.

> A transfer's source expression is evaluated exactly once at **every** endpoint
> that evaluates the statement, and before that endpoint's own send, receive or
> copy.

The sender evaluates it as the payload, with `project_P`. Every other endpoint
evaluates it for its computations alone, as `discard_P(source)` standing as an
expression statement placed *before* the receive, so that the calls inside it
meet the sender's in the same order.

`discard_P` is what makes this work in both directions. The source belongs to
the sender's location, but a source at `@every` resides at every endpoint, and
a receiver has no use for its value either way — it is about to receive one.
Because `discard_P` never consults `residesAt`
(spec [§12.4](#expression-projection)), the source is reduced to its
computations at every non-sender alike, whatever its location.

```ts
function g(): integer@alice {
    let b: integer@bob = 7@bob;
    let c: integer@alice <- b;
    return c;
}

let y: integer@bob <- g();
```

EPP at `alice`:

```ts
sendInteger("bob", "__top_0", g());
```

EPP at `bob`:

```ts
g();
let y: integer = receiveInteger("alice", "__top_0");
```

Omitting `g()` at `bob` would leave `alice` blocked inside `g` forever. The same
holds at every receiver of a broadcast, and at endpoints the transfer skips
altogether.

Where `discard_P` of the source yields `null` — that is, where the source holds
no call this endpoint has to make — the statement disappears in cleanup
(spec [§13.15](#projected-ast-cleanup)), which is why the ordinary cases below
show no extra statement. A bare identifier or literal source is the common
case: it discards to `absent`, and so to `null`.

Where the source value has to be used more than once at the sender — a
broadcast, which both sends and keeps its own copy — a compiler-generated
temporary holds it so that it is still evaluated exactly once (spec [§7.11](#transfer-typing)).

#### Direct Communication <a id="epp-direct-communication"></a>

```ts
let y: integer@bob <- x;
```

where `x : integer@alice`.

EPP at `alice`:

```ts
sendInteger("bob", "__top_0", x);
```

EPP at `bob`:

```ts
let y: integer = receiveInteger("alice", "__top_0");
```

#### Broadcast <a id="epp-broadcast"></a>

For individual-to-`@every` communication, EPP generates a broadcast at the sender and a receive at all other endpoints.

For array broadcast, the sender-side `@every` binding is a fresh mutable copy.

```ts
let xs: integer[]@alice = [1, 2]@alice;
let ys: integer[]@every <- xs;
```

EPP at `alice`:

```ts
let xs: any[] = new Array<any>([1, 2]);
broadcastArray("__top_0", xs);
let ys: any[] = __copyArray(xs);
```

EPP at `bob`:

```ts
let ys: any[] = receiveArray("alice", "__top_0");
```

#### Local Copy <a id="epp-local-copy"></a>

When the destination already holds the source payload (spec [§11.4](#local-copy)), the transfer is projected as a local copy at each endpoint the destination resides at. No `send`, `receive`, `broadcast`, or communication tag is generated.

For scalar values, a local copy generates local initialization or assignment.

```ts
let x: integer@every = 1@every;
let y: integer@alice <- x;
```

EPP at `alice`:

```ts
let x: integer = 1;
let y: integer = x;
```

For array values, a local copy generates a fresh mutable array.

```ts
let xs: float[]@every = [1.1, 2.2]@every;
let ys: float[]@alice <- xs;
```

EPP at `alice`:

```ts
let xs: any[] = new Array<any>([1.1, 2.2]);
let ys: any[] = __copyArray(xs);
```

#### Transfer Declaration Versus Transfer Assignment <a id="transfer-decl-vs-assignment"></a>

The rules above are those of a transfer **declaration**, `let y: T@L <- e;` or
`const y: T@L <- e;`, which introduces `y`. A transfer **assignment**, `y <- e;`,
stores into a variable that already exists and is not a `const` (spec [§5.7](#const-statement)), so
every rule above holds except that the destination side emits an assignment
rather than a declaration. Nothing else differs:
the same tag is allocated, the same send, broadcast, receive and copy are
chosen, and the sender still binds its own copy after a broadcast.

```ts
let src: integer@alice = 1@alice;
let d: integer@bob = 0@bob;
d <- src;                      // direct
let e: integer@every = 0@every;
e <- src;                      // broadcast
let s: integer@alice = 0@alice;
s <- src;                      // local copy, alice to alice
let arr: float[]@alice = [1.1]@alice;
let a2: float[]@alice = [0.0]@alice;
a2 <- arr;                     // local copy, fresh array
```

EPP at `alice`:

```ts
let src: integer = 1;
sendInteger("bob", "__top_0", src);
let e: integer = 0;
broadcastInteger("__top_1", src);
e = src;
let s: integer = 0;
s = src;
let arr: any[] = new Array<any>([1.1]);
let a2: any[] = new Array<any>([0.0]);
a2 = __copyArray(arr);
```

EPP at `bob`:

```ts
let d: integer = 0;
d = receiveInteger("alice", "__top_0");
let e: integer = 0;
e = receiveInteger("alice", "__top_1");
```

A receiver must not re-declare the destination — `let d: integer = receive...`
would shadow the variable the program meant to update. For an array, the
assignment replaces the destination's reference with the fresh copy, which is
what makes `<-` differ from `=` at one location (spec [§7.11](#transfer-typing)).

#### Single Evaluation at the Sender <a id="single-evaluation-at-the-sender"></a>

A broadcast uses the source value twice at the sender, so when the source is not
already a simple reference EPP binds it to a temporary and uses that in both
places (spec [§7.11](#transfer-typing)). Temporaries are named with the reserved `__` prefix
(spec [§6.2](#function-names)), so they cannot capture a program name.

```ts
function nextValue(): integer@alice {
    return 1@alice;
}

let n: integer@every <- nextValue();
```

EPP at `alice`:

```ts
let __transfer_0: integer = nextValue();
broadcastInteger("__top_0", __transfer_0);
let n: integer = __transfer_0;
```

Without the temporary the sender would call `nextValue()` twice and could
broadcast one value while keeping another. A source that is already an
identifier or a literal is used directly, since re-reading it cannot call
anything.

### 12.11 Assignment Projection <a id="assignment-projection"></a>

```ts
x = y;
```

EPP to endpoint `P`:

* If `x` resides at `P`, generate the assignment.
* Otherwise, drop the store but keep the right-hand side's evaluation:

```text
project_P(x = e;) = discard_P(e);
```

For an array element assignment `xs[i] = v;`, the assignment is generated only
where `xs` resides. Where it does not, the store goes and both remaining
expressions are kept, in the order [§5.18](#evaluation-order) evaluates them — index first, then
value:

```text
project_P(xs[i] = v;) = nothing(discard_P(i), discard_P(v));
```

Dropping the index would be a communication bug, not just dead code: the index
is an ordinary expression and may hold a choreography call.

```ts
let xs: integer[]@alice = [0, 0]@alice;
xs[indexCall()] = valueCall();
```

EPP at `bob`, where both calls are choreography functions:

```ts
__nothing2(indexCall(), valueCall());
```

The compiler must not generate invalid code such as `null[null] = null`.

`xs.push(v)` follows the same shape: the append is performed where `xs` resides,
and elsewhere only the argument's evaluation is left behind (spec [§12.16](#array-projection)):

```text
project_P(xs.push(v);) = nothing(discard_P(v));
```

The receiver is dropped in both rules for the same reason, and in `xs.length`
for that reason too (spec [§12.4](#expression-projection)). `xs` is a variable — the grammar admits
nothing else as an assignment target or as the receiver of `.length` and
`.push` (spec [§5.15](#expressions)) — so reading it cannot call anything, and there is no
evaluation to preserve. Reproducing it would leave a `null` argument that
carries no computation and that cleanup cannot fold away once a sibling
argument holds one (spec [§13.15.2](#expression-simplification)).

An element assignment or a push whose join is `dyn` is not an assignment at all by
the time EPP sees it, but the `void` runtime call `__dynArraySet(xs, i, v)` or
`__dynArrayPush(xs, v)` (spec [§12.2](#dyn-lowering)), which every endpoint makes
(spec [§12.16](#array-projection)).

Assignment to a `dyn` variable is present at every endpoint, and an assignment to
a static variable from a `dyn` value keeps its cast where the variable is absent:

```ts
let valDyn: integer@dyn = 3@dyn;
let valAlice: integer@alice = 3@alice;
valDyn = 4@dyn;
valDyn = 4@alice;
valAlice = 5@dyn;
valAlice = 5@alice;
```

EPP at `alice`:

```ts
let valDyn: __DynVal = __dynUnbound(3);
let valAlice: integer = 3;
valDyn = __dynUnbound(4);
valDyn = __inject(4, __loc_alice);
valAlice = __cast(__dynUnbound(5), __loc_alice);
valAlice = 5;
```

EPP at `bob`:

```ts
let valDyn: __DynVal = __dynUnbound(3);
valDyn = __dynUnbound(4);
valDyn = __inject(null, __loc_alice);
__cast(__dynUnbound(5), __loc_alice);
```

### 12.12 Function Projection <a id="function-projection"></a>

#### Local Function <a id="epp-local-function"></a>

```ts
function add@alice(a: integer@alice, b: integer@alice) {
    return a + b;
}
```

After type inference, this is treated internally as:

```ts
function add@alice(a: integer@alice, b: integer@alice): integer@alice {
    return a + b;
}
```

EPP at `alice`:

```ts
function add(a: integer, b: integer): integer {
    return a + b;
}
```

EPP at `bob`:

```ts
// not generated
```

A *call* to it at `bob` is not generated either, but its arguments still are:
they are ordinary expressions and may hold choreography calls (spec [§12.4](#expression-projection)).

```text
project_P(f(e1, ..., en)) = nothing(project_P(e1), ..., project_P(en))
    where f is local at Q and P != Q
```

```ts
function add@mcu(a: integer@mcu, b: integer@mcu): integer@mcu {
    return a + b;
}

add(get3Mcu(), get4Mcu());
```

EPP at `server`, where `get3Mcu` and `get4Mcu` are choreography functions:

```ts
__nothing2(get3Mcu(), get4Mcu());
```

With no arguments there is nothing left to evaluate, and `nothing()` is removed
by cleanup (spec [§13.15](#projected-ast-cleanup)). A call names no location
(spec [§7.17](#function-call-typing)), so this is an ordinary call to a
`localFunction` declared at `mcu`, projected at `server`:

```ts
localFunction();
```

```text
nothing();  =>  null;  =>  removed
```

An imported function (spec [§6.8](#imported-names)) is projected as a local function, except that
it has no declaration to generate: at its endpoint the import that binds it is
kept instead (spec [§12.19](#import-projection)). A call to it projects by the rules above.

#### Choreography Function <a id="epp-choreography-function"></a>

```ts
function foo(a: integer@alice, b: integer@bob): integer@alice {
    return a;
}
```

EPP at `alice`:

```ts
function foo(a: integer, b: null): integer {
    return a;
}
```

EPP at `bob`:

```ts
function foo(a: null, b: integer): null {
    return null;
}
```

A choreography function is generated at every endpoint, so a call to it is kept
at every endpoint — including where its result is absent, since the body may
communicate (spec [§12.4](#expression-projection)). A `void` call has no result to reside anywhere and is
likewise never removed for want of one.

A parameter or return type at `dyn` is `__DynVal` at every endpoint
(spec [§12.3](#type-projection)). An argument placed at a parameter's location is coerced there
(spec [§7.8](#coercion)), and the coercion is part of the argument, so it is kept wherever the
argument is:

```ts
let valDyn: integer@dyn = 5@dyn;
let valAlice: integer@alice = 5@alice;
function funcDyn(a: integer) {}
function funcAlice(a: integer@alice) {}
funcDyn(valDyn);
funcDyn(valAlice);
funcAlice(valDyn);
funcAlice(valAlice);
```

EPP at `alice`:

```ts
function funcDyn(a: __DynVal): void {
}

function funcAlice(a: integer): void {
}
let valDyn: __DynVal = __dynUnbound(5);
let valAlice: integer = 5;
funcDyn(valDyn);
funcDyn(__inject(valAlice, __loc_alice));
funcAlice(__cast(valDyn, __loc_alice));
funcAlice(valAlice);
```

EPP at `bob`:

```ts
function funcDyn(a: __DynVal): void {
}

function funcAlice(a: null): void {
}
let valDyn: __DynVal = __dynUnbound(5);
funcDyn(valDyn);
funcDyn(__inject(null, __loc_alice));
funcAlice(__cast(valDyn, __loc_alice));
funcAlice(null);
```

A returned value is coerced to the return type the same way. A function whose
return type is at `dyn` injects a static value, and one with a static return type
casts a `dyn` value:

```ts
function boo(flag: boolean@every) {
    if (flag) { return 3@alice; }
    else { return 4@every; }
}
function toAlice(a: integer@dyn): integer@alice {
    return a;
}
```

EPP at `alice`:

```ts
function boo(flag: boolean): __DynVal {
    if (flag) {
        return __inject(3, __loc_alice);
    } else {
        return __inject(4, __loc_every);
    }
}

function toAlice(a: __DynVal): integer {
    return __cast(a, __loc_alice);
}
```

EPP at `bob`:

```ts
function boo(flag: boolean): __DynVal {
    if (flag) {
        return __inject(null, __loc_alice);
    } else {
        return __inject(4, __loc_every);
    }
}

function toAlice(a: __DynVal): null {
    return __cast(a, __loc_alice);
}
```

### 12.13 If Projection <a id="if-projection"></a>

```ts
if (c) {
    ...
} else {
    ...
}
```

where `c : boolean@every` in an `@every` context. A condition at `dyn` has been
cast to `every` by lowering (spec [§12.2](#dyn-lowering)), so it too is a `boolean` at every
endpoint.

EPP at each endpoint:

```ts
if (c) {
    ...
} else {
    ...
}
```

### 12.14 While Projection <a id="while-projection"></a>

```ts
while (c) {
    ...
}
```

EPP at each relevant endpoint:

```ts
while (c) {
    ...
}
```

### 12.15 For Projection <a id="for-projection"></a>

```ts
for (let i: integer@every = 0@every; i < 10@every; i = i + 1@every) {
    ...
}
```

EPP at each endpoint:

```ts
for (let i: integer = 0; i < 10; i = i + 1) {
    ...
}
```

#### Absent Header Clauses <a id="absent-header-clauses"></a>

A `let` in the header keeps its binding at every endpoint, as `null` where the
value is absent (spec [§12.3](#type-projection)), so the name stays declared.
This is the one place a `let` binding survives its value; a `let` *statement*
drops the binding instead (spec [§12.9](#let-projection)).

An assignment clause has no such fallback: the variable it assigns to may not
exist at this endpoint at all, and a header slot holds an expression, not the
*statement* that [§12.11](#assignment-projection) would produce. The clause therefore keeps just
`discard_P` of the expressions it evaluated — the same `nothing(...)` [§12.11](#assignment-projection)
builds, sitting in the slot as an expression. Once that simplifies to `null`,
the slot is **omitted** entirely (spec [§13.15](#projected-ast-cleanup)). The compiler must not emit an
assignment to a name that is absent here, nor `null[null] = null` for an absent
array.

```ts
let c: boolean@every = true@every;
let i: integer@alice = 0@alice;
for (i = 0@alice; c; i = i + 1@alice) {
    ...
}
```

EPP at `alice`:

```ts
let c: boolean = true;
let i: integer = 0;
for (i = 0; c; i = i + 1) {
    ...
}
```

EPP at `bob`:

```ts
let c: boolean = true;
for (; c; ) {
}
```

If the clause's expressions still hold a call `bob` has to make (spec [§12.4](#expression-projection)),
the slot keeps it instead of disappearing.

The condition slot is not optional and is never replaced by `null`: it needs a
boolean value, which the typing rules of [§7.12](#if-condition-typing) and [§7.13](#while-and-for-condition-typing) already guarantee is
available at every endpoint. A `dyn` condition is cast to `every`, and the cast
either yields the value at every endpoint or stops with a location error
(spec [§7.9](#dynamic-operations)):

```ts
let boolDyn: boolean@dyn = true@dyn;
if (boolDyn) {}
while (boolDyn) {}
for (let i = 0; i < 10; i = i + 1) {}
```

EPP at `alice` and at `bob`:

```ts
let boolDyn: __DynVal = __dynUnbound(true);
if (__cast(boolDyn, __loc_every)) {
}
while (__cast(boolDyn, __loc_every)) {
}
for (let i: __DynVal = __dynUnbound(0); __cast(__dynLt(i, __dynUnbound(10)), __loc_every); i = __dynPlus(i, __dynUnbound(1))) {
}
```

A dynamic element assignment in a header slot is the bare call
`__dynArraySet(...)`, kept at every endpoint (spec [§12.2](#dyn-lowering)).

### 12.16 Array Projection <a id="array-projection"></a>

Array types, array literals, index expressions, element assignments, `xs.length`, and `xs.push(v)` are projected according to the location of the array value.

Example:

```ts
let xs: integer[]@alice = [1, 2, 3]@alice;
let x: integer@alice = xs[0@alice];
xs[1@alice] = 10@alice;
xs.push(20@alice);
let n: integer@alice = xs.length;
```

EPP at `alice`:

```ts
let xs: any[] = new Array<any>([1, 2, 3]);
let x: integer = xs[0];
xs[1] = 10;
xs.push(20);
let n: integer = xs.length;
```

EPP at `bob` — the array is absent there, so none of these operations is
performed. Each statement keeps only the evaluation of its subexpressions
(spec [§12.4](#expression-projection), [§12.11](#assignment-projection)), and since all of them are literals here, everything
simplifies to `null` and disappears (spec [§13.15](#projected-ast-cleanup)):

```ts
// all removed
```

Had any of those subexpressions held a choreography call, that call would have
remained. An operation's own runtime checks — an array bounds check, a division
by zero — belong to the operation and therefore run only at the endpoints that
keep it.

An array transfer sends the current contents of the array at the transfer statement and produces a fresh mutable array at the receiver.

Example:

```ts
let xs: integer[]@alice = [1, 2]@alice;
let ys: integer[]@bob <- xs;
```

EPP at `alice`:

```ts
let xs: any[] = new Array<any>([1, 2]);
sendArray("bob", "__top_0", xs);
```

EPP at `bob`:

```ts
let ys: any[] = receiveArray("alice", "__top_0");
```

Broadcast to `@every` uses a fresh copy at all endpoints, including the sender.

Example:

```ts
let xs: integer[]@alice = [1, 2]@alice;
let ys: integer[]@every <- xs;
```

EPP at `alice`:

```ts
let xs: any[] = new Array<any>([1, 2]);
broadcastArray("__top_0", xs);
let ys: any[] = __copyArray(xs);
```

EPP at `bob`:

```ts
let ys: any[] = receiveArray("alice", "__top_0");
```

#### Dynamic Arrays <a id="dyn-array-projection"></a>

An array operation whose join is `dyn`, and an array literal at `dyn`, is a
runtime call by the time EPP sees it (spec [§12.2](#dyn-lowering)), and is kept at every endpoint.
The location checks run at every endpoint. The operation on the payload itself,
bounds check included, runs only where the payload is held (spec [§14.15](#dyn-array-operations)).

```ts
let a: integer@alice = 1@alice;
let b: integer@alice = 2@alice;
let d: integer@dyn = 3@dyn;
[1, 2];
[1, 2]@dyn;
[1@dyn, 2@dyn]@dyn;
let e: integer[]@dyn = []@dyn;
[a, b];
let xs: integer[]@alice = [d]@alice;
```

EPP at `alice`:

```ts
let a: integer = 1;
let b: integer = 2;
let d: __DynVal = __dynUnbound(3);
__dynArrayAppend(__dynArrayAppend(__dynArrayNew(), __dynUnbound(1)), __dynUnbound(2));
__dynArrayAppend(__dynArrayAppend(__dynArrayNew(), __dynUnbound(1)), __dynUnbound(2));
__dynArrayAppend(__dynArrayAppend(__dynArrayNew(), __dynUnbound(1)), __dynUnbound(2));
let e: __DynVal = __dynArrayNew();
__dynArrayAppend(__dynArrayAppend(__dynArrayNew(), __inject(a, __loc_alice)), __inject(b, __loc_alice));
let xs: any[] = new Array<any>([__cast(d, __loc_alice)]);
```

EPP at `bob`:

```ts
let d: __DynVal = __dynUnbound(3);
__dynArrayAppend(__dynArrayAppend(__dynArrayNew(), __dynUnbound(1)), __dynUnbound(2));
__dynArrayAppend(__dynArrayAppend(__dynArrayNew(), __dynUnbound(1)), __dynUnbound(2));
__dynArrayAppend(__dynArrayAppend(__dynArrayNew(), __dynUnbound(1)), __dynUnbound(2));
let e: __DynVal = __dynArrayNew();
__dynArrayAppend(__dynArrayAppend(__dynArrayNew(), __inject(null, __loc_alice)), __inject(null, __loc_alice));
__nothing1(__cast(d, __loc_alice));
```

`[a, b]` is bound to `alice` at run time, by its first `__dynArrayAppend`.

The array operations, on the declarations

```ts
let arrDyn: integer[]@dyn = [1, 3, 4]@dyn;
let arrAlice: integer[]@alice = [1, 3, 4]@alice;
let iDyn: integer@dyn = 0@dyn;
let iAlice: integer@alice = 0@alice;
let valDyn: integer@dyn = 5@dyn;
let valAlice: integer@alice = 5@alice;
```

Index access:

```ts
arrDyn[iDyn];
arrAlice[iDyn];
arrDyn[iAlice];
arrAlice[iAlice];
```

EPP at `alice`:

```ts
__dynArrayGet(arrDyn, iDyn);
__dynArrayGet(__inject(arrAlice, __loc_alice), iDyn);
__dynArrayGet(arrDyn, __inject(iAlice, __loc_alice));
arrAlice[iAlice];
```

EPP at `bob` — the static access leaves `nothing(null, null)`, which cleanup
removes:

```ts
__dynArrayGet(arrDyn, iDyn);
__dynArrayGet(__inject(null, __loc_alice), iDyn);
__dynArrayGet(arrDyn, __inject(null, __loc_alice));
```

Element assignment — every combination but the all-`alice` one is dynamic:

```ts
arrDyn[iDyn] = valDyn;
arrDyn[iDyn] = valAlice;
arrAlice[iDyn] = valDyn;
arrAlice[iDyn] = valAlice;
arrDyn[iAlice] = valDyn;
arrDyn[iAlice] = valAlice;
arrAlice[iAlice] = valDyn;
arrAlice[iAlice] = valAlice;
```

EPP at `alice`:

```ts
__dynArraySet(arrDyn, iDyn, valDyn);
__dynArraySet(arrDyn, iDyn, __inject(valAlice, __loc_alice));
__dynArraySet(__inject(arrAlice, __loc_alice), iDyn, valDyn);
__dynArraySet(__inject(arrAlice, __loc_alice), iDyn, __inject(valAlice, __loc_alice));
__dynArraySet(arrDyn, __inject(iAlice, __loc_alice), valDyn);
__dynArraySet(arrDyn, __inject(iAlice, __loc_alice), __inject(valAlice, __loc_alice));
__dynArraySet(__inject(arrAlice, __loc_alice), __inject(iAlice, __loc_alice), valDyn);
arrAlice[iAlice] = valAlice;
```

EPP at `bob`:

```ts
__dynArraySet(arrDyn, iDyn, valDyn);
__dynArraySet(arrDyn, iDyn, __inject(null, __loc_alice));
__dynArraySet(__inject(null, __loc_alice), iDyn, valDyn);
__dynArraySet(__inject(null, __loc_alice), iDyn, __inject(null, __loc_alice));
__dynArraySet(arrDyn, __inject(null, __loc_alice), valDyn);
__dynArraySet(arrDyn, __inject(null, __loc_alice), __inject(null, __loc_alice));
__dynArraySet(__inject(null, __loc_alice), __inject(null, __loc_alice), valDyn);
```

Push and `.length`:

```ts
arrDyn.push(valDyn);
arrDyn.push(valAlice);
arrAlice.push(valDyn);
arrAlice.push(valAlice);
arrDyn.length;
arrAlice.length;
```

EPP at `alice`:

```ts
__dynArrayPush(arrDyn, valDyn);
__dynArrayPush(arrDyn, __inject(valAlice, __loc_alice));
__dynArrayPush(__inject(arrAlice, __loc_alice), valDyn);
arrAlice.push(valAlice);
__dynArrayLength(arrDyn);
arrAlice.length;
```

EPP at `bob`:

```ts
__dynArrayPush(arrDyn, valDyn);
__dynArrayPush(arrDyn, __inject(null, __loc_alice));
__dynArrayPush(__inject(null, __loc_alice), valDyn);
__dynArrayLength(arrDyn);
```

### 12.17 Print Projection <a id="print-projection"></a>

A print is projected according to the location of its argument (spec [§7.18](#print-typing)).
For `print(e)` with `e : T@L`, at endpoint `P`:

```text
project_P(print(e)) =
    if residesAt(L, P):  print(project_P(e))
    else:                nothing(discard_P(e))
```

This is the expression projection rule (spec [§12.4](#expression-projection)) applied to a print. Where
`P` does not print, the argument is still evaluated, so a choreography call in
it is still made: at an endpoint that does not hold the value of `f()`,
`print(f())` leaves `f()` inside a `nothing(...)`. A print of a `dyn` value is
the runtime call `__dynPrint(v)` by the time EPP sees it (spec [§12.2](#dyn-lowering)), and is kept at
every endpoint.

Code generation writes a static print as it stands, `print(e)`. It is a call of
BlueScript's own `print`, which comes from BlueScript's standard library like
the communication API (spec [§14](#runtime-support-functions)). `__dynPrint` calls the same `print` on the payload
(spec [§14.16](#dyn-print)).

Example:

```ts
let x: integer@alice = 10@alice;
print(x);
let s: string@every = "ready"@every;
print(s);
let d: integer@dyn = 3@dyn;
print(d);
```

EPP at `alice`:

```ts
let x: integer = 10;
print(x);
let s: string = "ready";
print(s);
let d: __DynVal = __dynUnbound(3);
__dynPrint(d);
```

EPP at `bob` — `x` is absent there, so its print leaves `nothing(null)`, which
cleanup removes (spec [§13.15](#projected-ast-cleanup)):

```ts
let s: string = "ready";
print(s);
let d: __DynVal = __dynUnbound(3);
__dynPrint(d);
```

`d` is still unbound when it is printed, so both endpoints print `3`
(spec [§14.16](#dyn-print)).

### 12.18 Top-Level Projection <a id="top-level-projection"></a>

Top-level non-function statements are projected as the entry program for each endpoint.

Input:

```ts
let x: integer@alice = 10@alice;
let y: integer@bob <- x;
```

EPP at `alice`:

```ts
let x: integer = 10;
sendInteger("bob", "__top_0", x);
```

EPP at `bob`:

```ts
let y: integer = receiveInteger("alice", "__top_0");
```

An endpoint's program declares its functions first, after its imports
(spec [§13.16](#import-code-generation)), and then runs its top-level statements, in source order. A top-level declaration is therefore a global of
the BlueScript program, and a top-level constant that a function uses
(spec [§6.6](#top-level-let)) is declared below that function (spec [§17.8](#unverified-bluescript-assumptions)). A projected
function reads the constant only where the constant has a value, and that is
where its declaration is kept: both follow the constant's location
(spec [§12.7](#identifier-projection), [§12.9](#let-projection)).

Input:

```ts
const limit: integer@alice = 10@alice;

function report(x: integer@alice): void {
    let y: integer@bob <- x + limit;
}

report(1@alice);
```

EPP at `alice`:

```ts
function report(x: integer): void {
  sendInteger("bob", "report_0", x + limit);
}
const limit: integer = 10;
report(1);
```

EPP at `bob`:

```ts
function report(x: null): void {
  let y: integer = receiveInteger("alice", "report_0");
}
report(null);
```

### 12.19 Import Projection <a id="import-projection"></a>

An import declaration at `P` (spec [§5.19](#import-declarations)) is projected to `P` alone, where it
is the same declaration without its location:

```text
project_P(import@P { s1, ..., sn } from "m";)  =  import { s1, ..., sn } from "m";
project_Q(import@P { s1, ..., sn } from "m";)  =  (nothing)          where Q != P
```

Every import at `P` is kept at `P`, whether or not the program uses what it
imports: importing a module initializes it, and the projection keeps that
effect where the source puts it. A call to an imported function projects as a
call to a local function at `P` (spec [§12.12](#function-projection)), and a use of an imported constant
as a use of a top-level constant at `P` (spec [§12.7](#identifier-projection)).

Input:

```ts
import@alice { now as nowAtAlice } from "./clock";
import@bob { now as nowAtBob } from "./clock";

let t: integer@alice = nowAtAlice();
let u: integer@bob <- t;
```

EPP at `alice`:

```ts
import { now as nowAtAlice } from "./clock";

let t: integer = nowAtAlice();
sendInteger("bob", "__top_0", t);
```

EPP at `bob`:

```ts
import { now as nowAtBob } from "./clock";

let u: integer = receiveInteger("alice", "__top_0");
```

***

## 13. BlueScript Code Generation <a id="bluescript-code-generation"></a>

### 13.1 Type Mapping <a id="type-mapping"></a>

```text
ChoreoBS integer -> BlueScript integer
ChoreoBS float   -> BlueScript float
ChoreoBS boolean -> BlueScript boolean
ChoreoBS string  -> BlueScript string
ChoreoBS null    -> BlueScript null
ChoreoBS void    -> BlueScript void
ChoreoBS integer[] -> BlueScript any[]
ChoreoBS float[]   -> BlueScript any[]
ChoreoBS boolean[] -> BlueScript any[]
ChoreoBS T@dyn     -> BlueScript __DynVal
ChoreoBS T[]@dyn   -> BlueScript __DynVal
```

Every array type is BlueScript's `any[]`, because BlueScript gives `push` to an
`any[]` alone: its `integer[]`, `float[]` and `boolean[]` have no methods. Endpoint
projection keeps the element type (spec [§12.3](#type-projection)), and only code generation drops
it. An element is then held as an `any`, which limits the values it can hold
(spec [§7.1.1](#array-types)).

The generated code relies on BlueScript converting between `any` and the static
types implicitly, in both directions:

* a value of a static type becomes an `any` wherever an `any` is expected: an
  element of `new Array<any>([...])`, the value of an element assignment, and an
  argument of `__inject`, `__dynUnbound` or a `__nothing…` helper;
* an `any` becomes a value of a static type wherever that type is expected — a
  read element `xs[i]`, or the result of `__cast`, used as an initializer, an
  assigned value, a condition, an argument or a returned value. BlueScript
  checks at run time that the `any` holds a value of that type.

An explicit `as` on an `any` is the same check (spec [§13.5](#numeric-conversion-code-generation)).

`__DynVal` is the class of the dynamic-location runtime (spec [§14.9](#dyn-val)), imported from
the runtime file (spec [§13.10](#runtime-import)).

### 13.2 Location Annotation Removal <a id="location-annotation-removal"></a>

BlueScript output does not contain location annotations.

```ts
let x: integer@alice = 1@alice;
```

EPP at `alice`:

```ts
let x: integer = 1;
```

A location does reach the output as data. An endpoint is named by a string
literal in a call of the communication API, as `sendInteger("bob", …)`
(spec [§13.14](#communication-api)), and a location by one of the runtime's constants
`__loc_alice`, `__loc_every` and `__loc_dyn` in the arguments of runtime calls
(spec [§14.6](#location-and-kind-codes)). An endpoint name is an identifier other than `every` and `dyn`
(spec [§2.2](#choreobs-json)), so `__loc_` followed by it is never `__loc_every` or `__loc_dyn`: the
constants cannot collide. Every one begins with `__`, which no name of the
program may take (spec [§6.2](#function-names)), so none can capture or be captured by one.

### 13.3 Array Operation Code Generation <a id="array-operation-code-generation"></a>

A static array literal is emitted as BlueScript's array constructor with the
element type `any`, empty or not:

```text
[e1, ..., en]  =>  new Array<any>([e1, ..., en])
[]             =>  new Array<any>([])
```

This is BlueScript's own form, which builds an `any[]` from the elements. It is
not TypeScript's `new Array(x)`, which would make an array whose one element is
`x`. The literal `[e1, ..., en]` alone would not do: BlueScript types it by its
elements, as an `integer[]` for example, which has no `push` (spec [§13.1](#type-mapping)).

A static `xs[i]`, `xs[i] = v`, `xs.length` and `xs.push(v)` are emitted
unchanged: BlueScript spells them the same way ChoreoBS does, so code generation
for these is the identity. A dynamic one is already a runtime call
(spec [§12.2](#dyn-lowering)).

```ts
xs[i]
xs[i] = v
xs.length
xs.push(v)
```

`.length` and `.push` are the whole of ChoreoBS's dot syntax. A program cannot
access a field or call a method on anything else (spec [§17.2](#typescript-javascript-features)).

Every array at run time is an `any[]`: the static literals above, the runtime's
empty array (spec [§14.15](#dyn-array-operations)), and every array the communication API and the copy
helper return (spec [§13.14](#communication-api)). The generated code relies on this. BlueScript's
conversion from `any` to `any[]`, which a `__cast` of an array makes, checks only
that the value is an array, so an `integer[]` would pass it and fail later, at
its first `push`.

### 13.4 Logical Operator Code Generation <a id="logical-operator-code-generation"></a>

The projected IR keeps `&&` and `||` as binary operations. Code generation
spells them as calls to the runtime helpers `__and` and `__or`
(spec [§14.3](#and-or-helpers)), imported from the runtime file (spec [§13.10](#runtime-import)):

```text
e1 && e2  =>  __and(e1, e2)
e1 || e2  =>  __or(e1, e2)
```

They cannot be emitted unchanged, as the binary arithmetic operators are, because
BlueScript's `&&` and `||` short-circuit and ChoreoBS's do not
(spec [§5.18](#evaluation-order)). A call evaluates both of its arguments, left to right, before
the helper runs, which is exactly the evaluation ChoreoBS prescribes. The
spelling is the same whatever the static operands are, including in a local
function. With a `dyn` operand, the operation is the runtime call `__dynAnd` or
`__dynOr` instead (spec [§12.2](#dyn-lowering)).

### 13.5 Numeric Conversion Code Generation <a id="numeric-conversion-code-generation"></a>

A projected conversion is emitted as BlueScript's own `as`, in parentheses. A
conversion between the two numeric types first names the operand's own type `S`,
and a conversion to the operand's own type stays one step:

```text
e as T  =>  ((e as S) as T)     where S is the type of e, and S is not T
e as T  =>  (e as T)            where e has type T
```

The first `as` is there for an operand that BlueScript holds as an `any`: a
value read from an array (spec [§7.1.1](#array-types)), or a result computed from one. BlueScript's
`as integer` on an `any` accepts only an integer, so it would stop the program on
a `float` element instead of converting it; `as S` first gives the value back its
static type, and the second `as` then converts it as a static value. The rule
applies to every conversion between the two types, whatever its operand, so that
the output never depends on what BlueScript holds as an `any`.

```ts
let fs: float[]@alice = [1.5]@alice;
let i: integer@alice = fs[0@alice] as integer;
let f: float@alice = i as float;
let j: integer@alice = i as integer;
```

EPP at `alice`:

```ts
let fs: any[] = new Array<any>([1.5]);
let i: integer = ((fs[0] as float) as integer);
let f: float = ((i as integer) as float);
let j: integer = (i as integer);
```

The parentheses keep the conversion together whatever operator surrounds it.
A conversion the source already parenthesizes is not wrapped a second time:
`total / (n as float)` is emitted as `total / ((n as integer) as float)`.

Only an endpoint that holds the value emits one (spec [§12.8](#binary-and-unary-operation-projection)); where the value
is absent there is no `as` at all, so `null as T` is never emitted. A conversion
of a `dyn` operand to the other numeric type is a runtime call, whose own `as`
runs only where the payload is held (spec [§14.13](#dyn-numeric-conversion)).

### 13.6 Unary Minus Code Generation <a id="unary-minus-code-generation"></a>

A projected unary minus is emitted in parentheses:

```text
-e  =>  (-e)
```

Written bare, `- -x` would come out as `--x`, which BlueScript reads as a
decrement. The parentheses are added whatever surrounds the operator, even where
the source already has them: `(-x)` is emitted as `((-x))`. `!` is emitted as
written, since `!!c` means the same in BlueScript.

A unary operator on a `dyn` operand is the runtime call `__dynNeg` or `__dynNot`
instead (spec [§12.2](#dyn-lowering)).

### 13.7 `nothing` Code Generation <a id="nothing-code-generation"></a>

A `nothing(e1, ..., en)` that survives cleanup (spec [§13.15](#projected-ast-cleanup)) is emitted as calls
to the fixed-arity helpers `__nothing1` to `__nothing5` (spec [§14.1](#nothing)). BlueScript has
no rest parameters, so no single helper could take any number of arguments.

With at most five arguments, it is one call to the helper of that arity:

```text
nothing(e1)            =>  __nothing1(e1)
nothing(e1, e2)        =>  __nothing2(e1, e2)
...
nothing(e1, ..., e5)   =>  __nothing5(e1, ..., e5)
```

With more, the first five arguments go to `__nothing5`, and the rest follow in
order, up to four at a time. Each group makes a call whose first argument is the
call built so far:

```text
nothing(e1, ..., e6)   =>  __nothing2(__nothing5(e1, ..., e5), e6)
nothing(e1, ..., e9)   =>  __nothing5(__nothing5(e1, ..., e5), e6, e7, e8, e9)
nothing(e1, ..., e10)  =>  __nothing2(__nothing5(__nothing5(e1, ..., e5), e6, e7, e8, e9), e10)
```

* The arguments keep their order, and a call evaluates its arguments left to
  right before the helper runs (spec [§5.18](#evaluation-order)). Each `ei` is therefore evaluated
  exactly once, in the order `nothing(...)` prescribes, and the whole call yields
  `null` (spec [§14.1](#nothing)).
* The arguments are split here and nowhere else. The projected IR keeps one
  `nothing(...)` with all its arguments, and cleanup sees it as one node
  (spec [§13.15](#projected-ast-cleanup)).
* A `nothing(...)` nested in the IR is emitted level by level, as it stands:
  `nothing(a, nothing(b, c))` becomes `__nothing2(a, __nothing2(b, c))`. Code
  generation neither flattens it (spec [§13.15.3](#nested-nothing-is-not-flattened)) nor nests anything more than the
  split above.
* There is no `__nothing0`. Cleanup folds every `nothing()` into `null`
  (spec [§13.15.2](#expression-simplification)), so none reaches code generation.

This specification writes the artifact as `nothing(...)` wherever it shows the
projected IR: in the rules of EPP (spec [§12](#endpoint-projection)), absent finalization
(spec [§13.13](#absent-finalization)) and cleanup (spec [§13.15](#projected-ast-cleanup)), and in the examples of those stages, such as
the steps of spec [§15.7](#example-cleanup-of-nothing). The "EPP at `P`" examples show an endpoint's program as
the compiler writes it, after cleanup and code generation, so they spell the
helpers out — and `__and` and `__or` too (spec [§13.4](#logical-operator-code-generation)) — leaving only the `import`
line out (spec [§13.10](#runtime-import)).

### 13.8 Function Names <a id="codegen-function-names"></a>

Generated function names are the same as the original ChoreoBS function names.
Because there is no renaming, the names the generated code relies on are
reserved in the source language (spec [§6.2](#function-names)).

```ts
function add@alice(...)
```

EPP at `alice`:

```ts
function add(...)
```

The dynamic-location runtime's names (spec [§14.5](#dyn-runtime)) all begin with `__`, so no user
function can share one (spec [§6.2](#function-names)).

### 13.9 Output File Naming <a id="output-file-naming"></a>

Input:

```text
src/index.cbs
```

`choreobs.json`:

```json
{
  "name": "example",
  "endpoints": [
    { "name": "alice", "board": "host" },
    { "name": "bob", "board": "host" }
  ]
}
```

Output, for projects whose `entryFile` is `./src/index.bs`, as `bscript project create`
makes them (spec [§2.3](#output-files)):

```text
workspace/alice/src/index.bs
workspace/alice/src/__runtime.bs
workspace/bob/src/index.bs
workspace/bob/src/__runtime.bs
```

Each endpoint's program goes to its project's entry file, and its runtime file
next to it. The runtime file is written for every endpoint, whether or not the
program imports from it (spec [§2.3](#output-files)). The copies of the BlueScript source files
go below the same directory (spec [§2.5](#bluescript-source-files)).

### 13.10 Runtime Import <a id="runtime-import"></a>

An endpoint program that uses anything from the runtime file (spec [§2.3](#output-files)) imports
what it uses from it, in one `import` at the top. The program's own imports
follow it, and a blank line follows the last import (spec [§13.16](#import-code-generation)):

```ts
// workspace/alice/src/index.bs
import { __nothing2, __and, __copyArray, __DynVal, __dynUnbound, __inject, __cast, __dynPlus, __loc_alice } from "./__runtime";
```

* Only the names the program uses are imported: each core helper it calls —
  the `__nothing…` helpers its `nothing(...)` artifacts are emitted as
  (spec [§13.7](#nothing-code-generation)), `__and`, `__or` and `__copyArray` — then `__DynVal` when a
  type is `__DynVal`, each runtime function it calls, and each location or kind
  constant its runtime calls name (spec [§14.6](#location-and-kind-codes)).
* They are listed in a fixed order: the core helpers first, as `__nothing1` to
  `__nothing5`, `__and`, `__or`, `__copyArray`; then `__DynVal`; then the runtime
  functions in the order of the table of spec [§12.2](#dyn-lowering); then the constants, in the
  order of their names' characters. That order, unlike the constants' codes,
  does not depend on the order of the endpoints, so neither does the program.
* Every endpoint's program imports from the same module name, `"./__runtime"`:
  each runtime file sits in its own endpoint's project, next to the program.
* The module name has no extension. BlueScript resolves a relative import by
  appending `.bs` itself, so `"./__runtime.bs"` would look for
  `__runtime.bs.bs`.
* A program that uses nothing from the runtime file has no runtime `import`.
* In a profiling build, the names it adds follow the constants
  (spec [§13.17](#profiling-build)).

The examples in this specification leave the runtime `import` line out.

### 13.11 Local Functions <a id="codegen-local-functions"></a>

A local function is emitted only for the corresponding endpoint.

### 13.12 Choreography Functions <a id="codegen-choreography-functions"></a>

A choreography function is emitted for all endpoints.

### 13.13 Absent Finalization <a id="absent-finalization"></a>

Absent finalization is a stage of its own, between endpoint projection and
cleanup:

```text
Typed AST
  -> Communication tag assignment (spec §communication-tags)
  -> Dynamic location lowering (spec §dyn-lowering)
  -> Endpoint Projection
  -> Projected IR containing absent and nothing(...)
  -> Absent finalization
  -> Projected IR containing null and nothing(...)
  -> Bottom-up cleanup (spec §projected-ast-cleanup)
  -> BlueScript emission, and the runtime files if it imports from them (spec §output-files)
```

It does exactly one thing: every remaining `absent` leaf becomes `null`
(spec [§12.5](#absent)).

```text
absent => null
```

It does not fold `nothing(...)`, and it does not remove statements. Given

```text
nothing(absent, nothing(absent, absent))
```

it produces

```text
nothing(null, nothing(null, null))
```

and leaves the folding to cleanup.

Keeping the two apart is what lets each be stated as one rule. Cleanup's rule is
written over arguments that are *syntactically* `null`; an `absent` is not one,
so fusing the two stages would make that rule depend on an unstated ordering. An
`absent` that reaches cleanup or code generation is an internal error, not
something to paper over with a `null`.

After finalization the output contains no `absent`. The remaining `null;`
statements and `nothing(...)` artifacts are removed where possible by the
cleanup pass in [Section 13.15](#projected-ast-cleanup).

### 13.14 Communication API <a id="communication-api"></a>

The generated BlueScript code uses a communication API for each scalar type, and
one for every array type. It belongs to BlueScript's standard library, which
every program has without importing it (spec [§14](#runtime-support-functions)).

```ts
sendInteger(dst: string, tag: string, value: integer): void;
receiveInteger(src: string, tag: string): integer;

sendFloat(dst: string, tag: string, value: float): void;
receiveFloat(src: string, tag: string): float;

sendBoolean(dst: string, tag: string, value: boolean): void;
receiveBoolean(src: string, tag: string): boolean;

sendString(dst: string, tag: string, value: string): void;
receiveString(src: string, tag: string): string;

sendNull(dst: string, tag: string, value: null): void;
receiveNull(src: string, tag: string): null;

sendArray(dst: string, tag: string, value: any[]): void;
receiveArray(src: string, tag: string): any[];
```

There is one send/receive pair and one broadcast per transferable scalar type,
and one for all arrays, and the compiler selects it from the transfer's base
type. There is no default: a base type with no entry here cannot be transferred,
and the compiler must reject it rather than fall back on another type's API.

Every array type is an `any[]` in the output (spec [§13.1](#type-mapping)), so the one `Array` API
carries an `integer[]`, a `float[]` and a `boolean[]` alike, each element as the
`any` that holds it (spec [§7.1.1](#array-types)). The array it returns must itself be an `any[]`
(spec [§13.3](#array-operation-code-generation)).

A dynamic transfer selects the API at run time instead: the compiler passes the
destination type's kind as one of six integer constants of the runtime,
`__kind_integer`, `__kind_float`, `__kind_boolean`, `__kind_string`,
`__kind_null` and `__kind_array` (spec [§14.6](#location-and-kind-codes)), and the runtime dispatches on it
(spec [§14.14](#dyn-transfer-runtime)). There is no default there either. The runtime file calls
this API as the generated code does, naming the peer endpoint by the string the
API takes.

Broadcast APIs:

```ts
broadcastInteger(tag: string, value: integer): void;
broadcastFloat(tag: string, value: float): void;
broadcastBoolean(tag: string, value: boolean): void;
broadcastString(tag: string, value: string): void;
broadcastNull(tag: string, value: null): void;

broadcastArray(tag: string, value: any[]): void;
```

The array copy helper, `__copyArray`, is used by generated code for:

* sender-side fresh copies in array broadcast;
* local copies produced by a transfer (spec [§11.4](#local-copy)).

It returns a fresh `any[]`:

```ts
__copyArray(value: any[]): any[];
```

Unlike the communication API it is not BlueScript's: the compiler writes it into
the runtime file with the other core helpers (spec [§14.4](#copy-array-helper)), and a program
that calls it imports it from there (spec [§13.10](#runtime-import)).

### 13.15 Projected AST Cleanup <a id="projected-ast-cleanup"></a>

After absent finalization (spec [§13.13](#absent-finalization)) and before BlueScript code generation, the compiler performs a cleanup pass over the projected AST.

The purpose of this pass is to remove or simplify compiler-generated artifacts such as unnecessary `null` statements and `nothing(...)` expressions.

This cleanup pass must operate on the projected AST or projected IR. It must not be implemented as string-based post-processing over generated BlueScript code.

#### 13.15.1 A Single Bottom-Up Pass <a id="a-single-bottom-up-pass"></a>

Cleanup is one pass in post order: every subexpression is simplified before its
parent is considered, and statements are handled after their expressions.

```text
cleanupExpr(nothing(e1, ..., en)):
    e1' = cleanupExpr(e1)
    ...
    en' = cleanupExpr(en)

    if every ei' is syntactically null:
        return null
    else:
        return nothing(e1', ..., en')
```

Expression simplification is applied before statement cleanup. Every expression
slot is visited, including ones that are easy to overlook: the index of an
array element assignment target, and the initializer, condition and update of a
`for` header.

An `absent` reaching this pass is an internal error (spec [§13.13](#absent-finalization)).

#### 13.15.2 Expression Simplification <a id="expression-simplification"></a>

The only rule is:

```text
nothing(null, ..., null) => null
nothing()                => null
```

It applies only when, after recursively simplifying all arguments, every
argument of `nothing(...)` is exactly `null`. The zero-argument case is included:
it arises when a call to a local function with no parameters is projected to an
endpoint that does not generate that function (spec [§12.12](#function-projection)), and where `xs.length`
or `[]` is discarded (spec [§12.4](#expression-projection)).

Examples:

```ts
nothing(null)
```

is simplified to:

```ts
null
```

```ts
nothing(null, null)
```

is simplified to:

```ts
null
```

Nested `nothing(...)` expressions are simplified recursively, innermost first.

```text
nothing(nothing(null), null)
=> nothing(null, null)
=> null
```

```ts
nothing(nothing(null), null, null)
=> nothing(null, null, null)
=> null
```

#### 13.15.3 Nested `nothing(...)` Is Not Flattened <a id="nested-nothing-is-not-flattened"></a>

ChoreoBS v1 does not rewrite

```text
nothing(a, nothing(b, c))
```

into

```text
nothing(a, b, c)
```

The nesting mirrors the source expression's structure and evaluation
boundaries, which keeps EPP a plain structural recursion. Run-time location
checks live in runtime calls (spec [§12.2](#dyn-lowering)), which are never inside a `nothing(...)`
that cleanup could fold. Flattening is listed under [§17.7](#future-cleanup-optimizations).

#### 13.15.4 Simplification Inside Function Arguments <a id="simplification-inside-function-arguments"></a>

Expression simplification must also be applied recursively inside ordinary function call arguments.

Example:

```ts
foo(nothing(null), null)
```

is simplified to:

```ts
foo(null, null)
```

The function call itself must not be removed by this cleanup rule.

#### 13.15.5 Statement Cleanup <a id="statement-cleanup"></a>

After expression simplification, the compiler removes expression statements
whose expression is exactly `null`, and only those.

```ts
null;
```

is removed. Therefore:

```ts
nothing(nothing(null), null, null);
=> null;
=> removed
```

A `for` header slot that holds only a discarded expression is dropped once that
expression simplifies to `null` — the header equivalent of the same rule
(spec [§12.15](#for-projection)). A binding or a real assignment in the header stays.

None of these are removed, however much `null` they carry:

```ts
return null;
let x = null;
x = null;
f(null);
```

#### 13.15.6 What This Cleanup Pass Must Not Remove <a id="what-this-cleanup-pass-must-not-remove"></a>

This cleanup pass is intentionally conservative.

It must not remove ordinary function calls.

Example:

```ts
foo(null, null);
```

must remain as:

```ts
foo(null, null);
```

A call must be kept even when the type system says it returns `null`: the call
may communicate (spec [§12.4](#expression-projection)). So these stay as they are:

```text
nothing(f(), null)
nothing(null, g())
nothing(nothing(f()), null)
```

It must not remove communication operations such as:

```ts
sendInteger("bob", "__top_0", x);
receiveInteger("alice", "__top_0");
broadcastBoolean("__top_1", c);
```

It must not remove runtime calls (spec [§12.2](#dyn-lowering)), wherever they stand. Each one
creates, unifies or binds location variables, which every endpoint must do alike
(spec [§12.4](#expression-projection)), and `__dynTransfer` may communicate:

```ts
__dynUnbound(3);
__cast(__dynUnbound(3), __loc_alice);
nothing(__cast(d, __loc_alice));
__cast(__dynTransfer("__top_2", __kind_integer, __loc_bob, valDyn1), __loc_bob);
```

It must not remove assignments, loops, conditionals, or function declarations merely because they contain `null` values.

ChoreoBS v1 cleanup performs none of the following, and must not be extended with
them without revisiting [§12.4](#expression-projection):

* purity analysis;
* side-effect analysis;
* return-value equivalence analysis;
* general dead-code elimination;
* removal of ordinary function calls.

#### 13.15.7 Source-Level `null` <a id="source-level-null"></a>

A `null` that came from a source-level `null` literal and a `null` produced by
absent finalization are the same node by the time cleanup runs, and are treated
alike. A statement that is exactly `null;` has no effect in either case, so
removing it is sound.

### 13.16 Import Code Generation <a id="import-code-generation"></a>

An endpoint's program begins with its imports: the runtime import, when there
is one (spec [§13.10](#runtime-import)), then each import declaration projected to the endpoint
(spec [§12.19](#import-projection)), one per line in source order, then a blank line before the rest
of the program. A program with nothing after its imports has no blank line.

```ts
// workspace/alice/src/index.bs
import { __nothing1 } from "./__runtime";
import { readSensor, threshold as limit } from "./sensor@alice";
import { now as nowAtAlice } from "./clock";

function ...
```

* The module name is written as the source writes it (spec [§5.19](#import-declarations)). The source
  files are copied below the program's directory as they are below `src/`
  (spec [§2.5](#bluescript-source-files)), so it names the same file there.
* A specifier is written `name` when it binds the name itself, and
  `name as local` otherwise: `now as now` is written `now`.
* Each import declaration stays a declaration of its own, even beside another
  from the same file. BlueScript initializes a module once, however many
  declarations import from it.
* Renaming with `as` needs a BlueScript that supports it (spec [§17.8](#unverified-bluescript-assumptions)).

### 13.17 Profiling Build <a id="profiling-build"></a>

A **profiling build** is the output instrumented to show where an endpoint's
time goes: how often and for how long it communicates, and how much work the
dynamic-location runtime does. It is made only when asked for, with
`choreobs compile --profile` or `choreobs run --profile` (spec [§2.4](#commands)). Without it,
every file is exactly what the rest of this specification describes.

It changes the text of the output in three ways and no other. The programs are
the same ones: a profiling build sends and prints what the ordinary build does,
and then the report.

1. Every call of a communication function (spec [§13.14](#communication-api)) calls its wrapper
   instead, named with the prefix `__prof_`: `sendInteger(...)` becomes
   `__prof_sendInteger(...)`. That holds in the endpoint programs and in the
   runtime's `__sendAny`, `__receiveAny` and `__broadcastAny`
   (spec [§14.14](#dyn-transfer-runtime)), so static and dynamic transfers are counted alike.
2. Every endpoint's program ends with `__profReport();`, which prints the
   report. An endpoint with no code of its own gets a program of its runtime
   `import` and that call.
3. The runtime file gets a third part, first in the file: the counters, the
   wrappers and `__profReport`. The other two parts count events where they
   happen, in statements that are whole lines, and gain no other lines but one
   function, `__profOp`, after the location functions (spec [§14.10](#location-functions)).

```ts
export function __prof_sendInteger(to: string, tag: string, v: integer): void {
  const t0 = performanceNow();
  sendInteger(to, tag, v);
  __prof_send_ms = __prof_send_ms + (performanceNow() - t0);
  __prof_send_n = __prof_send_n + 1;
}

export function __prof_receiveInteger(from: string, tag: string): integer {
  const t0 = performanceNow();
  const v: integer = receiveInteger(from, tag);
  __prof_receive_ms = __prof_receive_ms + (performanceNow() - t0);
  __prof_receive_n = __prof_receive_n + 1;
  return v;
}
```

* Each kind has a send, a receive and a broadcast wrapper of this form. A
  broadcast wrapper takes `(tag: string, v: T)` and adds to `broadcast_ms` and
  `broadcast_n`; an array is passed as an `any[]`.
* The program imports the wrappers it calls and `__profReport` after its other
  runtime imports (spec [§13.10](#runtime-import)): each kind's send and receive wrappers, kind by
  kind in the order of spec [§13.14](#communication-api), then the broadcast wrappers in the same
  order, then `__profReport`. The ordinary build's list is therefore always
  where the profiling build's begins.
* The compiler's own check that every message has its partner reads a call of
  a wrapper as the call it wraps.
* Each counter is a module-level `let` of its type, set to `0` or `0.0` and not
  exported. `__profOp(loc)` adds one to `op_here`, `op_every`, `op_unbound` or
  `op_skip` by the location a dynamic operation's operands were unified to,
  comparing the codes itself, so that the counts of `__isHere`, `__isEvery`
  and `__holdsPayload` are those of the operation alone.

`__profReport` prints with `print`, one value per line: the string
`__choreobs_profile`, the format version `1`, the number of counters, `33`,
and then the counters in the order of this table.

| Counter | Type | What it counts |
|---|---|---|
| `send_n` | `integer` | calls of a send function |
| `send_ms` | `float` | milliseconds spent in send functions |
| `receive_n` | `integer` | calls of a receive function |
| `receive_ms` | `float` | milliseconds spent in receive functions, waiting for the message included |
| `broadcast_n` | `integer` | calls of a broadcast function |
| `broadcast_ms` | `float` | milliseconds spent in broadcast functions |
| `dynval_new` | `integer` | `__DynVal` objects made |
| `locvar_new` | `integer` | `__LocVar` objects made |
| `find` | `integer` | calls of `__find` |
| `unify` | `integer` | calls of `__unify` |
| `bind` | `integer` | calls of `__bind` |
| `root_steps` | `integer` | parent links `__root` follows |
| `holds` | `integer` | calls of `__holdsPayload` |
| `is_here` | `integer` | calls of `__isHere` |
| `is_every` | `integer` | calls of `__isEvery` |
| `kind_dispatch` | `integer` | calls of `__sendAny`, `__receiveAny`, `__broadcastAny` and `__copyPayload`, each of which dispatches on a kind |
| `unbound` | `integer` | calls of `__dynUnbound` |
| `inject` | `integer` | calls of `__inject` |
| `cast` | `integer` | calls of `__cast` |
| `transfer` | `integer` | calls of `__dynTransfer` |
| `transfer_broadcast` | `integer` | dynamic transfers this endpoint broadcast |
| `transfer_send` | `integer` | dynamic transfers this endpoint sent |
| `transfer_none` | `integer` | dynamic transfers whose result this endpoint does not hold |
| `transfer_copy` | `integer` | dynamic transfers whose result this endpoint copied from its own payload |
| `transfer_receive` | `integer` | dynamic transfers whose result this endpoint received |
| `copy_array` | `integer` | calls of `__copyArray`, by a static local copy or a dynamic transfer |
| `op_arith` | `integer` | calls of a dynamic operator or conversion |
| `op_array` | `integer` | calls of `__dynArrayGet`, `__dynArraySet`, `__dynArrayPush` and `__dynArrayLength` |
| `op_print` | `integer` | calls of `__dynPrint` |
| `op_here` | `integer` | dynamic operations at this endpoint's own location |
| `op_every` | `integer` | dynamic operations at `every` |
| `op_unbound` | `integer` | dynamic operations at a location still unbound |
| `op_skip` | `integer` | dynamic operations at another endpoint, whose payload this endpoint does not compute |

* A time is read with BlueScript's `performanceNow()` and includes the wrapper's
  own cost. A profiling build therefore runs more slowly than the ordinary
  build: time the ordinary build, and use a profiling build for the counts.
* The counts of one endpoint satisfy `op_arith + op_array + op_print =
  op_here + op_every + op_unbound + op_skip` and `transfer = transfer_none +
  transfer_copy + transfer_receive`. Over all the endpoints of a run,
  `receive_n` is `send_n` plus `broadcast_n` times one less than the number of
  endpoints, as long as every endpoint is still running when a broadcast is
  made.
* A program stopped by a runtime error, a location error included
  (spec [§14.8](#location-errors)), prints no report.

***

## 14. Runtime Support Functions <a id="runtime-support-functions"></a>

The generated code relies on two groups of functions:

* BlueScript's standard library, which every program has without importing it,
  with or without `dyn`: the communication API (spec [§13.14](#communication-api)) and `print`
  (spec [§7.18](#print-typing));
* generated by the compiler into the runtime file (spec [§2.3](#output-files)), and imported from
  it (spec [§13.10](#runtime-import)):
  * the core helpers, for every program that calls them: `__nothing1` to
    `__nothing5` ([§14.1](#nothing)), `__and` and `__or` ([§14.3](#and-or-helpers)), and the copy helper
    `__copyArray` ([§14.4](#copy-array-helper));
  * the dynamic-location runtime, for a program that uses `dyn` only
    ([§14.5](#dyn-runtime)–[§14.16](#dyn-print)).

The `ts` blocks of this chapter are the runtime file itself, in the order they
appear in it — that of an ordinary build. A profiling build adds to it
(spec [§13.17](#profiling-build)).

### 14.1 `nothing` <a id="nothing"></a>

`nothing(e1, ..., en)` is a compiler-generated artifact, not a user-callable
function and not an ordinary call. It is the projected IR node that preserves
the evaluation of subexpressions whose result this endpoint has no use for
(spec [§12.4](#expression-projection)).

Its semantics:

1. evaluate `e1` through `en`, left to right;
2. evaluate each argument exactly once;
3. discard each argument's value;
4. contribute no effect of its own;
5. yield `null`.

Equivalently:

```text
evaluate e1;
evaluate e2;
...
evaluate en;
return null;
```

`nothing()` with no arguments is allowed, and yields `null`.

The compiler must distinguish this artifact from an ordinary call, including
from a user-defined function that happens to be named `nothing`. In the
projected IR it is a node of its own; only that node is subject to the
simplification rule in [§13.15](#projected-ast-cleanup).

Code generation emits what cleanup leaves as calls to fixed-arity helpers, one
for each number of arguments from one to five (spec [§13.7](#nothing-code-generation)). They open the
runtime file:

```ts
export function __nothing1(a1: any): null {
  return null;
}

export function __nothing2(a1: any, a2: any): null {
  return null;
}

export function __nothing3(a1: any, a2: any, a3: any): null {
  return null;
}

export function __nothing4(a1: any, a2: any, a3: any, a4: any): null {
  return null;
}

export function __nothing5(a1: any, a2: any, a3: any, a4: any, a5: any): null {
  return null;
}
```

* A helper's body only returns `null`. The call has already evaluated its
  arguments, left to right (spec [§5.18](#evaluation-order)), which is all the evaluation
  `nothing(...)` asks for, and the values are discarded.
* Every parameter is `any`, so that one helper takes arguments of every type: a
  BlueScript function takes neither rest parameters nor type parameters. (The
  `<any>` of `new Array<any>(...)` is BlueScript's built-in array constructor,
  not a type parameter of a function, spec [§13.3](#array-operation-code-generation).)

### 14.2 Where It Appears <a id="nothing-where-it-appears"></a>

`nothing(...)` appears wherever [§12.4](#expression-projection) preserves the operands of an operation
this endpoint does not perform — in a statement, in a call argument, in a
`return` value, or in a `for` header slot.

It is never added for a call that the endpoint does make: the projected callee
already returns `null` there, so the call stands on its own (spec [§12.4](#expression-projection)). Such a
call appears inside `nothing(...)` only as an operand of an operation this
endpoint does not perform, as in `nothing(relay(null))` for `-relay(x)`.

### 14.3 `__and` and `__or` <a id="and-or-helpers"></a>

`__and(a, b)` and `__or(a, b)` are the runtime helpers that code generation
emits for `&&` and `||` (spec [§13.4](#logical-operator-code-generation)). Each takes two `boolean` arguments and
returns a `boolean`. They follow the `nothing` helpers in the runtime file:

```ts
export function __and(a: boolean, b: boolean): boolean {
  return a && b;
}

export function __or(a: boolean, b: boolean): boolean {
  return a || b;
}
```

Unlike `nothing(...)`, they are ordinary calls. Their arguments are evaluated
left to right, both before the helper runs, as for any call
(spec [§5.18](#evaluation-order)); the helper itself only combines the two values, and has no
effect of its own. They produce a value that the program uses, so cleanup
never touches them (spec [§13.15](#projected-ast-cleanup)).

BlueScript's own `&&` and `||` in their bodies are harmless: both operands are
evaluated by then, so the short circuit has nothing left to skip.

### 14.4 `__copyArray` <a id="copy-array-helper"></a>

`__copyArray(v)` returns a fresh array that holds the elements of `v`, in order:
the copy a transfer makes of an array (spec [§11.4](#local-copy), [§13.14](#communication-api)). It follows
`__and` and `__or` in the runtime file, the last of the core helpers:

```ts
export function __copyArray(v: any[]): any[] {
  return new Array<any>(v);
}
```

* Given an array, `new Array<any>(v)` is BlueScript's copying constructor: it
  makes a new `any[]` of the same length and fills it with the elements of `v`.
  It is not the array literal form `new Array<any>([e1, …])` of
  spec [§13.3](#array-operation-code-generation), whose argument is written out.
* The copy is shallow, and that is all a copy needs: no array has arrays as its
  elements (spec [§16.30](#nested-array)), and every other element is a value that is
  copied with its slot.
* BlueScript has no copy of its own, which is why the compiler writes one. The
  behaviour of `new Array<any>(v)` it relies on has not yet been verified
  (spec [§17.8](#unverified-bluescript-assumptions)).
* It is an ordinary call, which cleanup never touches (spec [§13.15](#projected-ast-cleanup)). A
  program imports it only when it copies an array.

### 14.5 Dynamic Location Runtime <a id="dyn-runtime"></a>

The dynamic-location runtime represents dynamically located values and performs
the dynamic operations (spec [§7.9](#dynamic-operations)). The compiler writes it into
each endpoint's `__runtime.bs`, after the core helpers, for a program that uses
`dyn`. What holds for the whole file — what differs between
endpoints, what is exported, and why every name begins with `__` — is stated
with the file (spec [§2.3](#output-files)).

* It opens with the location and kind constants: `dyn`, `every` and then the
  endpoints, in the order `choreobs.json` lists them, and the payload kinds
  ([§14.6](#location-and-kind-codes)). Its one endpoint-specific part is the
  constant `__here` ([§14.10](#location-functions)).
* It calls the communication API and `print`, which come from BlueScript's
  standard library like everywhere else (spec [§13.14](#communication-api), [§7.18](#print-typing)), and the copy
  helper `__copyArray`, which is defined before it in the same file
  ([§14.4](#copy-array-helper)). The core helpers call none of the communication API.
* It applies BlueScript's operators, `[]`, `.length` and `.push` to payloads
  typed `any`. BlueScript carries each out for the type of the value the `any`
  holds — an array payload is an `any[]` (spec [§13.3](#array-operation-code-generation)) — with the results and
  limits of spec [§7.1.1](#array-types).

The following sections give its content, in the order it appears in the file,
for a program whose endpoints are `alice` and `bob`, as it is written for
`alice`.
The runtime assumes some BlueScript behaviour that has not yet been verified;
spec [§17.8](#unverified-bluescript-assumptions) lists it.

### 14.6 Location and Kind Codes <a id="location-and-kind-codes"></a>

The runtime represents a location, and a payload kind, by an integer code. The
dynamic-location runtime opens with a constant for each, and with
`__locationName`:

```ts
export const __loc_dyn: integer = 0;
export const __loc_every: integer = 1;
export const __loc_alice: integer = 2;
export const __loc_bob: integer = 3;

export const __kind_integer: integer = 0;
export const __kind_float: integer = 1;
export const __kind_boolean: integer = 2;
export const __kind_string: integer = 3;
export const __kind_null: integer = 4;
export const __kind_array: integer = 5;

function __locationName(loc: integer): string {
  if (loc === __loc_dyn) {
    return "dyn";
  } else if (loc === __loc_every) {
    return "every";
  } else if (loc === __loc_alice) {
    return "alice";
  } else if (loc === __loc_bob) {
    return "bob";
  }
  return "";
}
```

* `__loc_dyn` is 0. As the destination of a dynamic transfer it is `dyn`
  (spec [§11.5](#dynamic-transfer)). Held by a location variable, it marks the
  variable unbound: where its class is located is still to be decided at run
  time ([§14.7](#location-variables)).
* `__loc_every` is 1, and the endpoints follow from 2, in the order
  `choreobs.json` lists them (spec [§2.2](#choreobs-json)). The constant for
  endpoint `p` is `__loc_p`, with the name as written. No endpoint is named
  `every` or `dyn` (spec [§16.2](#using-every-as-an-endpoint)), so no two locations
  share a constant.
* The kinds are numbered in the order the communication API lists its payload
  kinds (spec [§13.14](#communication-api)). The constant for kind `k` is `__kind_k`.

Generated code never writes a code. It names a location or a kind through its
constant, and imports the constants it uses (spec [§13.10](#runtime-import)), so an
endpoint's program does not depend on the order of the endpoints; only the
runtime file does. Codes never travel in a message. They only have to agree
between the files of one compilation, and they do, since every file is
generated from the same list of endpoints (spec [§2.3](#output-files)).

`__locationName` turns a location's code back into its name, for the
communication API, which addresses an endpoint by name ([§14.14](#dyn-transfer-runtime)),
and for the message of a location error ([§14.8](#location-errors)). Its last
`return` is never reached: BlueScript requires every path of a function with a
result to end in one.

Locations and kinds are integers rather than strings for two reasons:

* The runtime compares locations in every dynamic operation. Comparing two
  integers is one machine comparison. BlueScript, by contrast, compiles a
  string literal to a call of `gc_new_string`, which allocates an object each
  time the literal is evaluated, and compares strings character by character.
* A top-level constant of a primitive type is a plain C global, which the
  garbage collector does not trace. One of a pointer type is kept alive only
  by its module's root set, and BlueScript has unlinked the root set of an
  imported module once the module's initializer returned, so that the value was
  collected while still in use. BlueScript has since been fixed
  (spec [§17.8](#unverified-bluescript-assumptions)), but every top-level constant of the file is still an `integer`, and the
  rest are functions and classes (spec [§2.3](#output-files)): the runtime then works on a
  BlueScript with the fault as well.

### 14.7 Location Variables <a id="location-variables"></a>

A location variable is an object on the heap, and equality constraints between
location variables are kept by union-find. There is no global constraint store,
and a location variable has no identifier of its own: one that is no longer
reachable is collected by the garbage collector like any other object. `bound`
holds a location's code, and an unbound class is marked with `__loc_dyn`
([§14.6](#location-and-kind-codes)).

```ts
export class __LocVar {
  parent: __LocVar;
  bound: integer;
  rank: integer;

  constructor(bound: integer) {
    this.parent = this;
    this.bound = bound;
    this.rank = 0;
  }
}

function __root(v: __LocVar): __LocVar {
  let r: __LocVar = v;
  while (r.parent !== r) {
    r = r.parent;
  }
  return r;
}

export function __find(v: __LocVar): integer {
  return __root(v).bound;
}

export function __unify(a: __LocVar, b: __LocVar): integer {
  const ra = __root(a);
  const rb = __root(b);
  if (ra === rb) {
    return ra.bound;
  }
  if (ra.bound !== __loc_dyn && rb.bound !== __loc_dyn) {
    if (ra.bound !== rb.bound) {
      __locationError(ra.bound, rb.bound);
    }
    return ra.bound;
  }
  let top: __LocVar = ra;
  let sub: __LocVar = rb;
  if (rb.bound !== __loc_dyn || (ra.bound === __loc_dyn && rb.rank > ra.rank)) {
    top = rb;
    sub = ra;
  }
  sub.parent = top;
  if (sub.rank === top.rank) {
    top.rank = top.rank + 1;
  }
  return top.bound;
}

export function __bind(v: __LocVar, loc: integer): void {
  const r = __root(v);
  if (r.bound === __loc_dyn) {
    r.bound = loc;
  } else if (r.bound !== loc) {
    __locationError(r.bound, loc);
  }
}
```

* A representative is its own `parent`. `bound` means something only at a
  representative. `__root` may also compress paths (spec [§17.6](#future-work)).
* `__find(v)` is the code of the location `v`'s class is bound to, or
  `__loc_dyn` when it is unbound.
* `__unify(a, b)` places the classes of `a` and `b` at one location, and returns
  it (`__loc_dyn` when still unbound):
  * both unbound: the two classes become one;
  * one bound: the unbound one is bound to the same location;
  * both bound to the same concrete location: nothing happens;
  * both bound to different concrete locations: a location error.
* `__bind(v, loc)` binds `v`'s class to `loc` if it is unbound, and is a location
  error if it is bound elsewhere.

The representative is chosen with care. A bound representative is never replaced.
When both classes are unbound, the one of higher rank is kept, and the left one on
a tie: the result of an operator shares its left operand's location variable
(spec [§14.12](#dyn-operators)), so the longer-lived side stays representative. Otherwise
repeating `x = x + 1@dyn` or `x = 1@dyn + x` would lengthen the chain to the
representative each time, and a live alias could keep the whole chain reachable.

### 14.8 Location Errors <a id="location-errors"></a>

```ts
export function __locationError(a: integer, b: integer): void {
  const message = "location error: " + __locationName(a) + " and " + __locationName(b);
  code`runtime_error(gc_string_to_cstr(${message}));`;
}
```

A location error (spec [§7.9](#dynamic-operations)) stops the endpoint that detects it, at that
operation; the function never returns. Every endpoint adds the same constraints in
the same order, so every endpoint stops at the same operation, and no
coordination is needed.

`a` and `b` are the codes of the two concrete locations that clashed: for
`__unify`, the locations of its left and right classes; for `__bind`, the
location the class is already bound to and the one it was asked to take
(spec [§14.7](#location-variables)). The message names them through `__locationName`
([§14.6](#location-and-kind-codes)).

The endpoint stops through `runtime_error`, a C function of BlueScript's runtime,
embedded with BlueScript's `code` template. It ends the program and reports, for
example when a value at `every` is cast to `alice`,

```text
** runtime error: location error: every and alice
```

### 14.9 `__DynVal` <a id="dyn-val"></a>

```ts
export class __DynVal {
  payload: any;
  loc: __LocVar;

  constructor(payload: any, loc: __LocVar) {
    this.payload = payload;
    this.loc = loc;
  }
}

export function __dynUnbound(payload: any): __DynVal {
  return new __DynVal(payload, new __LocVar(__loc_dyn));
}

export function __dynAt(payload: any, loc: integer): __DynVal {
  return new __DynVal(payload, new __LocVar(loc));
}
```

* A location variable belongs to a dynamically located value, not to a
  variable. Assigning to a variable replaces the value it refers to
  (spec [§7.10](#assignment-typing)).
* An alias made with `=` shares the one `__DynVal`, and so its location variable.
* The payload is a BlueScript `any`. One `__DynVal`, rather than one class and
  one set of operations per base type, keeps the runtime small, and a BlueScript
  class cannot take a type parameter. An operation that needs the static type — a transfer or a
  copy — is given its kind by the compiler (spec [§14.14](#dyn-transfer-runtime)).
* A payload that does not exist is `null`.

### 14.10 Location Functions <a id="location-functions"></a>

```ts
export const __here: integer = __loc_alice;

export function __isHere(loc: integer): boolean {
  return loc === __here;
}

export function __isEvery(loc: integer): boolean {
  return loc === __loc_every;
}

export function __holdsPayload(loc: integer): boolean {
  return loc === __loc_dyn || loc === __loc_every || loc === __here;
}
```

`__here` is the one definition that differs between endpoints: it is the code
of the endpoint the file is for (`__loc_alice` above). `__holdsPayload(loc)` says
whether this endpoint uses the payload of a value whose class is at `loc`, as
returned by `__find` or `__unify` (spec [§3.5](#dyn)); `__loc_dyn` there means the
class is unbound. Every dynamic operation calls it, so it compares the codes
itself rather than through `__isEvery` and `__isHere`.

Locations are compared as integer codes ([§14.6](#location-and-kind-codes)).

### 14.11 `__inject` and `__cast` <a id="inject-and-cast"></a>

```ts
export function __inject(payload: any, loc: integer): __DynVal {
  return __dynAt(payload, loc);
}

export function __cast(v: __DynVal, loc: integer): any {
  __bind(v.loc, loc);
  if (__isHere(loc) || __isEvery(loc)) {
    return v.payload;
  } else {
    return null;
  }
}
```

* `__inject` makes a statically located value dynamically located
  (spec [§7.8](#coercion)). It does not copy the payload: it makes a new `__DynVal` around
  it, with a fresh location variable bound to `loc`. An array payload keeps its
  identity.
* `__cast` makes a dynamically located value statically located. It binds the
  location variable to `loc` before unwrapping the payload, so it binds an
  unbound value as well as checking a bound one. An endpoint that does not own
  the value at `loc` gets `null`, even when it holds a copy of the payload.

### 14.12 Dynamic Operators <a id="dyn-operators"></a>

Every binary operator has a runtime function of this form — `__dynPlus` for `+`:

```ts
export function __dynPlus(left: __DynVal, right: __DynVal): __DynVal {
  const loc = __unify(left.loc, right.loc);
  if (__holdsPayload(loc)) {
    return new __DynVal(left.payload + right.payload, left.loc);
  } else {
    return new __DynVal(null, left.loc);
  }
}
```

The others differ only in the operator applied to the two payloads:

| Operator | Runtime function |
|---|---|
| `+ - * / %` | `__dynPlus`, `__dynSub`, `__dynMul`, `__dynDiv`, `__dynMod` |
| `&& \|\|` | `__dynAnd`, `__dynOr` |
| `< <= > >=` | `__dynLt`, `__dynLe`, `__dynGt`, `__dynGe` |
| `=== !==` | `__dynEq`, `__dynNeq` |

* The result shares the left operand's location variable. After `__unify` both
  operands are at one location — in one class, or both already bound there —
  so the result's location is theirs.
* The two payloads always have the same representation, since the operands have
  the same base type (spec [§7.14](#operators)).
* The operator is BlueScript's operator on two `any`s, so its result has the
  limits of spec [§7.1.1](#array-types), and `===` and `!==` compare `float`s as held there.
* `__dynAnd` and `__dynOr` receive both operands already evaluated, so the
  short-circuit of BlueScript's `&&` and `||` inside them changes nothing.

The unary operators have one operand, whose class they only look up:

```ts
export function __dynNot(v: __DynVal): __DynVal {
  const loc = __find(v.loc);
  if (__holdsPayload(loc)) {
    return new __DynVal(!v.payload, v.loc);
  } else {
    return new __DynVal(null, v.loc);
  }
}
```

`__dynNeg` is the same with `-v.payload`.

### 14.13 Dynamic Numeric Conversion <a id="dyn-numeric-conversion"></a>

```ts
export function __dynIntegerToFloat(v: __DynVal): __DynVal {
  const loc = __find(v.loc);
  if (__holdsPayload(loc)) {
    return new __DynVal((v.payload as integer) as float, v.loc);
  } else {
    return new __DynVal(null, v.loc);
  }
}

export function __dynFloatToInteger(v: __DynVal): __DynVal {
  const loc = __find(v.loc);
  if (__holdsPayload(loc)) {
    return new __DynVal((v.payload as float) as integer, v.loc);
  } else {
    return new __DynVal(null, v.loc);
  }
}
```

* The payload is an `any`, so it is first brought back to its static type and
  then converted with BlueScript's own `as`, as a static conversion is
  (spec [§13.5](#numeric-conversion-code-generation)): `as integer` on an `any` accepts only an integer.
* The result shares the operand's location variable: a conversion changes the
  representation, not the location (spec [§7.15](#numeric-conversion)).
* An endpoint that does not hold the payload does not convert, so `null as float`
  is never evaluated.

A same-type conversion of a `dyn` value has no runtime function; nothing is
generated for it (spec [§12.2](#dyn-lowering)).

### 14.14 Dynamic Transfer Runtime <a id="dyn-transfer-runtime"></a>

A dynamic transfer (spec [§11.5](#dynamic-transfer)) is performed by `__dynTransfer`, with four
helpers that dispatch on the kind constant the compiler passes
([§14.6](#location-and-kind-codes)): `__copyPayload` copies an array and leaves any
other payload as it is, and `__sendAny`, `__receiveAny` and `__broadcastAny`
choose the communication API (the last is described after the code). The
communication API addresses an endpoint by name, so `__sendAny` and
`__receiveAny` take the peer's name:

```ts
function __copyPayload(kind: integer, v: any): any {
  if (kind === __kind_array) {
    return __copyArray(v);
  } else {
    return v;
  }
}

function __sendAny(to: string, tag: string, kind: integer, v: any): void {
  if (kind === __kind_integer) {
    sendInteger(to, tag, v);
  } else if (kind === __kind_float) {
    sendFloat(to, tag, v);
  } else if (kind === __kind_boolean) {
    sendBoolean(to, tag, v);
  } else if (kind === __kind_string) {
    sendString(to, tag, v);
  } else if (kind === __kind_null) {
    sendNull(to, tag, v);
  } else if (kind === __kind_array) {
    sendArray(to, tag, v);
  }
}

function __receiveAny(from: string, tag: string, kind: integer): any {
  if (kind === __kind_integer) {
    return receiveInteger(from, tag);
  } else if (kind === __kind_float) {
    return receiveFloat(from, tag);
  } else if (kind === __kind_boolean) {
    return receiveBoolean(from, tag);
  } else if (kind === __kind_string) {
    return receiveString(from, tag);
  } else if (kind === __kind_null) {
    return receiveNull(from, tag);
  } else if (kind === __kind_array) {
    return receiveArray(from, tag);
  }
  return null;
}
```

`__broadcastAny(tag, kind, v)` dispatches to `broadcastInteger(tag, v)` and the
other broadcast functions in the same way. Every kind is named: as in the
communication API itself (spec [§13.14](#communication-api)), there is no default.

`__dynTransfer` works in two steps. First, the endpoint that holds the source,
if the destination is not itself, communicates: it broadcasts when every
endpoint is to hold the result — the destination is `dyn` or `every` — and
sends to the destination otherwise. Then every endpoint makes its one fresh
result: `null` where the destination does not hold a payload, a copy where
this endpoint holds the source's payload, and the payload received from the
source otherwise. `__dynAt(x, __loc_dyn)` is an unbound value
([§14.9](#dyn-val)), so `dyn` needs no case of its own. It turns a location's code
into a name with `__locationName` only on the paths that send or receive,
where a static transfer would name the peer too (spec [§14.6](#location-and-kind-codes)).

```ts
export function __dynTransfer(tag: string, kind: integer, to: integer, v: __DynVal): __DynVal {
  const from = __find(v.loc);
  if (__isHere(from) && !__isHere(to)) {
    if (__holdsPayload(to)) {
      __broadcastAny(tag, kind, v.payload);
    } else {
      __sendAny(__locationName(to), tag, kind, v.payload);
    }
  }
  if (!__holdsPayload(to)) {
    return __dynAt(null, to);
  } else if (__holdsPayload(from)) {
    return __dynAt(__copyPayload(kind, v.payload), to);
  } else {
    return __dynAt(__receiveAny(__locationName(from), tag, kind), to);
  }
}
```

The cases, at the endpoint running it:

| Source (`from`) | Destination (`to`) | Result |
|---|---|---|
| unbound or `every` | `dyn` | a fresh unbound copy; no communication |
| unbound or `every` | `every`, or this endpoint | a fresh copy, bound to `to` |
| unbound or `every` | another endpoint | `null`, bound to `to` |
| this endpoint | `dyn` | broadcast; a fresh unbound copy |
| this endpoint | `every` | broadcast; a fresh copy bound to `every` |
| this endpoint | this endpoint | a fresh copy, bound here |
| this endpoint | another endpoint `q` | send to `q`; `null`, bound to `q` |
| another endpoint | `dyn` | the payload received from `from`; unbound |
| another endpoint | `every`, or this endpoint | the payload received from `from`; bound to `to` |
| another endpoint | any endpoint but this one: the source's own, or a third | `null`, bound to `to` |

Every case creates exactly one fresh location variable, and none changes the
source's. A copy is always fresh, so an array result never shares identity with
its source (spec [§11.4](#local-copy)).

### 14.15 Dynamic Array Operations <a id="dyn-array-operations"></a>

```ts
export function __dynArrayGet(arr: __DynVal, i: __DynVal): __DynVal {
  const loc = __unify(arr.loc, i.loc);
  if (__holdsPayload(loc)) {
    return new __DynVal(arr.payload[i.payload], arr.loc);
  } else {
    return new __DynVal(null, arr.loc);
  }
}

export function __dynArraySet(arr: __DynVal, i: __DynVal, v: __DynVal): void {
  __unify(arr.loc, i.loc);
  const loc = __unify(i.loc, v.loc);
  if (__holdsPayload(loc)) {
    arr.payload[i.payload] = v.payload;
  }
}

export function __dynArrayPush(arr: __DynVal, v: __DynVal): void {
  const loc = __unify(arr.loc, v.loc);
  if (__holdsPayload(loc)) {
    arr.payload.push(v.payload);
  }
}

export function __dynArrayLength(arr: __DynVal): __DynVal {
  const loc = __find(arr.loc);
  if (__holdsPayload(loc)) {
    return new __DynVal(arr.payload.length, arr.loc);
  } else {
    return new __DynVal(null, arr.loc);
  }
}
```

* `__dynArraySet` takes the array, the index and the value in the order the
  assignment evaluates them (spec [§5.18](#evaluation-order)).
* The result of `__dynArrayLength` shares the array's location variable, as the
  static `xs.length : integer@L` is at the array's location (spec [§7.16](#array-typing)).

The array literal functions (spec [§12.2](#dyn-lowering)):

```ts
export function __dynArrayNew(): __DynVal {
  return __dynUnbound(new Array<any>([]));
}

export function __dynArrayAppend(arr: __DynVal, v: __DynVal): __DynVal {
  __dynArrayPush(arr, v);
  return arr;
}
```

`__dynArrayNew` builds its empty array the way generated code builds a static one
(spec [§13.3](#array-operation-code-generation)), so that a payload array is an `any[]` like every other array, and
`__dynArrayPush` can append to it.

An array's payload stays consistent across endpoints as follows:

1. while unbound, every endpoint makes the same changes, so every copy has the
   same contents;
2. once bound to an individual location, only the owner goes on changing it, and
   the others' copies stay as they were;
3. those stale copies are never read: a runtime function checks the location
   before it touches a payload whenever the array is bound (spec [§3.5](#dyn)).

### 14.16 Dynamic Print <a id="dyn-print"></a>

```ts
export function __dynPrint(v: __DynVal): void {
  const loc = __find(v.loc);
  if (__holdsPayload(loc)) {
    print(v.payload);
  }
}
```

* `__dynPrint` stands for `print(v)` with `v` at `dyn` (spec [§7.18](#print-typing)). It prints at the
  endpoints that hold the payload: the owner once `v` is bound to an individual
  location, and every endpoint while it is bound to `every` or unbound
  (spec [§3.5](#dyn)).
* It looks the location up with `__find` and never binds it, as
  `__dynArrayLength` does (spec [§14.15](#dyn-array-operations)): printing a value adds no constraint.
* `print` is BlueScript's own, from its standard library like the communication
  API (spec [§14](#runtime-support-functions)).

## 15. Examples <a id="examples"></a>

### 15.1 Direct Communication <a id="example-direct-communication"></a>

Input:

```ts
let x: integer@alice = 42@alice;
let y: integer@bob <- x;
```

EPP at `alice`:

```ts
let x: integer = 42;
sendInteger("bob", "__top_0", x);
```

EPP at `bob`:

```ts
let y: integer = receiveInteger("alice", "__top_0");
```

***

### 15.2 Broadcast <a id="example-broadcast"></a>

Input:

```ts
let localOk: boolean@alice = true@alice;
let ok: boolean@every <- localOk;

if (ok) {
    let msg: string@bob = "ok"@bob;
} else {
    let msg: string@bob = "ng"@bob;
}
```

EPP at `alice` before cleanup:

```ts
let localOk: boolean = true;
broadcastBoolean("__top_0", localOk);
let ok: boolean = localOk;
if (ok) {
  null;
} else {
  null;
}
```

Each branch declares a variable at `bob`, so `alice` keeps only the
initializer's evaluation (spec [§12.9](#let-projection)). That is a single
expression, and a single discarded expression takes no `nothing(...)` wrapper
(spec [§12.4](#expression-projection)); the literal projects to `absent`, which
finalization turns into `null` (spec [§13.13](#absent-finalization)).

EPP at `alice` after cleanup:

```ts
let localOk: boolean = true;
broadcastBoolean("__top_0", localOk);
let ok: boolean = localOk;
if (ok) {
} else {
}
```

EPP at `bob`:

```ts
let ok: boolean = receiveBoolean("alice", "__top_0");
if (ok) {
  let msg: string = "ok";
} else {
  let msg: string = "ng";
}
```

Note: ChoreoBS v1 cleanup does not remove empty `if` statements. Removing empty `if` statements is a future optimization.

***

### 15.3 Local Function <a id="example-local-function"></a>

Input:

```ts
function add@alice(a: integer@alice, b: integer@alice): integer@alice {
    return a + b;
}

let x: integer@alice = add(1@alice, 2@alice);
```

EPP at `alice`:

```ts
function add(a: integer, b: integer): integer {
  return a + b;
}
let x: integer = add(1, 2);
```

EPP at `bob`:

```ts
// removed
```

***

### 15.4 Choreography Function <a id="example-choreography-function"></a>

Input:

```ts
function choose(c: boolean@every): integer@alice {
    if (c) {
        return 1@alice;
    } else {
        return 0@alice;
    }
}

let c: boolean@every = true@every;
let x: integer@alice = choose(c);
```

EPP at `alice`:

```ts
function choose(c: boolean): integer {
  if (c) {
    return 1;
  } else {
    return 0;
  }
}
let c: boolean = true;
let x: integer = choose(c);
```

EPP at `bob`:

```ts
function choose(c: boolean): null {
  if (c) {
    return null;
  } else {
    return null;
  }
}
let c: boolean = true;
choose(c);
```

Note the asymmetry with [§15.3](#example-local-function). There, `add` is a local function at `alice`, so
`bob` does not generate it and the whole statement goes. Here `choose` is a
choreography function, so `bob` generates it and must run it; only the result is
discarded (spec [§12.4](#expression-projection)). Were the call dropped, any communication inside
`choose` would be performed by `alice` alone.

***

### 15.5 While with Transfer <a id="example-while-with-transfer"></a>

Input:

```ts
let cont: boolean@every = true@every;

while (cont) {
    let x: integer@alice = 1@alice;
    let y: integer@bob <- x;

    let nextLocal: boolean@bob = false@bob;
    cont <- nextLocal;
}
```

EPP at `alice`:

```ts
let cont: boolean = true;
while (cont) {
  let x: integer = 1;
  sendInteger("bob", "__top_0", x);
  cont = receiveBoolean("bob", "__top_1");
}
```

EPP at `bob`:

```ts
let cont: boolean = true;
while (cont) {
  let y: integer = receiveInteger("alice", "__top_0");
  let nextLocal: boolean = false;
  broadcastBoolean("__top_1", nextLocal);
  cont = nextLocal;
}
```

***

### 15.6 For Loop <a id="example-for-loop"></a>

Input:

```ts
for (
    let i = 0@every;
    i < 3@every;
    i = i + 1@every
) {
    let x: integer@alice <- i;
    let y: integer@bob <- x;
}
```

EPP at `alice`:

```ts
for (let i: integer = 0; i < 3; i = i + 1) {
  let x: integer = i;
  sendInteger("bob", "__top_0", x);
}
```

EPP at `bob`:

```ts
for (let i: integer = 0; i < 3; i = i + 1) {
  let y: integer = receiveInteger("alice", "__top_0");
}
```

***

### 15.7 Cleanup of `nothing(...)` <a id="example-cleanup-of-nothing"></a>

Input after EPP:

```ts
nothing(null);
```

After expression simplification:

```ts
null;
```

After statement cleanup:

```ts
// removed
```

***

Input after EPP:

```ts
nothing(nothing(null), null, null);
```

After recursive expression simplification:

```ts
nothing(null, null, null);
```

Then:

```ts
null;
```

After statement cleanup:

```ts
// removed
```

***

Input after EPP:

```ts
foo(nothing(null), null);
```

After expression simplification:

```ts
foo(null, null);
```

The function call itself is preserved.

***

Input after EPP:

```ts
foo(null, null);
```

After cleanup:

```ts
foo(null, null);
```

Ordinary function calls are not removed by the v1 cleanup pass, and neither are
runtime calls: `nothing(__cast(valDyn, __loc_alice));` stays as it is
(spec [§13.15.6](#what-this-cleanup-pass-must-not-remove)).

***

Input after EPP, at an endpoint that must still call `get3Mcu`:

```ts
nothing(get3Mcu(), null);
```

After cleanup:

```ts
nothing(get3Mcu(), null);
```

Unchanged — one argument is a call, so the rule of [§13.15.2](#expression-simplification) does not apply, and
its `null` argument is not dropped either.

***

Input after EPP, from a call to a local function this endpoint does not
generate (spec [§12.12](#function-projection)):

```ts
nothing();
```

After cleanup:

```text
nothing();  =>  null;  =>  removed
```

### 15.8 Return Type Inference <a id="example-return-type-inference"></a>

Input:

```ts
function f@alice(c: boolean@alice) {
    if (c) {
        return 1.0@alice;
    } else {
        return 2.5@alice;
    }
}
```

The inferred return type is `float@alice`. Writing `1@alice` in the first
branch would make the function invalid instead: `integer` and `float` have no
LUB (spec [§16.21](#incompatible-inferred-return-types)).

***

### 15.9 Mutable Arrays <a id="example-mutable-arrays"></a>

Input:

```ts
let xs: integer[]@alice = [1, 2, 3]@alice;
xs[1@alice] = 10@alice;
xs.push(20@alice);
let n: integer@alice = xs.length;
let ys: integer[]@bob <- xs;
```

EPP at `alice`:

```ts
let xs: any[] = new Array<any>([1, 2, 3]);
xs[1] = 10;
xs.push(20);
let n: integer = xs.length;
sendArray("bob", "__top_0", xs);
```

EPP at `bob`:

```ts
let ys: any[] = receiveArray("alice", "__top_0");
```

Input:

```ts
let xs: integer[]@every = [1, 2, 3]@every;
xs[0@every] = 10@every;
```

EPP at all endpoints:

```ts
let xs: any[] = new Array<any>([1, 2, 3]);
xs[0] = 10;
```

### 15.10 Omitted Locations <a id="example-omitted-locations"></a>

Every omitted location in this program is `dyn` (spec [§8.2](#omitted-locations)), except in `bar`, whose
return type takes its location from its `return`:

```ts
3;
let a = 32;
let b: integer <- 32@alice;
function foo(a: integer) {}
function boo(flag: boolean@every) {
    if (flag) { return 3@alice; }
    else { return 4@every; }
}
function bar(): integer {
    return 3@alice;
}
```

EPP at `alice`:

```ts
function foo(a: __DynVal): void {
}

function boo(flag: boolean): __DynVal {
  if (flag) {
    return __inject(3, __loc_alice);
  } else {
    return __inject(4, __loc_every);
  }
}

function bar(): integer {
  return 3;
}
__dynUnbound(3);
let a: __DynVal = __dynUnbound(32);
let b: __DynVal = __dynTransfer("__top_0", __kind_integer, __loc_dyn, __inject(32, __loc_alice));
```

EPP at `bob`:

```ts
function foo(a: __DynVal): void {
}

function boo(flag: boolean): __DynVal {
  if (flag) {
    return __inject(null, __loc_alice);
  } else {
    return __inject(4, __loc_every);
  }
}

function bar(): null {
  return null;
}
__dynUnbound(3);
let a: __DynVal = __dynUnbound(32);
let b: __DynVal = __dynTransfer("__top_0", __kind_integer, __loc_dyn, __inject(null, __loc_alice));
```

In strict mode (spec [§8.3](#strict-mode)) the program is rejected: `3` has no location.

### 15.11 Dynamic Transfer <a id="example-dynamic-transfer"></a>

Static and dynamic transfers share one tag counter (spec [§11.6](#communication-tags)):

```ts
let valDyn1: integer@dyn = 4@dyn;
let valDyn2: integer@dyn = 5@dyn;
let valAlice: integer@alice = 6@alice;
function f() { return 3; }
function g() { return 4; }
let valDyn3: integer@dyn <- valDyn1;
let valDyn4: integer@dyn <- valAlice;
let valBob1: integer@bob <- valDyn1;
let valBob2: integer@bob <- valAlice;    // static
valDyn2 <- valDyn1;
valDyn2 <- valAlice;
valBob1 <- valDyn1;
valBob1 <- valAlice;                     // static
let x: integer@dyn <- f() + g();
let fb: float@bob <- valDyn1 as float;
```

`f` and `g` return `integer@dyn`, since `3` and `4` are `@dyn`.

EPP at `alice`:

```ts
function f(): __DynVal {
  return __dynUnbound(3);
}

function g(): __DynVal {
  return __dynUnbound(4);
}
let valDyn1: __DynVal = __dynUnbound(4);
let valDyn2: __DynVal = __dynUnbound(5);
let valAlice: integer = 6;
let valDyn3: __DynVal = __dynTransfer("__top_0", __kind_integer, __loc_dyn, valDyn1);
let valDyn4: __DynVal = __dynTransfer("__top_1", __kind_integer, __loc_dyn, __inject(valAlice, __loc_alice));
__cast(__dynTransfer("__top_2", __kind_integer, __loc_bob, valDyn1), __loc_bob);
sendInteger("bob", "__top_3", valAlice);
valDyn2 = __dynTransfer("__top_4", __kind_integer, __loc_dyn, valDyn1);
valDyn2 = __dynTransfer("__top_5", __kind_integer, __loc_dyn, __inject(valAlice, __loc_alice));
__cast(__dynTransfer("__top_6", __kind_integer, __loc_bob, valDyn1), __loc_bob);
sendInteger("bob", "__top_7", valAlice);
let x: __DynVal = __dynTransfer("__top_8", __kind_integer, __loc_dyn, __dynPlus(f(), g()));
__cast(__dynTransfer("__top_9", __kind_float, __loc_bob, __dynIntegerToFloat(valDyn1)), __loc_bob);
```

EPP at `bob`:

```ts
function f(): __DynVal {
  return __dynUnbound(3);
}

function g(): __DynVal {
  return __dynUnbound(4);
}
let valDyn1: __DynVal = __dynUnbound(4);
let valDyn2: __DynVal = __dynUnbound(5);
let valDyn3: __DynVal = __dynTransfer("__top_0", __kind_integer, __loc_dyn, valDyn1);
let valDyn4: __DynVal = __dynTransfer("__top_1", __kind_integer, __loc_dyn, __inject(null, __loc_alice));
let valBob1: integer = __cast(__dynTransfer("__top_2", __kind_integer, __loc_bob, valDyn1), __loc_bob);
let valBob2: integer = receiveInteger("alice", "__top_3");
valDyn2 = __dynTransfer("__top_4", __kind_integer, __loc_dyn, valDyn1);
valDyn2 = __dynTransfer("__top_5", __kind_integer, __loc_dyn, __inject(null, __loc_alice));
valBob1 = __cast(__dynTransfer("__top_6", __kind_integer, __loc_bob, valDyn1), __loc_bob);
valBob1 = receiveInteger("alice", "__top_7");
let x: __DynVal = __dynTransfer("__top_8", __kind_integer, __loc_dyn, __dynPlus(f(), g()));
let fb: float = __cast(__dynTransfer("__top_9", __kind_float, __loc_bob, __dynIntegerToFloat(valDyn1)), __loc_bob);
```

`let fb: float@bob <- valDyn1;` would be rejected: the base types differ, `dyn`
or not (spec [§16.8](#invalid-transfer-base-type)).

### 15.12 Local Imports <a id="example-local-imports"></a>

BlueScript source files (spec [§2.5](#bluescript-source-files)), with the endpoints `alice` and `bob`:

```ts
// src/clock.bs — shared
let ticks: integer = 0;

export function now(): integer {
  ticks = ticks + 1;
  return ticks;
}
```

```ts
// src/sensor@alice.bs — alice's alone
export const threshold = 30;

export function readSensor(t: integer): float {
  return 20.5 + t;
}
```

Input (spec [§5.19](#import-declarations)):

```ts
import@alice { readSensor, threshold as limit } from "./sensor@alice";
import@alice { now as nowAtAlice } from "./clock";
import@bob { now as nowAtBob } from "./clock";

function hot@alice(x: float): boolean {
    return x > (limit as float);
}

let reading: float@alice = readSensor(nowAtAlice());
let alert: boolean@bob <- hot(reading);
let stamp: integer@bob = nowAtBob();
```

`readSensor` is `readSensor@alice(t: integer@alice): float@alice`, and `limit`
is an `integer@alice` constant (spec [§7.21](#imported-signatures)). `clock.bs` is imported at both
endpoints, under a name for each (spec [§6.8](#imported-names)).

EPP at `alice`:

```ts
import { readSensor, threshold as limit } from "./sensor@alice";
import { now as nowAtAlice } from "./clock";

function hot(x: float): boolean {
  return x > ((limit as integer) as float);
}
let reading: float = readSensor(nowAtAlice());
sendBoolean("bob", "__top_0", hot(reading));
```

EPP at `bob`:

```ts
import { now as nowAtBob } from "./clock";

let alert: boolean = receiveBoolean("alice", "__top_0");
let stamp: integer = nowAtBob();
```

`workspace/alice/src/` gets copies of `clock.bs` and `sensor@alice.bs`, and
`workspace/bob/src/` a copy of `clock.bs` (spec [§2.5](#bluescript-source-files)).

***

## 16. Compile-time Errors <a id="compile-time-errors"></a>

The following are compile-time errors. Some are errors only in strict mode
(spec [§8.3](#strict-mode)), where an omitted location is not `dyn`; each says so.

### 16.1 Unknown Endpoint <a id="unknown-endpoint"></a>

```ts
let x: integer@carol = 1@carol;
```

This is an error if `carol` is not listed in `choreobs.json`.

### 16.2 Using `every` or `dyn` as an Endpoint <a id="using-every-as-an-endpoint"></a>

```json
{
  "name": "example",
  "endpoints": [
    { "name": "alice", "board": "host" },
    { "name": "every", "board": "host" }
  ]
}
```

```json
{
  "name": "example",
  "endpoints": [
    { "name": "alice", "board": "host" },
    { "name": "dyn", "board": "host" }
  ]
}
```

These are errors: `every` and `dyn` are locations of their own, never listed as
endpoints (spec [§2.2](#choreobs-json)).

### 16.3 Location Annotation Omission <a id="location-annotation-omission"></a>

A type annotation or a literal without a location annotation, whose location
nothing infers (spec [§7.20](#type-inference)), is an error in strict mode (spec [§8.3](#strict-mode)). Otherwise
it is `dyn` (spec [§8.2](#omitted-locations)). Inside a local function this never arises: the
function's location is inferred there, in either mode (spec [§7.20.8](#local-function-location-inference)).

In strict mode:

```ts
let x: integer = 1;          // the initializer has no location either
function f(a: integer): void {}
```

Valid in strict mode too — `a` and the return type are at `alice`:

```ts
function f@alice(a: integer): integer {
    return a;
}
```

### 16.4 `dyn` in a Local Function <a id="dyn-in-a-local-function"></a>

`dyn` may not be written anywhere in a local function (spec [§8.4](#local-function-strict-location-rule)): not in a
parameter type, the return type, a variable type, a literal or an array literal.
A location left out there is not `dyn` but the function's location
(spec [§7.20.8](#local-function-location-inference)).

Disallowed:

```cbs
function bad@bob(a: integer@dyn): void {}

function bad@bob(): void {
    let x: integer@bob = 1@dyn;
}

function bad@bob(): void {
    [1]@dyn;
}
```

Nor may a local function use a top-level constant at `dyn` (spec [§6.6](#top-level-let)), however
it was declared:

```cbs
const n = 32;    // `integer@dyn` outside strict mode

function bad@bob(): integer@bob {
    return n;
}
```

A local function runs at one endpoint only, so its dynamic operations would not
be performed alike at every endpoint (spec [§3.5](#dyn)).

### 16.5 Uninitialized Let <a id="uninitialized-let"></a>

```ts
let x: integer@alice;
const y: integer@alice;
```

A `const` must be initialized as a `let` must (spec [§5.7](#const-statement)).

### 16.6 Type Mismatch <a id="type-mismatch"></a>

```ts
let x: integer@alice = "hello"@alice;
```

`integer` and `float` are unrelated (spec [§7.5](#subtyping)), so neither is accepted for
the other:

```ts
let x: float@alice = 1@alice;
let y: integer@alice = 1.5@alice;
```

Convert explicitly instead (spec [§7.15](#numeric-conversion)):

```ts
let x: float@alice = 1@alice as float;
let y: integer@alice = 1.5@alice as integer;
```

`dyn` does not relax a base type (spec [§7.5](#subtyping)):

```ts
let valAlice: integer@alice = 1@alice;
let f1: float@dyn = valAlice;
```

### 16.7 Invalid Assignment Across Locations <a id="invalid-assignment-across-locations"></a>

```ts
let x: integer@alice = 1@alice;
let y: integer@bob = x;
```

Use a transfer instead:

```ts
let y: integer@bob <- x;
```

The same applies between `@every` and an individual location, which are
independent ([§7.6](#location-matching-and-residency)):

```ts
let c: boolean@every = true@every;
let d: boolean@alice = c;
```

Use a transfer instead:

```ts
let d: boolean@alice <- c;
```

With `dyn` on either side the locations are consistent, and this is not an error:
the assignment is checked at run time instead (spec [§7.8](#coercion)).

### 16.8 Invalid Transfer Base Type <a id="invalid-transfer-base-type"></a>

For `a <- b` with `a : T1@p` and `b : T2@q`, the source base type must be a
subtype of the destination base type: `T2 <: T1` (spec [§7.11](#transfer-typing)).

Disallowed — `integer` and `float` are unrelated, in either direction:

```ts
let y: float@alice = 1.5@alice;
let x: integer@bob <- y;
```

```ts
let y: integer@alice = 1@alice;
let x: float@bob <- y;
```

Convert explicitly instead (spec [§7.15](#numeric-conversion)): here `alice` converts, then sends a
`float`:

```ts
let y: integer@alice = 1@alice;
let x: float@bob <- y as float;
```

Disallowed — any other pair of different base types:

```ts
let y: float@alice = 1.5@alice;
let x: string@bob <- y;
```

Disallowed — arrays are invariant, so the element types must match exactly:

```ts
let xs: integer[]@every = [1, 2]@every;
let ys: float[]@alice <- xs;
```

The rule is the same for a dynamic transfer:

```ts
let valDyn1: integer@dyn = 4@dyn;
let fb: float@bob <- valDyn1;
```

Note that the locations are unconstrained: a transfer whose source and
destination share a concrete location is valid and denotes a local copy
(spec [§11.4](#local-copy)), and a transfer with `dyn` on either side is a dynamic transfer
(spec [§11.5](#dynamic-transfer)).

### 16.9 Invalid If Condition <a id="invalid-if-condition"></a>

```ts
function f(c: boolean@alice): void {
    if (c) {
        return;
    }
}
```

A `boolean@dyn` condition is not an error in a choreography context: it is cast
to `every` (spec [§7.12](#if-condition-typing)). The same holds for `while` and `for`.

### 16.10 Invalid While Condition <a id="invalid-while-condition"></a>

```ts
function f(c: boolean@alice): void {
    while (c) {
        return;
    }
}
```

### 16.11 Invalid For Condition <a id="invalid-for-condition"></a>

```ts
function f(): void {
    for (
        let i: integer@alice = 0@alice;
        i < 10@alice;
        i = i + 1@alice
    ) {
    }
}
```

### 16.12 Calling Another Endpoint's Local Function <a id="calling-another-endpoints-local-function"></a>

```ts
function f@bob(): integer@bob {
    return 1@bob;
}

function g@alice(): integer@alice {
    return f();
}
```

### 16.13 Calling a Choreography Function from a Local Function <a id="calling-choreography-from-local"></a>

```ts
function f(): void {
    return;
}

function g@alice(): void {
    f();
}
```

### 16.14 Recursive Choreography Function <a id="recursive-choreography-function"></a>

Direct recursion:

```ts
function f(): void {
    f();
}
```

Mutual recursion is equally invalid:

```ts
function f(): void {
    g();
}

function g(): void {
    f();
}
```

### 16.15 Function Overloading <a id="function-overloading"></a>

```ts
function f@alice(): void {
    return;
}

function f@bob(): void {
    return;
}
```

### 16.16 Break and Continue <a id="err-break-and-continue"></a>

```ts
while (true@every) {
    break;
}
```

```ts
while (true@every) {
    continue;
}
```

### 16.17 Unsupported Equality Operators <a id="unsupported-equality-operators"></a>

```ts
x == y;
x != y;
```

Use:

```ts
x === y;
x !== y;
```

### 16.18 Transfer Let Without Type Annotation <a id="transfer-let-without-type-annotation"></a>

```ts
let y <- x;
const z <- x;
```

Transfer declarations, with `let` or `const`, require an explicit destination type. Its location may be
left out, making the destination `dyn` (spec [§7.20.3](#transfer-let-does-not-infer-destination-type)) — except in strict mode,
where that is an error too — or, inside a local function, the function's
location in either mode (spec [§7.20.8](#local-function-location-inference)). Its base type may not be left out.

### 16.19 Cannot Infer Function Return Type <a id="cannot-infer-function-return-type"></a>

A function return type cannot be inferred if value-returning paths are not proven to return.

```ts
function maybe@alice(c: boolean@alice) {
    if (c) {
        return 1@alice;
    }
}
```

### 16.20 Mixed Bare and Value Returns <a id="mixed-bare-and-value-returns"></a>

```ts
function bad@alice(c: boolean@alice) {
    if (c) {
        return 1@alice;
    }
    return;
}
```

### 16.21 Incompatible Inferred Return Types <a id="incompatible-inferred-return-types"></a>

```ts
function bad@alice(c: boolean@alice) {
    if (c) {
        return 1@alice;
    } else {
        return "one"@alice;
    }
}
```

`integer` and `float` have no LUB either (spec [§7.5](#subtyping)):

```ts
function bad@alice(c: boolean@alice) {
    if (c) {
        return 1@alice;
    } else {
        return 2.5@alice;
    }
}
```

Converting one of them makes the candidates agree (spec [§7.15](#numeric-conversion)):

```ts
function good@alice(c: boolean@alice) {
    if (c) {
        return 1@alice as float;
    } else {
        return 2.5@alice;
    }
}
```

### 16.22 Incompatible Inferred Return Locations <a id="incompatible-inferred-return-locations"></a>

In strict mode (spec [§8.3](#strict-mode)), returns at two different concrete locations have no
inferred location. Otherwise the return type is `dyn` (spec [§7.20.4](#function-return-type-inference)). The
same holds for a choreography function's return type written without its
location; a local function's is at the function's location and is not inferred
from the returns (spec [§7.20.8](#local-function-location-inference)).

```ts
function bad(c: boolean@every) {
    if (c) {
        return 1@alice;
    } else {
        return 1@bob;
    }
}
```

### 16.23 Recursive Function With Omitted Return Type <a id="recursive-function-with-omitted-return-type"></a>

```ts
function fact@alice(n: integer@alice) {
    if (n <= 1@alice) {
        return 1@alice;
    } else {
        return n * fact(n - 1@alice);
    }
}
```

### 16.24 Parameter Type Omission <a id="parameter-type-omission"></a>

```ts
function add@alice(a, b) {
    return a + b;
}
```

Parameter types are not inferred in ChoreoBS v1. Only the location of a parameter
type may be left out (spec [§7.20.7](#parameter-types-are-not-inferred)): it is then `dyn` in a choreography function,
and the function's location in a local one (spec [§7.20.8](#local-function-location-inference)).

***

### 16.25 Invalid Local Function Parameter Location <a id="invalid-local-function-parameter-location"></a>

A local function parameter must be located at the function's own individual location.

Disallowed:

```cbs
function bad@bob(a: integer@alice, b: integer@bob): integer@bob {
    return a;
}
```

Disallowed:

```cbs
function bad@bob(x: integer@every): integer@bob {
    return x;
}
```

Allowed:

```cbs
function add@bob(a: integer@bob, b: integer@bob): integer@bob {
    return a + b;
}
```

### 16.26 Invalid Local Function Return Location <a id="invalid-local-function-return-location"></a>

A local function return type must be located at the function's own individual location.

Disallowed:

```cbs
function bad@bob(): integer@alice {
    return 1@alice;
}
```

Disallowed:

```cbs
function bad@bob(): integer@every {
    return 1@every;
}
```

Allowed:

```cbs
function ok@bob(): integer@bob {
    return 1@bob;
}
```

### 16.27 Invalid Value Used Inside Local Function <a id="invalid-value-used-inside-local-function"></a>

Inside a local function declared at individual location `P`, every evaluated expression must be located at `P`.

Disallowed:

```cbs
function bad@bob(): integer@bob {
    let x: integer@alice = 1@alice;
    return x;
}
```

Disallowed:

```cbs
function bad@bob(): integer@bob {
    let x: integer@every = 1@every;
    return x;
}
```

The same applies to a variable the body declares, including the destination of a
transfer `let` (spec [§8.4](#local-function-strict-location-rule)):

```cbs
function bad@bob(x: integer@bob): integer@bob {
    let y: integer@alice <- x;
    return x;
}
```

The same applies to a top-level constant the body uses (spec [§6.6](#top-level-let)):

```cbs
const k: integer@every = 1@every;

function bad@bob(): integer@bob {
    return k;
}
```

Allowed:

```cbs
function ok@bob(): integer@bob {
    let x: integer@bob = 1@bob;
    return x;
}
```

### 16.28 Invalid Function Argument Location <a id="invalid-function-argument-location"></a>

A function argument must be compatible with the corresponding parameter type
using base type subtyping, and its location must be consistent with the
parameter's location (spec [§7.7](#location-consistency-and-join)). A `dyn` argument, or a `dyn` parameter, is
consistent with any location, and is checked at run time instead.

Disallowed:

```cbs
function add@alice(a: integer@alice): integer@alice {
    return a;
}

add(10@every);
```

This is invalid because `match(every, alice) = false`. `every` and `alice` are
independent locations. Pass a value already at `alice`:

```cbs
add(10@alice);
```

Disallowed:

```cbs
function add@alice(a: integer@alice): integer@alice {
    return a;
}

add(10@bob);
```

This is invalid because `match(bob, alice) = false`.

### 16.29 Unsupported Array Element Type <a id="unsupported-array-element-type"></a>

`string[]`, `null[]`, and `void[]` are not supported in the mutable array
extension. They parse — the grammar admits an array of any base type
(spec [§5.2](#types)) — and are rejected as a typing error (spec [§7.1.1](#array-types)).

Disallowed:

```ts
let xs: string[]@alice = []@alice;
let ys: null[]@alice = []@alice;
let zs: void[]@alice = []@alice;
```

### 16.30 Nested Array <a id="nested-array"></a>

Nested arrays are not supported. Unlike [§16.29](#unsupported-array-element-type), this one is ruled out by the
grammar: `ArrayType` takes a single `[` `]` (spec [§5.2](#types)), so it is reported as a
syntax error.

Disallowed:

```ts
let xs: integer[][]@alice = []@alice;
```

### 16.31 Array Literal Without Required Location <a id="array-literal-without-required-location"></a>

In strict mode (spec [§8.3](#strict-mode)), an array literal must carry its own location annotation
(spec [§5.17](#array-literals)), except in a local function, where it takes the function's location
(spec [§7.20.8](#local-function-location-inference)). Otherwise an array literal without one is `dyn`. The error is the missing annotation on the literal itself, whether or not
its elements carry one.

Disallowed, in strict mode:

```ts
let xs: integer[]@alice = [1, 2, 3];
```

Disallowed in strict mode for the same reason, although every element is located:

```ts
let a: integer@alice = 1@alice;
let b: integer@alice = 2@alice;
let xs = [a, b];
```

Use:

```ts
let xs: integer[]@alice = [1, 2, 3]@alice;
let ys = [a, b]@alice;
```

### 16.32 Array Literal Elements Across Locations <a id="array-literal-elements-across-locations"></a>

The elements of an array literal, and the literal itself, must be pairwise
consistent (spec [§7.7](#location-consistency-and-join)): at most one concrete location among them. `dyn` does
not bridge two concrete locations.

Disallowed:

```ts
let a: integer@alice = 1@alice;
let b: integer@bob = 2@bob;
let xs = [a, b]@dyn;
let ys = [1@alice, 2@bob];
```

### 16.33 Cannot Infer Empty Array Element Type <a id="cannot-infer-empty-array-element-type"></a>

An empty array literal cannot infer its element type. It is allowed only where
it is checked against an explicit array type, which supplies the element type
(spec [§7.16](#array-typing)); anywhere else it is an error.

Disallowed:

```ts
let xs = []@alice;

function f@alice() {        // the return type is omitted altogether
    return []@alice;
}

[]@alice;
let x: integer@alice = []@alice[0@alice];
print([]@alice);
```

Allowed:

```ts
let xs: integer[]@alice = []@alice;

function g@alice(): float[]@alice {
    return []@alice;
}

let fs: float[]@alice = [1.5]@alice;
fs = []@alice;
```

### 16.34 Array Type Invariance <a id="array-type-invariance"></a>

Array types are invariant (spec [§7.16](#array-typing)).

Disallowed:

```ts
let xs: integer[]@alice = [1, 2]@alice;
let ys: float[]@alice = xs;
```

An array literal is typed on its own and then checked by the same rule, so an annotation does not change its element type either.

Also disallowed:

```ts
let zs: float[]@alice = [1, 2]@alice;
```

### 16.35 Invalid `@every` Array Assignment to Individual Location <a id="err-every-array-assignment"></a>

A mutable array located at `@every` cannot be assigned to an individual-location
array variable. This is an instance of the general location rule ([§7.6](#location-matching-and-residency), [§16.7](#invalid-assignment-across-locations)),
not an array-specific restriction; use `<-` to localize.

Disallowed:

```ts
let xs: integer[]@every = [1, 2, 3]@every;
let ys: integer[]@alice = xs;
```

### 16.36 Invalid `@every` Array Argument to Individual Location Parameter <a id="err-every-array-argument"></a>

A mutable array located at `@every` cannot be passed to a function parameter
located at an individual location. This is an instance of the general location
rule ([§7.6](#location-matching-and-residency), [§16.28](#invalid-function-argument-location)), not an array-specific restriction; localize with `<-` first.

Disallowed:

```ts
function f@alice(xs: integer[]@alice): void {
    return;
}
let xs: integer[]@every = [1, 2, 3]@every;
f(xs);
```

### 16.37 Invalid Array Equality <a id="invalid-array-equality"></a>

The equality operators `===` and `!==` are not defined for array types.

Disallowed:

```ts
let xs: integer[]@alice = [1]@alice;
xs === xs;
```

### 16.38 Invalid Array Index Location <a id="invalid-array-index-location"></a>

The index expression's location must be consistent with the array's location
(spec [§7.7](#location-consistency-and-join)). A `dyn` index, or a `dyn` array, is accepted and checked at run time.

Disallowed:

```ts
let xs: integer[]@alice = [1]@alice;
let i: integer@bob = 0@bob;
let x: integer@alice = xs[i];
```

### 16.39 Element Assignment Across Locations <a id="element-assignment-across-locations"></a>

The array, the index and the value of an element assignment must be pairwise
consistent (spec [§7.7](#location-consistency-and-join)): at most one concrete location among them. With the
array at `dyn`, the index and the value are each consistent with it, but not
with each other.

Disallowed:

```ts
let arrDyn: integer[]@dyn = [1, 3, 4]@dyn;
let iAlice: integer@alice = 0@alice;
let valBob: integer@bob = 5@bob;
arrDyn[iAlice] = valBob;
```

### 16.40 Invalid `.push` Element Type <a id="invalid-push-element-type"></a>

The pushed value must be compatible with the array element type.

Disallowed:

```ts
let xs: integer[]@alice = []@alice;
xs.push(1.5@alice);
```

`integer` and `float` are unrelated (spec [§7.5](#subtyping)), so the reverse is rejected too:

```ts
let ys: float[]@alice = []@alice;
ys.push(1@alice);
```

Convert the value first (spec [§7.15](#numeric-conversion)):

```ts
let ys: float[]@alice = []@alice;
ys.push(1@alice as float);
```

### 16.41 `@every` on a Function Declaration <a id="every-on-a-function-declaration"></a>

A location on a function declaration names the one endpoint that runs the
function. It therefore declares a local function, and must be an individual
location (spec [§10.1](#function-kinds)).

A choreography function runs at every endpoint rather than at one, so no single
location names it and its declaration carries none. It is a separate kind of
declaration, not a local function with its location left out.

Disallowed:

```ts
function f@every(): void {
    return;
}
```

Write it as:

```ts
function f(): void {
    return;
}
```

### 16.42 `@dyn` on a Function Declaration <a id="dyn-on-a-function-declaration"></a>

A function location names the one endpoint that runs the function
(spec [§10.1](#function-kinds)); `dyn` names none. A function whose location should not be
fixed is a choreography function, which runs at every endpoint.

Disallowed:

```ts
function f@dyn(): void {
    return;
}
```

Write it as:

```ts
function f(): void {
    return;
}
```

### 16.43 Invalid Use of `void` <a id="invalid-use-of-void"></a>

`void` has no location and is not a value type (spec [§7.3](#void)).

A location on `void` is an error:

```ts
function g(): void@alice {
    return;
}
```

So is any use outside a function return type:

```ts
function g(): void { return; }

let x: void = g();          // variable type
let y = g();                // same error: inference does not create a way in
let zs = [g()]@alice;       // array literal element
```

```ts
function f(a: void): void { return; }   // parameter type
```

```ts
function g(): void { return; }

let y: void <- g();         // transfer destination
```

A `return` value is a value position like any other, so a `void` computation is
rejected there too — even inside a `void` function, where `return;` is the form
to write (spec [§5.13](#return-statement), [§7.19](#return-typing)):

```ts
function g@alice(): void { return; }

function h@alice(): void {
    return g();             // return value
}
```

`xs.push(v)` and `print(e)` are the other void computations (spec [§7.2](#located-types), [§7.16](#array-typing), [§7.18](#print-typing)),
and are rejected in the same positions for the same reason:

```ts
function f@alice(a: integer@alice): void { return; }

let xs: integer[]@alice = []@alice;

xs.push(1@alice);                        // valid — an expression statement
let n = xs.push(1@alice);                // produces no value
let m: integer@alice = xs.push(1@alice); // cannot assign void
f(xs.push(1@alice));                     // not assignable to the parameter
```

```ts
function g@alice(): void { return; }

let n = print(1@alice);                  // produces no value
print(g());                              // the argument produces no value
let b = print(1@alice) === print(2@alice);   // `===` needs values
```

`void[]` is rejected separately, as an unsupported array element type
(spec [§16.29](#unsupported-array-element-type)).

### 16.44 Missing Return in a Non-`void` Function <a id="missing-return-in-a-non-void-function"></a>

A function whose return type is not `void` must return a value on every path
(spec [§7.19](#return-typing), [§7.20.6](#return-coverage-for-non-void-functions)). This applies to a written return type just as it does to
an inferred one (spec [§16.19](#cannot-infer-function-return-type)).

```ts
function bad@alice(c: boolean@alice): integer@alice {
    if (c) {
        return 1@alice;
    }
}
```

Write it as:

```ts
function ok@alice(c: boolean@alice): integer@alice {
    if (c) {
        return 1@alice;
    } else {
        return 0@alice;
    }
}
```

The analysis is the conservative one of [§7.20.6](#return-coverage-for-non-void-functions), so a function whose totality
rests on a loop condition is rejected even when it does always return:

```ts
function alsoRejected@alice(): integer@alice {
    while (true@alice) {
        return 1@alice;
    }
}
```

### 16.45 Invalid Unary Operand <a id="invalid-unary-operand"></a>

`-` requires a numeric scalar and `!` requires a boolean scalar (spec [§7.14](#operators)).
Neither accepts an array.

```ts
let xs: boolean[]@alice = [true]@alice;
let b: boolean@alice = !xs;
```

```ts
let ys: integer[]@alice = [1]@alice;
let n: integer[]@alice = -ys;
```

```ts
let s: string@alice = "x"@alice;
let t: string@alice = -s;
```

### 16.46 Invalid Comparison or Equality Operands <a id="invalid-comparison-or-equality-operands"></a>

`<`, `<=`, `>` and `>=` require numeric operands (spec [§7.14](#operators)):

```ts
let b: boolean@alice = "a"@alice < "b"@alice;
```

```ts
let xs: integer[]@alice = [1]@alice;
let c: boolean@alice = xs < xs;
```

They also require operands of the same numeric type, so `integer` and `float`
are not compared with each other (spec [§7.5](#subtyping)):

```ts
let b: boolean@alice = 1@alice < 1.5@alice;
```

Convert one operand explicitly instead (spec [§7.15](#numeric-conversion)):

```ts
let b: boolean@alice = (1@alice as float) < 1.5@alice;
```

`===` and `!==` require operands of the same base type, which likewise rules
out comparing an `integer` with a `float`:

```ts
let b: boolean@alice = 1@alice === 1.0@alice;
```

They also require operands that produce a value, so a void computation
(spec [§7.2](#located-types)) is rejected on either side. Two of them have the same base type,
which is why this needs a rule of its own:

```ts
function g@alice(): void { return; }
let xs: integer[]@alice = [1]@alice;

let b: boolean@alice = g() === g();
let c: boolean@alice = xs.push(1@alice) === xs.push(2@alice);
```

For array operands see [§16.37](#invalid-array-equality).

### 16.47 Invalid Arithmetic or Logical Operand <a id="invalid-arithmetic-or-logical-operand"></a>

`+ - * / %` require numeric scalars, apart from `string + string`
(spec [§7.14](#operators)). An array is rejected even when its elements are numeric:

```ts
let xs: integer[]@alice = [1, 2]@alice;
let ys: integer[]@alice = xs + xs;
```

```ts
let s: string@alice = "a"@alice - "b"@alice;
```

Both operands must also have the same numeric type. `integer` and `float` are
unrelated (spec [§7.5](#subtyping)), so neither is promoted to the other:

```ts
let x = 1@alice + 1.5@alice;
```

Convert one operand explicitly instead (spec [§7.15](#numeric-conversion)):

```ts
let x = (1@alice as float) + 1.5@alice;
```

`&&` and `||` require boolean scalars:

```ts
let bs: boolean[]@alice = [true]@alice;
let b: boolean@alice = bs && bs;
```

```ts
let c: boolean@alice = 1@alice && true@alice;
```

### 16.48 Invalid Array Operation Syntax <a id="invalid-array-operation-syntax"></a>

These are **parse** errors, reported before type checking.

The receiver of `.length` and `.push` must be a variable (spec [§5.15](#expressions)), so a
receiver of any other shape is rejected:

```ts
xs[0@alice].push(1@alice);
(xs).push(1@alice);
let n: integer@alice = f().length;
let m: integer@alice = xs.length.length;
```

`length` and `push` are the only member names:

```ts
let n: integer@alice = xs.pop;
```

Write the operation with a variable receiver:

```ts
xs.push(1@alice);
let n: integer@alice = xs.length;
```

Using `xs.push(v)` where a value is expected is not a syntax error but a type
error, because its result is `void` (spec [§7.16](#array-typing), [§16.43](#invalid-use-of-void)).

### 16.49 Missing `for` Condition <a id="missing-for-condition"></a>

The condition of a `for` loop is required (spec [§5.12](#for-statement)).

```ts
for (let i = 0@every; ; i = i + 1@every) {
}
```

Use `while (true@every)` for an unbounded loop.

### 16.50 Invalid Endpoint Name <a id="invalid-endpoint-name"></a>

An endpoint name must be an identifier (spec [§4.3](#identifiers)), must not be a reserved word
(spec [§4.4](#keywords)), and must not begin with `__` (spec [§6.2](#function-names)). See [§2.2](#choreobs-json).

Disallowed:

```json
{
  "name": "example",
  "endpoints": [
    { "name": "alice", "board": "host" },
    { "name": "worker-1", "board": "host" }
  ]
}
```

```json
{
  "name": "example",
  "endpoints": [
    { "name": "alice", "board": "host" },
    { "name": "while", "board": "host" }
  ]
}
```

```json
{
  "name": "example",
  "endpoints": [
    { "name": "alice", "board": "host" },
    { "name": "__internal", "board": "host" }
  ]
}
```

A name that is not an identifier cannot be written after `@`, so it would name
an endpoint no program could refer to — and it would still name a directory in
the workspace (spec [§2.3](#output-files)), which `../x` would place outside it.

Allowed — the reserved runtime names (spec [§6.2](#function-names)) do not apply to endpoints,
which reach the generated code only as string literals, as the end of the
runtime's constant `__loc_<name>` (spec [§14.6](#location-and-kind-codes)), and as directory names:

```json
{
  "name": "example",
  "endpoints": [
    { "name": "alice", "board": "host" },
    { "name": "sendInteger", "board": "host" }
  ]
}
```

### 16.51 Invalid `implicitDyn` <a id="invalid-implicit-dyn"></a>

`implicitDyn` in `choreobs.json`, when present, must be a boolean (spec [§2.2](#choreobs-json)).

Disallowed:

```json
{
  "name": "example",
  "implicitDyn": "no",
  "endpoints": [
    { "name": "alice", "board": "host" },
    { "name": "bob", "board": "host" }
  ]
}
```

### 16.52 Reserved Input File Name <a id="reserved-input-file-name"></a>

The basename of the input file must not begin with `__` (spec [§2.1](#input-files)): the
compiler names its own files with the prefix, such as the runtime files
(spec [§2.3](#output-files)). `choreobs compile` always compiles `src/index.cbs`, so the rule
binds only a compiler that is handed a source file some other way.

Disallowed, as the input file:

```text
__main.cbs
```

The same holds for every name on the path of a BlueScript source file
(spec [§2.5](#bluescript-source-files)), whether or not anything imports from it. Disallowed:

```text
src/__util.bs
src/__lib/clock.bs
```

### 16.53 Name Already Held in the Value Namespace <a id="err-name-already-held"></a>

Location names, function names, and variable and parameter names share one
namespace (spec [§6.1](#namespaces)). Endpoint names and function names are held for the whole
program; a variable or parameter may not take one.

Disallowed — a variable or parameter taking a function's name:

```ts
function g@alice(): integer@alice { return 1@alice; }

function h@alice(): integer@alice {
    let g: integer@alice = 5@alice;
    return g + g();
}
```

Disallowed in either order, because functions are hoisted (spec [§6.3](#function-declaration-hoisting)):

```ts
let g: integer@alice = 5@alice;

function g@alice(): integer@alice {
    return 1@alice;
}
```

Disallowed — a function taking an endpoint's name:

```ts
function alice@alice(): void {
    return;
}
```

Disallowed — a variable or parameter taking an endpoint's name, even one the
source never writes after `@`:

```ts
let bob: integer@alice = 1@alice;
```

The rule is stated over the whole program. A function and a variable that
would never be projected to the same endpoint are still an error; see the
reasoning in spec [§6.1](#namespaces).

Allowed — shadowing between variables and parameters is unaffected
(spec [§6.4](#variable-scope)):

```ts
function f@alice(p: integer@alice): integer@alice {
    let p: integer@alice = 1@alice;
    return p;
}
```

***

### 16.54 Invalid Numeric Conversion <a id="invalid-numeric-conversion"></a>

The operand of `as` must be an `integer` or `float` scalar (spec [§7.15](#numeric-conversion)):

```ts
let b: float@alice = true@alice as float;
```

```ts
let xs: integer[]@alice = [1, 2]@alice;
let ys = xs as float;
```

The following are **parse** errors. What follows `as` must be a bare `integer`
or `float` (spec [§5.15](#expressions)): there is no conversion to any other base type, no
conversion of arrays, and no location on the target, since the result stays
where the operand is:

```ts
let s = 1@alice as string;
```

```ts
let ys = xs as float[];
```

```ts
let x = 1@alice as float@bob;
```

### 16.55 Invalid `print` Call <a id="invalid-print-call"></a>

These are **parse** errors, reported before type checking.

`print` takes exactly one argument (spec [§5.15](#expressions)):

```ts
print();
print(1@alice, 2@alice);
```

Print each value on its own:

```ts
print(1@alice);
print(2@alice);
```

Using `print(e)` where a value is expected is not a syntax error but a type
error, because its result is `void` (spec [§7.18](#print-typing), [§16.43](#invalid-use-of-void)).

### 16.56 Assignment to a Constant <a id="assignment-to-a-constant"></a>

A `const` variable is never stored into after its declaration (spec [§5.7](#const-statement)). Each of
these is rejected:

```ts
const x: integer@alice = 1@alice;
x = 2@alice;
```

```ts
const y: integer@bob <- x;
y <- x;
```

```ts
const n: integer@every = 0@every;
for (let i = 0@every; i < 10@every; n = i) {
    i = i + 1@every;
}
```

Allowed: the elements of a `const` array, which change the array and not the
variable (spec [§7.1.1](#array-types)):

```ts
const xs: integer[]@alice = [1, 2]@alice;
xs[0@alice] = 10@alice;
xs.push(3@alice);
```

### 16.57 `const` in a `for` Header <a id="const-in-a-for-header"></a>

This is a **parse** error. A `for` header declares its variable with `let` only
(spec [§5.12](#for-statement)):

```ts
for (const i = 0@every; i < 10@every; i = i + 1@every) {
}
```

### 16.58 Constant Used Before Initialization <a id="constant-used-before-initialization"></a>

A top-level statement may not call a function that reaches a top-level constant
declared by that statement or by a later one (spec [§6.7](#top-level-constant-initialization-order)). Each of these is
rejected:

```ts
let y: integer@alice = f();             // `limit` is declared later
const limit: integer@alice = 10@alice;

function f@alice(): integer@alice {
    return limit;
}
```

```ts
let y: integer@alice = f();             // through `g`
const limit: integer@alice = 10@alice;

function f@alice(): integer@alice {
    return g();
}

function g@alice(): integer@alice {
    return limit;
}
```

```ts
const limit: integer@alice = f();       // in the constant's own initializer

function f@alice() {
    return limit + 1@alice;
}
```

```ts
let ready: boolean@every = false@every;
if (ready) {
    let y: integer@alice = f();         // in a block, in a branch that does not run
}
const limit: integer@alice = 10@alice;

function f@alice(): integer@alice {
    return limit;
}
```

Allowed — the call comes after the declaration:

```ts
const limit: integer@alice = 10@alice;
let y: integer@alice = f();

function f@alice(): integer@alice {
    return limit;
}
```

### 16.59 Misplaced Import Declaration <a id="misplaced-import-declaration"></a>

This is a **parse** error. Import declarations come before every function
declaration and statement, and only at top level (spec [§5.19](#import-declarations)):

```ts
let x: integer@alice = 1@alice;
import@alice { now } from "./clock";
```

```ts
function f@alice(): void {
    import@alice { now } from "./clock";
}
```

### 16.60 Invalid Import Location <a id="invalid-import-location"></a>

An import declaration names one endpoint, with an individual location
(spec [§5.19](#import-declarations)). Writing none is a **parse** error:

```ts
import { now } from "./clock";
```

`every` and `dyn` are not individual locations:

```ts
import@every { now } from "./clock";
import@dyn { now } from "./clock";
```

An endpoint that `choreobs.json` does not list is an unknown endpoint
(spec [§16.1](#unknown-endpoint)).

### 16.61 Invalid Module Path <a id="invalid-module-path"></a>

The string of an import declaration is `./` followed by names separated by `/`,
without `.bs` (spec [§5.19](#import-declarations)). Each of these is rejected:

```ts
import@alice { now } from "clock";          // no `./`
import@alice { now } from "./clock.bs";     // BlueScript adds `.bs` itself
import@alice { now } from "../lib/clock";   // leaves `src/`
import@alice { now } from "./lib//clock";   // an empty name
import@alice { now } from "thermo";         // a package: a source file imports it (§bluescript-packages)
```

### 16.62 Imported File Not Found <a id="imported-file-not-found"></a>

The file an import declaration names must be a BlueScript source file of the
project (spec [§2.5](#bluescript-source-files)), with every name in the case the string writes it
(spec [§5.19](#import-declarations)). With `src/clock.bs`, this is rejected:

```ts
import@alice { now } from "./Clock";
```

### 16.63 Importing Another Endpoint's File <a id="importing-another-endpoints-file"></a>

An endpoint-specific source file is imported only at its endpoint
(spec [§2.5](#bluescript-source-files), [§5.19](#import-declarations)). With `src/sensor@alice.bs`, this is rejected:

```ts
import@bob { readSensor } from "./sensor@alice";
```

### 16.64 Invalid BlueScript File Name <a id="invalid-bluescript-file-name"></a>

Every BlueScript source file under `src/` is named by the rules of
spec [§2.5](#bluescript-source-files), whether or not anything imports from it. With the endpoints
`alice` and `bob`, each of these files is rejected:

```text
src/sensor@carol.bs     # no endpoint `carol`
src/sensor@every.bs     # not an individual location
src/a@b@alice.bs        # two `@`s
src/@alice.bs           # no name before `@`
src/lib@alice/x.bs      # `@` in a directory's name
src/1st.bs              # begins with a digit
src/my clock.bs         # a space
```

So is a pair of files whose paths differ only in case:

```text
src/Clock.bs
src/clock.bs
```

### 16.65 Unsupported Imported File <a id="unsupported-imported-file"></a>

A source file that an import declaration names must be valid BlueScript syntax,
re-export nothing, and use no communication API function
(spec [§7.21](#imported-signatures)). Each of these files is rejected when it is imported:

```ts
export { now } from "./clock";      // re-exports
```

```ts
export function report(x: integer): void {
    sendInteger("bob", "report", x);   // a communication outside the choreography
}
```

A file that imports values, from other source files or from packages, is not
rejected: the compiler does not follow its imports (spec [§2.6](#bluescript-packages)).

### 16.66 Name Not Exported <a id="name-not-exported"></a>

Each imported name must be exported by the file (spec [§7.21](#imported-signatures)). With this
`src/clock.bs`:

```ts
let ticks: integer = 0;
function step(): void { ticks = ticks + 1; }
export { step };
```

each of these is rejected:

```ts
import@alice { now } from "./clock";      // not declared
import@alice { ticks } from "./clock";    // declared, not exported
import@alice { step } from "./clock";     // a list does not export it
```

### 16.67 Unsupported Export <a id="unsupported-export"></a>

An imported name must be an exported function or constant whose types ChoreoBS
has (spec [§7.21](#imported-signatures)). Importing any of these is rejected:

```ts
export function sum(xs: integer[]): integer { ... }     // an array
export function f(x: any): integer { ... }              // `any`
export function g(x: integer) { ... }                   // no return type
export function h(x: integer = 0): integer { ... }      // a default value
export let count: integer = 0;                          // not a constant
export const scale = 2.0 * 3.0;                         // no type, not a literal
export const twice = (x: integer): integer => x * 2;    // a function value
export class Point { ... }                              // a class
```

### 16.68 Conflicting Imports <a id="conflicting-imports"></a>

A name may be imported more than once only when every import binds it to the
same export of the same file at the same endpoint (spec [§6.8](#imported-names)). Each of these
is rejected:

```ts
import@alice { now } from "./clock";
import@bob { now } from "./clock";         // the same name at two endpoints
```

```ts
import@alice { now } from "./clock";
import@alice { now } from "./timer";       // the same name from two files
```

```ts
import@alice { now, later as now } from "./clock";   // two exports
```

Allowed:

```ts
import@alice { now } from "./clock";
import@alice { now, now as t } from "./clock";
```

## 17. Non-goals and Future Extensions <a id="non-goals-and-future-extensions"></a>

The following features are not part of ChoreoBS v1.

### 17.1 Gradual Features <a id="gradual-features"></a>

Gradual locating (spec [§3.5](#dyn)) is part of v1. Not part of it:

* general location inference — a location is only ever written, taken from an
  initializer or from returns, taken inside a local function from the function,
  or `dyn` (spec [§8.1](#explicit-location-annotations));
* gradual base types: only locations are gradual (spec [§7.5](#subtyping));
* `dyn` or `@every` values inside local functions, and local function parameters
  or return types at `every` or `dyn` (spec [§8.4](#local-function-strict-location-rule));
* `any` and `undefined` as source types.

### 17.2 TypeScript / JavaScript Features <a id="typescript-javascript-features"></a>

* object literals;
* arrays beyond the mutable one-dimensional `integer[]` / `float[]` / `boolean[]` support defined in this specification;
* property access as lvalue — `xs[i] = v` is the only assignable form, and `.length` is read-only;
* property access and method calls in general: `.length` and `.push` are a closed set of array operations (spec [§5.15](#expressions)), not a facility for user types;
* type assertions: `as` is only the numeric conversion between `integer` and `float` (spec [§7.15](#numeric-conversion));
* classes;
* interfaces;
* generics;
* anonymous functions;
* arrow functions;
* closures;
* higher-order functions;
* modules of ChoreoBS code: a program imports from BlueScript source files only
  (spec [§5.19](#import-declarations)), and one `.cbs` file cannot import another;
* namespace imports (`import * as m`), default imports, and imports at `every`;
* `export`;
* `async`;
* `await`.

### 17.3 Control Flow <a id="future-control-flow"></a>

* `break`;
* `continue`;
* `switch`;
* `try`;
* `catch`;
* `throw`;
* `for-of`;
* `for-in`.

### 17.4 Communication Features <a id="future-communication-features"></a>

* asynchronous communication syntax;
* timeout;
* failure handling;
* retries;
* explicit channels;
* session types;
* label selection;
* non-blocking receive.

### 17.5 Data Structures <a id="future-data-structures"></a>

* string arrays;
* null arrays;
* void arrays;
* nested arrays;
* records;
* structs;
* tuples;
* maps.

### 17.6 Future Work <a id="future-work"></a>

Future versions may add:

* general location inference;
* path compression in `__root` (spec [§14.7](#location-variables));
* building a `dyn` array of literals in one step (spec [§12.2](#dyn-lowering));
* operations on array elements and `dyn` values that behave like the static
  ones rather than as on BlueScript's `any` (spec [§7.1.1](#array-types)), for example by bringing
  each value back to its static type first;
* printing several values in one `print`, and printing a value with a label:
  `+` joins only two strings, and v1 has no conversion to `string`
  (spec [§7.18](#print-typing));
* richer communication protocols;
* imported signatures with arrays, which would need ChoreoBS's arrays and
  BlueScript's typed arrays to meet at the call (spec [§7.21](#imported-signatures));
* imports inside an imported BlueScript source file, and imports from
  BlueScript packages (spec [§7.21](#imported-signatures));
* importing a constant at `every`, for a value every endpoint computes alike
  (spec [§5.19](#import-declarations));
* additional array operations and local object support;
* state-machine based EPP;
* non-blocking runtime support;
* selection-based conditionals;
* endpoint protocol verification.

### 17.7 Future Cleanup Optimizations <a id="future-cleanup-optimizations"></a>

ChoreoBS v1 only performs a minimal cleanup pass for compiler-generated `nothing(...)` and `null;` artifacts.

The following optimizations are not required in v1:

* general dead-code elimination;
* unused variable elimination;
* unused function elimination;
* constant folding;
* removal of empty `if` statements;
* removal of empty blocks;
* removal of empty loops;
* side-effect analysis for ordinary function calls;
* effect analysis that would let cleanup drop a call it can prove inert;
* flattening nested `nothing(...)` (spec [§13.15.3](#nested-nothing-is-not-flattened)).

### 17.8 Unverified BlueScript Assumptions <a id="unverified-bluescript-assumptions"></a>

This section is not normative. The runtime file (spec [§14](#runtime-support-functions)) and the endpoint
programs depend on BlueScript behaviour that has not yet been confirmed. Each point should be
settled by running a small `.bs` program on BlueScript, and the runtime changed
where it does not hold.

1. **Writing `__LocVar`** (spec [§14.7](#location-variables)): a field of the class's own type
   (`parent: __LocVar`), storing `this` in a field in the constructor, and `===`
   comparing objects by reference.
2. **Garbage collection** of `__LocVar` and `__DynVal` objects that are no longer
   reachable.
3. **How `__locationError` stops** (spec [§14.8](#location-errors)): that a `code` template calling
   `runtime_error` ends the program on every board. It does on `host`; `esp32`
   is unconfirmed.
4. **`new Array<any>(v)` copies** (spec [§14.4](#copy-array-helper)): that, given an `any[]`, it
   returns a new `any[]` of the same length holding the same elements, as
   BlueScript's `gc_copy_array` reads.
5. **Passing an `any` where an `any[]` is expected** (spec [§14.14](#dyn-transfer-runtime)):
   `__copyPayload` hands its `any` payload to `__copyArray`, and `__sendAny` to
   `sendArray`, each of which takes an `any[]`.
6. **Importing `integer` constants** (spec [§14.6](#location-and-kind-codes)): a generated program imports
   the runtime's `export const` integer constants, read as plain C globals. It
   works on `host`; `esp32` is unconfirmed.
7. **`const` bindings in endpoint programs** (spec [§12.9](#let-projection)): that BlueScript accepts a
   `const` of every type an endpoint program declares — `integer`, `float`,
   `boolean`, `string`, `any[]` and `__DynVal` — at top level, in a function and
   in a loop body, and compiles it as it compiles a `let`. BlueScript's source
   says so, but no generated program with a `const` has been run.
8. **A function using a global declared below it** (spec [§12.18](#top-level-projection)): an endpoint
   program declares its functions before its top-level statements, so a
   function that uses a top-level constant reads a global the file declares
   later. BlueScript's type checker makes two passes, the first recording every
   global, and the C declarations of the globals come before the function
   bodies. A global read before its initialization yields `0`, `0.0` or
   `false`, or `null` for a pointer type, with no error, which is why
   spec [§6.7](#top-level-constant-initialization-order) rejects such a read at compile time. Both work so on `host`
   for `integer`, `float`, `boolean`, `string` and `any[]` globals; a `__DynVal`
   global and `esp32` are unconfirmed.
9. **Renaming imports** (spec [§13.16](#import-code-generation)): an endpoint program imports with
   `import { name as local }`. BlueScript supports it from commit `882d2ca`
   (2026-10-06), which no release has yet; BlueScript 2.1.0 rejects it.
10. **Imported pointer-typed values** (spec [§6.8](#imported-names)): an imported `string` constant,
    and any heap value an imported module keeps in a global, stays alive only
    if BlueScript keeps an imported module's root set linked after the module's
    initializer returns. The fix for that (in `try_and_catch`, `c-runtime.c`) is
    in BlueScript's working tree as of 2026-10-06 and not yet committed
    (spec [§14.6](#location-and-kind-codes)).
11. **`@` in a source file's name** (spec [§2.5](#bluescript-source-files)): BlueScript names the C file of
    `sensor@alice.bs` `bs_sensor@alice.c` and lists it in a Makefile. The C
    identifiers come from module numbers, not file names. BlueScript's
    transpiler accepts such a module, imported with renaming, on `host`; that
    the C build accepts the file name, on `host` and on `esp32`, is unconfirmed.
12. **Module initialization order** (spec [§6.8](#imported-names)): BlueScript initializes every
    module a program imports before the program's own top-level code runs, as
    its compiler orders the modules' entry points. A module whose initializer
    fails stops its endpoint before the choreography begins, and the other
    endpoints wait for messages that never come.
13. **The profiling build** (spec [§13.17](#profiling-build)): a runtime file that calls
    `performanceNow()` and assigns its own module-level `let` variables, from
    functions and from constructors, and the program that imports it. It works
    on `host`. On `esp32` it works from functions: a program with no `dyn` ran
    there and printed its report (2026-11-06). The assignments from
    constructors, which only `dyn` values reach, are unconfirmed there. A time
    is a `float` of milliseconds, so a sum loses precision once it reaches
    hours.
14. **Packages** (spec [§2.6](#bluescript-packages)): a source file copied into an endpoint's project
    imports a package that `bscript project install` put in the project's
    `packages/`, and that package imports a package it depends on and a file of
    its own. It works on `host` (2026-11-08); `esp32` is unconfirmed. Uninstalling
    a package leaves the packages it depends on in `packages/`, unused.

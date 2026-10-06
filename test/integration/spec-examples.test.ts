import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compile,
  bs,
  expectSuccess,
  expectFailure,
  sourceFiles,
} from "../support/compile.js";
import { aliceBob, aliceBobStrict } from "../support/config.js";

describe("spec.md examples — generated .bs output", () => {
  it("§example-direct-communication direct communication", () => {
    const result = compile(`
let x: integer@alice = 42@alice;
let y: integer@bob <- x;
`);
    expectSuccess(result);
    assert.equal(
      bs(result, "alice"),
      `let x: integer = 42;
sendInteger("bob", "__top_0", x);`,
    );
    assert.equal(
      bs(result, "bob"),
      `let y: integer = receiveInteger("alice", "__top_0");`,
    );
  });

  it("§example-broadcast broadcast", () => {
    const result = compile(`
let localOk: boolean@alice = true@alice;
let ok: boolean@every <- localOk;

if (ok) {
    let msg: string@bob = "ok"@bob;
} else {
    let msg: string@bob = "ng"@bob;
}
`);
    expectSuccess(result);
    assert.equal(
      bs(result, "alice"),
      `let localOk: boolean = true;
broadcastBoolean("__top_0", localOk);
let ok: boolean = localOk;
if (ok) {
} else {
}`,
    );
    assert.equal(
      bs(result, "bob"),
      `let ok: boolean = receiveBoolean("alice", "__top_0");
if (ok) {
  let msg: string = "ok";
} else {
  let msg: string = "ng";
}`,
    );
  });

  it("§example-local-function local function", () => {
    const result = compile(`
function add@alice(a: integer@alice, b: integer@alice): integer@alice {
    return a + b;
}

let x: integer@alice = add(1@alice, 2@alice);
`);
    expectSuccess(result);
    assert.equal(
      bs(result, "alice"),
      `function add(a: integer, b: integer): integer {
  return a + b;
}
let x: integer = add(1, 2);`,
    );
    assert.equal(bs(result, "bob"), "");
  });

  it("§type-inference type inference — add, inferred let, and communication", () => {
    const result = compile(`
function add@alice(a: integer@alice, b: integer@alice) {
  let c = a + b;
  return c;
}

let x = add(1@alice, 2@alice);
let y: integer@bob <- x;
`);
    expectSuccess(result);
    assert.equal(
      bs(result, "alice"),
      `function add(a: integer, b: integer): integer {
  let c: integer = a + b;
  return c;
}
let x: integer = add(1, 2);
sendInteger("bob", "__top_0", x);`,
    );
    assert.equal(
      bs(result, "bob"),
      `let y: integer = receiveInteger("alice", "__top_0");`,
    );
  });

  it("§example-choreography-function choreography function", () => {
    const result = compile(`
function choose(c: boolean@every): integer@alice {
    if (c) {
        return 1@alice;
    } else {
        return 0@alice;
    }
}

let c: boolean@every = true@every;
let x: integer@alice = choose(c);
`);
    expectSuccess(result);
    assert.equal(
      bs(result, "alice"),
      `function choose(c: boolean): integer {
  if (c) {
    return 1;
  } else {
    return 0;
  }
}
let c: boolean = true;
let x: integer = choose(c);`,
    );
    assert.equal(
      bs(result, "bob"),
      `function choose(c: boolean): null {
  if (c) {
    return null;
  } else {
    return null;
  }
}
let c: boolean = true;
choose(c);`,
    );
  });

  it("§example-while-with-transfer while with communication", () => {
    const result = compile(`
let cont: boolean@every = true@every;

while (cont) {
    let x: integer@alice = 1@alice;
    let y: integer@bob <- x;

    let nextLocal: boolean@bob = false@bob;
    cont <- nextLocal;
}
`);
    expectSuccess(result);
    assert.equal(
      bs(result, "alice"),
      `let cont: boolean = true;
while (cont) {
  let x: integer = 1;
  sendInteger("bob", "__top_0", x);
  cont = receiveBoolean("bob", "__top_1");
}`,
    );
    assert.equal(
      bs(result, "bob"),
      `let cont: boolean = true;
while (cont) {
  let y: integer = receiveInteger("alice", "__top_0");
  let nextLocal: boolean = false;
  broadcastBoolean("__top_1", nextLocal);
  cont = nextLocal;
}`,
    );
  });

  it("§example-for-loop for loop", () => {
    const result = compile(`
for (
    let i: integer@every = 0@every;
    i < 3@every;
    i = i + 1@every
) {
    let x: integer@alice <- i;
    let y: integer@bob <- x;
}
`);
    expectSuccess(result);
    assert.equal(
      bs(result, "alice"),
      `for (let i: integer = 0; i < 3; i = i + 1) {
  let x: integer = i;
  sendInteger("bob", "__top_0", x);
}`,
    );
    assert.equal(
      bs(result, "bob"),
      `for (let i: integer = 0; i < 3; i = i + 1) {
  let y: integer = receiveInteger("alice", "__top_0");
}`,
    );
  });
});

describe("spec.md §example-local-imports — local imports", () => {
  it("§example-local-imports keeps each import at its endpoint and copies the files there", () => {
    const files = sourceFiles({
      "clock.bs": "let ticks: integer = 0;\n\nexport function now(): integer {\n  ticks = ticks + 1;\n  return ticks;\n}\n",
      "sensor@alice.bs": "export const threshold = 30;\n\nexport function readSensor(t: integer): float {\n  return 20.5 + t;\n}\n",
    });
    const result = compile(`
import@alice { readSensor, threshold as limit } from "./sensor@alice";
import@alice { now as nowAtAlice } from "./clock";
import@bob { now as nowAtBob } from "./clock";

function hot@alice(x: float): boolean {
    return x > (limit as float);
}

let reading: float@alice = readSensor(nowAtAlice());
let alert: boolean@bob <- hot(reading);
let stamp: integer@bob = nowAtBob();
`, aliceBob, "index.cbs", files);
    expectSuccess(result);
    assert.equal(
      bs(result, "alice"),
      `import { readSensor, threshold as limit } from "./sensor@alice";
import { now as nowAtAlice } from "./clock";

function hot(x: float): boolean {
  return x > ((limit as integer) as float);
}
let reading: float = readSensor(nowAtAlice());
sendBoolean("bob", "__top_0", hot(reading));`,
    );
    assert.equal(
      bs(result, "bob"),
      `import { now as nowAtBob } from "./clock";

let alert: boolean = receiveBoolean("alice", "__top_0");
let stamp: integer = nowAtBob();`,
    );
    assert.deepEqual(
      result.sourceFiles.map((f) => `${f.endpoint}:${f.path}`),
      ["alice:clock.bs", "alice:sensor@alice.bs", "bob:clock.bs"],
    );
  });
});

describe("spec.md §compile-time-errors — invalid programs", () => {
  it("§unknown-endpoint unknown endpoint", () => {
    const result = compile(`let x: integer@carol = 1@carol;`);
    expectFailure(result);
    assert.ok(result.errors.some((e) => e.message.includes("carol")));
  });

  it("§invalid-assignment-across-locations invalid assignment across locations", () => {
    const result = compile(`
let x: integer@alice = 1@alice;
let y: integer@bob = x;
`);
    expectFailure(result);
    assert.ok(
      result.errors.some((e) => e.message.includes("use a transfer instead")),
    );
  });

  it("§invalid-transfer-base-type invalid transfer base type", () => {
    const result = compile(`
let x: float@alice = 1.5@alice;
let y: integer@bob <- x;
`);
    expectFailure(result);
    assert.ok(
      result.errors.some((e) => e.message.includes("transfer type mismatch")),
      JSON.stringify(result.errors),
    );
  });

  it("§calling-another-endpoints-local-function cross-node local function call", () => {
    const result = compile(`
function f@bob(): integer@bob { return 1@bob; }
function g@alice(): integer@alice { return f(); }
`);
    expectFailure(result);
    assert.ok(result.errors.some((e) => e.message.includes("cannot call")));
  });

  it("§calling-choreography-from-local choreography function from local function", () => {
    const result = compile(`
function h(): void { return; }
function g@alice(): void { h(); return; }
`);
    expectFailure(result);
    assert.ok(
      result.errors.some((e) =>
        e.message.includes("cannot call choreography function"),
      ),
      JSON.stringify(result.errors),
    );
  });

  it("§location-annotation-omission location omission with nothing to infer from", () => {
    for (const source of [
      `let x: integer = 1;`,
      `function f(a: integer): void {}`,
    ]) {
      const result = compile(source, aliceBobStrict);
      expectFailure(result);
      assert.ok(
        result.errors.some((e) => e.message.includes("location annotation required on")),
        JSON.stringify(result.errors),
      );
    }
    // A local function infers what it leaves out, in strict mode too.
    expectSuccess(compile(`
function f@alice(a: integer): integer {
    return a;
}
`, aliceBobStrict));
  });

  it("§local-function-location-inference an omission in a local function is the function's location", () => {
    const omitted = `
function sum@alice(a: integer, b: integer): integer {
    let xs: integer[] = [a, b];
    let c: integer <- a;
    return xs[0] + xs[1] + c + 1;
}
`;
    const written = `
function sum@alice(a: integer@alice, b: integer@alice): integer@alice {
    let xs: integer[]@alice = [a, b]@alice;
    let c: integer@alice <- a;
    return xs[0@alice] + xs[1@alice] + c + 1@alice;
}
`;
    for (const config of [aliceBob, aliceBobStrict]) {
      const a = compile(omitted, config);
      const b = compile(written, config);
      expectSuccess(a);
      expectSuccess(b);
      assert.equal(bs(a, "alice"), bs(b, "alice"));
      assert.equal(bs(a, "bob"), bs(b, "bob"));
    }
  });
});

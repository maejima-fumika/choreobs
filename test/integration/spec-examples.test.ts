import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileSource } from "../../src/driver/index.js";
import type { CompileResult } from "../../src/driver/index.js";

const config = { endpoints: ["alice", "bob"] };

function compile(source: string): CompileResult {
  return compileSource(source, "index.cbs", config);
}

function bs(result: CompileResult, endpoint: string): string {
  const hit = result.outputs.find((o) => o.endpoint === endpoint);
  assert.ok(hit, `missing output for ${endpoint}`);
  return hit.source.trimEnd();
}

function expectSuccess(result: CompileResult): void {
  assert.equal(
    result.success,
    true,
    `expected success, errors: ${JSON.stringify(result.errors)}`,
  );
}

function expectFailure(result: CompileResult): void {
  assert.equal(result.success, false);
  assert.ok(result.errors.length > 0);
  assert.equal(result.outputs.length, 0);
}

describe("spec.md examples — generated .bs output", () => {
  it("§15.1 direct communication", () => {
    const result = compile(`
let x: integer@alice = 42@alice;
let y: integer@bob <- x;
`);
    expectSuccess(result);
    assert.equal(
      bs(result, "alice"),
      `let x: integer = 42;
sendInteger("bob", "top_0", x);`,
    );
    assert.equal(
      bs(result, "bob"),
      `let y: integer = receiveInteger("alice", "top_0");`,
    );
  });

  it("§15.2 broadcast", () => {
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
broadcastBoolean("top_0", localOk);
let ok: boolean = localOk;
if (ok) {
} else {
}`,
    );
    assert.equal(
      bs(result, "bob"),
      `let ok: boolean = receiveBoolean("alice", "top_0");
if (ok) {
  let msg: string = "ok";
} else {
  let msg: string = "ng";
}`,
    );
  });

  it("§15.3 local function", () => {
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

  it("§7.14 type inference — add, inferred let, and communication", () => {
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
sendInteger("bob", "top_0", x);`,
    );
    assert.equal(
      bs(result, "bob"),
      `let y: integer = receiveInteger("alice", "top_0");`,
    );
  });

  it("§15.4 choreography function", () => {
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
nothing(choose(c));`,
    );
  });

  it("§15.5 while with communication", () => {
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
  sendInteger("bob", "top_0", x);
  cont = receiveBoolean("bob", "top_1");
}`,
    );
    assert.equal(
      bs(result, "bob"),
      `let cont: boolean = true;
while (cont) {
  let y: integer = receiveInteger("alice", "top_0");
  let nextLocal: boolean = false;
  broadcastBoolean("top_1", nextLocal);
  cont = nextLocal;
}`,
    );
  });

  it("§15.6 for loop", () => {
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
  sendInteger("bob", "top_0", x);
}`,
    );
    assert.equal(
      bs(result, "bob"),
      `for (let i: integer = 0; i < 3; i = i + 1) {
  let y: integer = receiveInteger("alice", "top_0");
}`,
    );
  });
});

describe("spec.md §16 — invalid programs", () => {
  it("§16.1 unknown endpoint", () => {
    const result = compile(`let x: integer@carol = 1@carol;`);
    expectFailure(result);
    assert.ok(result.errors.some((e) => e.message.includes("carol")));
  });

  it("§16.7 invalid assignment across locations", () => {
    const result = compile(`
let x: integer@alice = 1@alice;
let y: integer@bob = x;
`);
    expectFailure(result);
    assert.ok(
      result.errors.some((e) => e.message.includes("use a transfer instead")),
    );
  });

  it("§16.8 invalid transfer base type", () => {
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

  it("§16.12 cross-node local function call", () => {
    const result = compile(`
function f@bob(): integer@bob { return 1@bob; }
function g@alice(): integer@alice { return f(); }
`);
    expectFailure(result);
    assert.ok(result.errors.some((e) => e.message.includes("cannot call")));
  });

  it("§16.13 choreography function from local function", () => {
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

  it("§16.3 location omission with nothing to infer from", () => {
    const result = compile(`
function f@alice(a: integer): integer@alice {
  return a;
}
`);
    expectFailure(result);
    assert.ok(
      result.errors.some((e) =>
        e.message.includes("location annotation required on type"),
      ),
      JSON.stringify(result.errors),
    );
  });
});

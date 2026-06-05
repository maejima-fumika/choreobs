import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileSource } from "../../src/driver/index.js";
import type { CompileResult } from "../../src/driver/index.js";
import { parse } from "../../src/parser/index.js";
import { typeCheck } from "../../src/check/index.js";

const config = { participants: ["alice", "bob"] };

function compile(source: string): CompileResult {
  return compileSource(source, "index.cbs", config);
}

function bs(result: CompileResult, participant: string): string {
  const hit = result.outputs.find((o) => o.path.endsWith(`index_${participant}.bs`));
  assert.ok(hit, `missing index output for ${participant}`);
  return hit.source.trim();
}

function rejects(source: string, needle: string): void {
  const { program, errors: parseErrors } = parse(source);
  assert.equal(parseErrors.length, 0, JSON.stringify(parseErrors));
  assert.ok(program);
  const { typed, errors } = typeCheck(program, config);
  assert.equal(typed, null, `expected rejection for: ${source}`);
  assert.ok(
    errors.some((e) => e.message.includes(needle)),
    `expected error containing "${needle}": ${JSON.stringify(errors)}`,
  );
}

describe("§18.21 dynamic compile-time errors", () => {
  it("§18.21.4 rejects @dynamic return in a local function", () => {
    rejects(`function bad@alice(): integer@dynamic { return 1@alice; }`, "dynamic");
  });

  it("§18.21.5 rejects incompatible omitted return locations", () => {
    rejects(
      `function bad@every(c: boolean@every) {
  if (c) { return 1@alice; } else { return 2@bob; }
}`,
      "least upper bound",
    );
  });

  it("§18.21.5 accepts an explicit @dynamic return type instead", () => {
    const result = compile(
      `function ok@every(c: boolean@every): integer@dynamic {
  if (c) { return 1@alice; } else { return 2@bob; }
}`,
    );
    assert.equal(result.success, true, JSON.stringify(result.errors));
  });
});

describe("§18.22 dynamic runtime cases compile (errors deferred to runtime)", () => {
  it("§18.22.1 operator location mismatch lowers to dynAdd", () => {
    const result = compile(`
let x: integer@dynamic = 1@alice;
let y: integer@dynamic = 2@bob;
let z = x + y;
`);
    assert.equal(result.success, true, JSON.stringify(result.errors));
    assert.match(bs(result, "alice"), /dynAdd\(/);
  });

  it("§18.22.3 same-location dynamic communication lowers to dynMove", () => {
    const result = compile(`
let a: integer@dynamic = 1@alice;
let b: integer@dynamic = 2@alice;
a <~ b;
`);
    assert.equal(result.success, true, JSON.stringify(result.errors));
    assert.match(bs(result, "alice"), /dynMove\(/);
  });

  it("§18.22.4 every-to-every communication lowers to dynMove", () => {
    const result = compile(`
let a = 1;
let b = 2;
a <~ b;
`);
    assert.equal(result.success, true, JSON.stringify(result.errors));
    assert.match(bs(result, "alice"), /dynMove\(/);
  });

  it("§18.22.5 omitted-type communication let every-to-every lowers to dynMove", () => {
    const result = compile(`
let x = 1;
let y <~ x;
`);
    assert.equal(result.success, true, JSON.stringify(result.errors));
    assert.match(bs(result, "alice"), /let y: DynValue = dynMove\(x, "top_0", EVERY\)/);
    assert.match(bs(result, "bob"), /let y: DynValue = dynMove\(x, "top_0", EVERY\)/);
  });

  it("§18.22.6 dynamic array access lowers to dynArrayGet", () => {
    const result = compile(`
let arr = [1, 2, 3];
arr[0@alice];
`);
    assert.equal(result.success, true, JSON.stringify(result.errors));
    assert.match(bs(result, "alice"), /dynArrayGet\(/);
  });

  it("§18.22.7 dynamic array mutation lowers to dynArraySet", () => {
    const result = compile(`
let arr = [1, 2, 3];
arr[0] = 10@alice;
`);
    assert.equal(result.success, true, JSON.stringify(result.errors));
    assert.match(bs(result, "alice"), /dynArraySet\(/);
  });
});

describe("§18.23 dynamic examples (exact EPP output)", () => {
  it("§18.23.4 dynamic default location", () => {
    const result = compile(`let x = 1;\nlet y = x + 2;`);
    assert.equal(result.success, true, JSON.stringify(result.errors));
    for (const p of ["alice", "bob"]) {
      const out = bs(result, p);
      assert.match(out, /let x: DynValue = new DynValue\(1, EVERY\);/);
      assert.match(out, /let y: DynValue = dynAdd\(x, new DynValue\(2, EVERY\)\);/);
    }
  });

  it("§18.23.5 static location packed into dynamic", () => {
    const result = compile(`let x: integer@dynamic = 1@alice;\nlet y = x + 10;`);
    assert.equal(result.success, true, JSON.stringify(result.errors));
    assert.match(bs(result, "alice"), /let x: DynValue = packDynamic\(1, "alice"\);/);
    assert.match(bs(result, "bob"), /let x: DynValue = packDynamic\(null, "alice"\);/);
    for (const p of ["alice", "bob"]) {
      assert.match(bs(result, p), /dynAdd\(x, new DynValue\(10, EVERY\)\);/);
    }
  });

  it("§18.23.6 dynamic broadcast via omitted communication destination", () => {
    const result = compile(`let x: integer@dynamic = 1@alice;\nlet y: integer <~ x;`);
    assert.equal(result.success, true, JSON.stringify(result.errors));
    assert.match(bs(result, "alice"), /let x: DynValue = packDynamic\(1, "alice"\);/);
    assert.match(bs(result, "bob"), /let x: DynValue = packDynamic\(null, "alice"\);/);
    for (const p of ["alice", "bob"]) {
      assert.match(bs(result, p), /let y: DynValue = dynMove\(x, "top_0", EVERY\);/);
    }
  });

  it("§18.23.9 dynamic assignment shares array payload reference", () => {
    const result = compile(`
let xs = [1, 2, 3];
let ys = xs;
push(xs, 4);
let n = length(ys);
`);
    assert.equal(result.success, true, JSON.stringify(result.errors));
    for (const p of ["alice", "bob"]) {
      const out = bs(result, p);
      assert.match(out, /let xs: DynValue = new DynValue\(\[1, 2, 3\], EVERY\);/);
      assert.match(out, /let ys: DynValue = xs\.copyWrapper\(\);/);
      assert.match(out, /dynArrayPush\(xs, new DynValue\(4, EVERY\)\);/);
      assert.match(out, /dynArrayLength\(ys\)/);
    }
  });

  it("§18.23.10 dynamic communication creates fresh array copy", () => {
    const result = compile(`let xs = [1, 2, 3]@alice;\nlet ys: integer[] <~ xs;`);
    assert.equal(result.success, true, JSON.stringify(result.errors));
    const alice = bs(result, "alice");
    assert.match(alice, /let xs: integer\[\] = \[1, 2, 3\];/);
    assert.match(
      alice,
      /let ys: DynValue = dynMove\(packDynamic\(xs, "alice"\), "top_0", EVERY\);/,
    );
    assert.match(
      bs(result, "bob"),
      /let ys: DynValue = dynMove\(packDynamic\(null, "alice"\), "top_0", EVERY\);/,
    );
  });
});

describe("Core v0 regression: non-gradual programs emit no runtime module", () => {
  it("does not emit index_runtime files when no gradual features are used", () => {
    const result = compile(`
let x: integer@alice = 42@alice;
let y: integer@bob <~ x;
`);
    assert.equal(result.success, true, JSON.stringify(result.errors));
    assert.ok(!result.outputs.some((o) => /[/\\]runtime_/.test(o.path)));
    assert.match(bs(result, "alice"), /sendInteger\("bob", "top_0", x\);/);
    assert.match(bs(result, "bob"), /receiveInteger\("alice", "top_0"\)/);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "../../src/parser/index.js";
import { typeCheck } from "../../src/check/index.js";
import { project } from "../../src/epp/index.js";
import { emit } from "../../src/emit/index.js";
import { compileFile, writeOutputs } from "../../src/driver/index.js";

const config = { participants: ["alice", "bob"] };

function pipeline(source: string, participant: string): string {
  const { program } = parse(source);
  const { typed } = typeCheck(program!, config);
  const projected = project(typed!, participant);
  return emit(projected);
}

describe("BlueScript emitter", () => {
  it("emits direct communication for alice (spec §15.1)", () => {
    const code = pipeline(
      `
let x: integer@alice = 42@alice;
let y: integer@bob <~ x;
`,
      "alice",
    );
    assert.match(code, /let x: integer = 42;/);
    assert.match(code, /sendInteger\("bob", "top_0", x\);/);
    assert.doesNotMatch(code, /@/);
  });

  it("emits receive for bob (spec §15.1)", () => {
    const code = pipeline(
      `
let x: integer@alice = 42@alice;
let y: integer@bob <~ x;
`,
      "bob",
    );
    assert.match(code, /let y: integer = receiveInteger\("alice", "top_0"\);/);
  });

  it("emits broadcast (spec §15.2)", () => {
    const alice = pipeline(
      `
let localOk: boolean@alice = true@alice;
let ok: boolean@every <~ localOk;
`,
      "alice",
    );
    assert.match(alice, /broadcastBoolean\("top_0", localOk\)/);
    assert.match(alice, /let ok: boolean = localOk;/);

    const bob = pipeline(
      `
let localOk: boolean@alice = true@alice;
let ok: boolean@every <~ localOk;
`,
      "bob",
    );
    assert.match(bob, /let ok: boolean = receiveBoolean\("alice", "top_0"\)/);
  });

  it("finalizes absent call args to null in nothing (spec §10.2)", () => {
    const bob = pipeline(
      `
function add@alice(a: integer, b: integer): integer { return a + b; }
let x: integer@alice = add(1@alice, 2@alice);
`,
      "bob",
    );
    assert.match(bob, /nothing\(null, null\);/);
  });

  it("maps unit to void in functions", () => {
    const code = pipeline(
      `function f@every(): unit@every { return; }`,
      "alice",
    );
    assert.match(code, /function f\(\): void/);
  });

  it("emits function with inferred return type through EPP (spec §7.14.4)", () => {
    const code = pipeline(
      `function add@alice(a: integer, b: integer) {
  return a + b;
}`,
      "alice",
    );
    assert.match(code, /function add\(a: integer, b: integer\): integer/);
    assert.match(code, /return a \+ b;/);
  });

  it("compile writes index_<participant>.bs files", () => {
    const dir = mkdtempSync(join(tmpdir(), "choreobs-test-"));
    try {
      const cbsPath = join(dir, "index.cbs");
      const configPath = join(dir, "choreobs.json");
      const source = `
let x: integer@alice = 10@alice;
let y: integer@bob <~ x;
`;
      writeFileSync(cbsPath, source, "utf8");
      writeFileSync(
        configPath,
        JSON.stringify({ participants: ["alice", "bob"] }),
        "utf8",
      );

      const result = compileFile(cbsPath);
      assert.equal(result.success, true);
      assert.equal(result.outputs.length, 2);

      writeOutputs(result.outputs);

      const alicePath = join(dir, "index_alice.bs");
      const bobPath = join(dir, "index_bob.bs");
      const aliceBs = readFileSync(alicePath, "utf8");
      const bobBs = readFileSync(bobPath, "utf8");

      assert.match(aliceBs, /sendInteger\("bob", "top_0", x\)/);
      assert.match(bobBs, /receiveInteger\("alice", "top_0"\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

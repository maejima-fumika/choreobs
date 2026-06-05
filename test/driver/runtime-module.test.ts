import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileFile, compileSource } from "../../src/driver/index.js";
import { emitRuntimeModule } from "../../src/emit/runtime.js";

const config = { participants: ["alice", "bob"] };

describe("runtime module emission and imports", () => {
  it("rejects non-.cbs input files", () => {
    const dir = mkdtempSync(join(tmpdir(), "choreobs-rt-"));
    try {
      const path = join(dir, "index.txt");
      writeFileSync(path, "let x = 1;", "utf8");
      writeFileSync(join(dir, "choreobs.json"), JSON.stringify(config), "utf8");
      const result = compileFile(path);
      assert.equal(result.success, false);
      assert.ok(result.errors.some((e) => e.message.includes(".cbs")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects runtime.cbs as input", () => {
    const dir = mkdtempSync(join(tmpdir(), "choreobs-rt-"));
    try {
      const path = join(dir, "runtime.cbs");
      writeFileSync(path, "function f(): unit@every { return; }", "utf8");
      writeFileSync(join(dir, "choreobs.json"), JSON.stringify(config), "utf8");
      const result = compileFile(path);
      assert.equal(result.success, false);
      assert.ok(result.errors.some((e) => e.message.includes("runtime.cbs")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("emits runtime_<participant>.bs and imports when gradual is used", () => {
    const result = compileSource(`let x = 1;`, "index.cbs", config);
    assert.equal(result.success, true, JSON.stringify(result.errors));
    const rtAlice = result.outputs.find((o) => o.path.endsWith("runtime_alice.bs"));
    const mainAlice = result.outputs.find((o) => o.path.endsWith("index_alice.bs"));
    assert.ok(rtAlice);
    assert.ok(mainAlice);
    assert.match(mainAlice!.source, /^import \{ DynValue, EVERY \} from "runtime_alice";/);
    assert.match(rtAlice!.source, /^export class DynValue/m);
    assert.match(rtAlice!.source, /^export function dynMove/m);
  });

  it("does not emit runtime files or imports for Core v0 programs", () => {
    const result = compileSource(
      `
let x: integer@alice = 1@alice;
let y: integer@bob <~ x;
`,
      "index.cbs",
      config,
    );
    assert.equal(result.success, true, JSON.stringify(result.errors));
    assert.ok(!result.outputs.some((o) => o.path.includes("runtime_")));
    const alice = result.outputs.find((o) => o.participant === "alice")?.source ?? "";
    assert.doesNotMatch(alice, /^import \{/);
  });

  it("rejects user function names that conflict with runtime symbols", () => {
    const result = compileSource(
      `function packDynamic(): unit@every { return; }`,
      "index.cbs",
      config,
    );
    assert.equal(result.success, false);
    assert.ok(
      result.errors.some((e) => e.message.includes("compiler runtime symbol")),
    );
  });

  it("rejects user let bindings that conflict with runtime symbols", () => {
    const result = compileSource(`let dynMove = 1;`, "index.cbs", config);
    assert.equal(result.success, false);
    assert.ok(
      result.errors.some((e) => e.message.includes("compiler runtime symbol")),
    );
  });

  it("still allows a function named like a participant", () => {
    const result = compileSource(
      `function alice@alice(): unit { return; }`,
      "index.cbs",
      config,
    );
    assert.equal(result.success, true, JSON.stringify(result.errors));
  });

  it("runtime module uses export on definitions", () => {
    const rt = emitRuntimeModule("alice");
    assert.match(rt, /export const EVERY/);
    assert.match(rt, /export function packDynamic/);
  });
});

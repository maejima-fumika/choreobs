import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, defaultConfigPath } from "../../src/config/index.js";
import { validateEndpoints } from "../../src/config/validate.js";

/** Writes `contents` as choreobs.json in a fresh temp dir and loads it. */
function withConfig<T>(contents: string, run: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "choreobs-config-"));
  try {
    const path = join(dir, "choreobs.json");
    writeFileSync(path, contents, "utf8");
    return run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("config — validateEndpoints (spec §2.2)", () => {
  it("accepts a well-formed set", () => {
    assert.equal(validateEndpoints(["alice", "bob"]), undefined);
  });

  it("accepts the empty set", () => {
    assert.equal(validateEndpoints([]), undefined);
  });

  it("rejects 'every' as an endpoint name", () => {
    assert.equal(
      validateEndpoints(["alice", "every"]),
      "'every' must not appear in endpoints (spec §2.2)",
    );
  });

  it("rejects a duplicate, naming the repeated endpoint", () => {
    assert.equal(
      validateEndpoints(["alice", "bob", "alice"]),
      "duplicate endpoint 'alice' in endpoints (spec §2.2)",
    );
  });

  it("reports the first duplicate when several repeat", () => {
    assert.equal(
      validateEndpoints(["a", "b", "b", "a"]),
      "duplicate endpoint 'b' in endpoints (spec §2.2)",
    );
  });

  it("checks 'every' before duplicates", () => {
    assert.equal(
      validateEndpoints(["alice", "alice", "every"]),
      "'every' must not appear in endpoints (spec §2.2)",
    );
  });
});

describe("config — loadConfig", () => {
  it("loads a valid config", () => {
    const config = withConfig(
      JSON.stringify({ endpoints: ["alice", "bob"] }),
      loadConfig,
    );
    assert.deepEqual(config.endpoints, ["alice", "bob"]);
  });

  it("prefixes an endpoint-set error with the config path", () => {
    withConfig(JSON.stringify({ endpoints: ["alice", "alice"] }), (path) => {
      assert.throws(
        () => loadConfig(path),
        (e: Error) => {
          assert.equal(
            e.message,
            `${path}: duplicate endpoint 'alice' in endpoints (spec §2.2)`,
          );
          return true;
        },
      );
    });
  });

  it("rejects 'every' with the config path", () => {
    withConfig(JSON.stringify({ endpoints: ["every"] }), (path) => {
      assert.throws(
        () => loadConfig(path),
        (e: Error) => {
          assert.equal(
            e.message,
            `${path}: 'every' must not appear in endpoints (spec §2.2)`,
          );
          return true;
        },
      );
    });
  });

  it("rejects a non-array endpoints field", () => {
    withConfig(JSON.stringify({ endpoints: "alice" }), (path) => {
      assert.throws(() => loadConfig(path), /must be an array of strings/);
    });
  });

  it("rejects a non-string endpoint entry", () => {
    withConfig(JSON.stringify({ endpoints: ["alice", 1] }), (path) => {
      assert.throws(() => loadConfig(path), /each endpoint must be a string/);
    });
  });

  it("defaultConfigPath sits next to the .cbs file", () => {
    assert.equal(
      defaultConfigPath(join("some", "dir", "index.cbs")),
      join("some", "dir", "choreobs.json"),
    );
  });
});

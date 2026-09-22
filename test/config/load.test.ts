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

  it("accepts every shape an identifier may take (spec §4.3)", () => {
    for (const name of ["a", "_ok", "w1", "A_b9", "top"]) {
      assert.equal(validateEndpoints([name]), undefined, name);
    }
  });

  it("accepts a name that is reserved only as a runtime identifier", () => {
    // An endpoint name reaches the output as a string literal and a file name,
    // never as a BlueScript identifier, so it cannot capture a runtime helper
    // the way a variable of that name would (spec §6.2).
    assert.equal(validateEndpoints(["nothing", "sendInteger"]), undefined);
  });

  it("rejects a name that is not an identifier (spec §4.3)", () => {
    for (const name of ["", "bo b", "1abc", "b\"x", "al\nice", "α", "a-b"]) {
      assert.equal(
        validateEndpoints(["alice", name]),
        `endpoint ${JSON.stringify(name)} is not a valid identifier (spec §2.2, §4.3, §16.47)`,
        name,
      );
    }
  });

  it("rejects a name that would escape the output directory", () => {
    // `index_<endpoint>.bs` is joined onto the source directory (spec §2.3).
    assert.equal(
      validateEndpoints(["alice", "../pwned"]),
      'endpoint "../pwned" is not a valid identifier (spec §2.2, §4.3, §16.47)',
    );
  });

  it("rejects the compiler's '__' prefix (spec §4.3, §6.2)", () => {
    for (const name of ["__", "__evil", "__transfer_0"]) {
      assert.equal(
        validateEndpoints(["alice", name]),
        `endpoint '${name}' must not begin with '__', which is reserved for the compiler (spec §2.2, §6.2, §16.47)`,
        name,
      );
    }
  });

  it("allows a single leading underscore", () => {
    assert.equal(validateEndpoints(["_alice", "_"]), undefined);
  });

  it("rejects a reserved word as an endpoint name (spec §4.4)", () => {
    for (const name of ["while", "class", "integer", "function", "null"]) {
      assert.equal(
        validateEndpoints(["alice", name]),
        `endpoint ${JSON.stringify(name)} is not a valid identifier (spec §2.2, §4.3, §16.47)`,
        name,
      );
    }
  });

  it("checks 'every' before shape, for the more specific message", () => {
    // `every` is a reserved word too, so the generic shape check would also
    // catch it — with a message that does not say why (spec §2.2).
    assert.equal(
      validateEndpoints(["every"]),
      "'every' must not appear in endpoints (spec §2.2)",
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

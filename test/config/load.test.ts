import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadConfig,
  findProjectRoot,
  compilerConfig,
  ConfigError,
  validateDeviceNames,
} from "../../src/config/index.js";
import { validateEndpoints } from "../../src/config/validate.js";

/** The three rules an endpoint name that is not an identifier breaks. */
const IDENTIFIER_RULES = ["choreobs-json", "identifiers", "invalid-endpoint-name"] as const;

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

describe("config — validateEndpoints (spec §choreobs-json)", () => {
  it("accepts a well-formed set", () => {
    assert.equal(validateEndpoints(["alice", "bob"]), undefined);
  });

  it("accepts the empty set", () => {
    assert.equal(validateEndpoints([]), undefined);
  });

  it("rejects 'every' as an endpoint name", () => {
    assert.deepEqual(
      validateEndpoints(["alice", "every"]),
      {
        message: "'every' must not appear in endpoints",
        spec: ["choreobs-json", "using-every-as-an-endpoint"],
      },
    );
  });

  it("rejects a duplicate, naming the repeated endpoint", () => {
    assert.deepEqual(
      validateEndpoints(["alice", "bob", "alice"]),
      { message: "duplicate endpoint 'alice' in endpoints", spec: ["choreobs-json"] },
    );
  });

  it("rejects names that differ only in case (spec §choreobs-json)", () => {
    assert.deepEqual(
      validateEndpoints(["Alice", "bob", "alice"]),
      { message: "endpoints 'Alice' and 'alice' differ only in case", spec: ["choreobs-json"] },
    );
  });

  it("reports the first duplicate when several repeat", () => {
    assert.deepEqual(
      validateEndpoints(["a", "b", "b", "a"]),
      { message: "duplicate endpoint 'b' in endpoints", spec: ["choreobs-json"] },
    );
  });

  it("accepts every shape an identifier may take (spec §identifiers)", () => {
    for (const name of ["a", "_ok", "w1", "A_b9", "top"]) {
      assert.equal(validateEndpoints([name]), undefined, name);
    }
  });

  it("accepts a name that is reserved only as a runtime identifier", () => {
    // An endpoint name reaches the output as a string literal and a file name,
    // never as a BlueScript identifier, so it cannot capture a runtime helper
    // the way a variable of that name would (spec §function-names).
    assert.equal(validateEndpoints(["nothing", "sendInteger"]), undefined);
  });

  it("rejects a name that is not an identifier (spec §identifiers)", () => {
    for (const name of ["", "bo b", "1abc", "b\"x", "al\nice", "α", "a-b"]) {
      assert.deepEqual(
        validateEndpoints(["alice", name]),
        { message: `endpoint ${JSON.stringify(name)} is not a valid identifier`, spec: IDENTIFIER_RULES },
        name,
      );
    }
  });

  it("rejects a name that would escape the output directory", () => {
    // The name is the endpoint's directory in the workspace (spec §output-files).
    assert.deepEqual(
      validateEndpoints(["alice", "../pwned"]),
      { message: 'endpoint "../pwned" is not a valid identifier', spec: IDENTIFIER_RULES },
    );
  });

  it("rejects the compiler's '__' prefix (spec §identifiers, §function-names)", () => {
    for (const name of ["__", "__evil", "__transfer_0"]) {
      assert.deepEqual(
        validateEndpoints(["alice", name]),
        {
          message: `endpoint '${name}' must not begin with '__', which is reserved for the compiler`,
          spec: ["choreobs-json", "function-names", "invalid-endpoint-name"],
        },
        name,
      );
    }
  });

  it("allows a single leading underscore", () => {
    assert.equal(validateEndpoints(["_alice", "_"]), undefined);
  });

  it("rejects a reserved word as an endpoint name (spec §keywords)", () => {
    for (const name of ["while", "class", "integer", "function", "null"]) {
      assert.deepEqual(
        validateEndpoints(["alice", name]),
        { message: `endpoint ${JSON.stringify(name)} is not a valid identifier`, spec: IDENTIFIER_RULES },
        name,
      );
    }
  });

  it("checks 'every' before shape, for the more specific message", () => {
    // `every` is a reserved word too, so the generic shape check would also
    // catch it — with a message that does not say why (spec §choreobs-json).
    assert.deepEqual(
      validateEndpoints(["every"]),
      {
        message: "'every' must not appear in endpoints",
        spec: ["choreobs-json", "using-every-as-an-endpoint"],
      },
    );
  });

  it("checks 'every' before duplicates", () => {
    assert.deepEqual(
      validateEndpoints(["alice", "alice", "every"]),
      {
        message: "'every' must not appear in endpoints",
        spec: ["choreobs-json", "using-every-as-an-endpoint"],
      },
    );
  });
});

/** A `choreobs.json` with `endpoints`, each a host endpoint unless written out. */
function config(endpoints: readonly (string | object)[], extra: object = {}): string {
  return JSON.stringify({
    name: "test",
    ...extra,
    endpoints: endpoints.map((e) => (typeof e === "string" ? { name: e, board: "host" } : e)),
  });
}

/** `loadConfig` on `contents` throws a ConfigError with `message` (after the path) and `spec`. */
function rejects(contents: string, message: string | RegExp, spec: readonly string[] = ["choreobs-json"]): void {
  withConfig(contents, (path) => {
    assert.throws(
      () => loadConfig(path),
      (e: Error) => {
        assert.ok(e instanceof ConfigError, String(e));
        if (typeof message === "string") {
          assert.equal(e.message, `${path}: ${message}`);
        } else {
          assert.match(e.message, message);
        }
        assert.deepEqual(e.spec, spec);
        return true;
      },
    );
  });
}

describe("config — loadConfig (spec §choreobs-json)", () => {
  it("loads a valid config", () => {
    const loaded = withConfig(
      config([{ name: "alice", board: "host" }, { name: "bob", board: "esp32", deviceName: "BOB" }]),
      loadConfig,
    );
    assert.deepEqual(loaded, {
      name: "test",
      endpoints: [
        { name: "alice", board: "host" },
        { name: "bob", board: "esp32", deviceName: "BOB" },
      ],
    });
    assert.deepEqual(compilerConfig(loaded), { endpoints: ["alice", "bob"] });
  });

  it("prefixes an endpoint-set error with the config path", () => {
    rejects(config(["alice", "alice"]), "duplicate endpoint 'alice' in endpoints");
  });

  it("rejects 'every' with the config path", () => {
    rejects(config(["every"]), "'every' must not appear in endpoints", ["choreobs-json", "using-every-as-an-endpoint"]);
  });

  it("rejects 'dyn' as an endpoint name (spec §using-every-as-an-endpoint)", () => {
    assert.deepEqual(validateEndpoints(["alice", "dyn"]), {
      message: "'dyn' must not appear in endpoints",
      spec: ["choreobs-json", "using-every-as-an-endpoint"],
    });
  });

  it("rejects names that differ only in case", () => {
    rejects(config(["Alice", "alice"]), "endpoints 'Alice' and 'alice' differ only in case");
  });

  it("reads implicitDyn, and leaves it out when absent (spec §strict-mode)", () => {
    withConfig(config(["alice"], { implicitDyn: false }), (path) => {
      assert.equal(loadConfig(path).implicitDyn, false);
      assert.deepEqual(compilerConfig(loadConfig(path)), { endpoints: ["alice"], implicitDyn: false });
    });
    withConfig(config(["alice"]), (path) => {
      assert.ok(!("implicitDyn" in loadConfig(path)));
      assert.deepEqual(compilerConfig(loadConfig(path)), { endpoints: ["alice"] });
    });
  });

  it("rejects a non-boolean implicitDyn (spec §invalid-implicit-dyn)", () => {
    rejects(config(["alice"], { implicitDyn: "no" }), `"implicitDyn" must be a boolean`, ["choreobs-json", "invalid-implicit-dyn"]);
  });

  it("requires a non-empty name", () => {
    for (const name of [undefined, "", 3]) {
      rejects(JSON.stringify({ name, endpoints: [] }), `"name" must be a non-empty string`);
    }
  });

  it("rejects a document that is not an object, or not JSON", () => {
    rejects("[]", "config must be a JSON object");
    withConfig("{", (path) => {
      assert.throws(() => loadConfig(path), (e: Error) => e instanceof ConfigError && e.message.startsWith(`${path}: `));
    });
  });

  it("rejects a non-array endpoints field", () => {
    rejects(JSON.stringify({ name: "test", endpoints: "alice" }), `"endpoints" must be an array of endpoint objects`);
  });

  it("rejects the bare-string entries of earlier versions, saying how to write them", () => {
    rejects(
      JSON.stringify({ name: "test", endpoints: ["alice"] }),
      `endpoint "alice" is a bare string, the format of earlier versions; write it as { "name": "alice", "board": "host" } (or "esp32")`,
    );
  });

  it("rejects an entry that is not an object, or has no string name", () => {
    rejects(JSON.stringify({ name: "test", endpoints: [1] }), `each endpoint must be an object with a "name" and a "board"`);
    rejects(config([{ name: 1, board: "host" }]), `each endpoint's "name" must be a string`);
  });

  it("requires a known board", () => {
    rejects(config([{ name: "alice" }]), `endpoint "alice": "board" must be "esp32" or "host"`);
    rejects(config([{ name: "alice", board: "arduino" }]), `endpoint "alice": "board" must be "esp32" or "host"`);
  });

  it("allows a deviceName on an esp32 endpoint only, and only a non-empty string", () => {
    rejects(config([{ name: "alice", board: "host", deviceName: "A" }]), `endpoint "alice": "deviceName" is only for an "esp32" endpoint`);
    rejects(config([{ name: "alice", board: "esp32", deviceName: "" }]), `endpoint "alice": "deviceName" must be a non-empty string`);
    rejects(config([{ name: "alice", board: "esp32", deviceName: 7 }]), `endpoint "alice": "deviceName" must be a non-empty string`);
  });

  it("rejects two esp32 endpoints with one device name, a missing one counting as BLUESCRIPT", () => {
    rejects(
      config([{ name: "a", board: "esp32" }, { name: "b", board: "esp32" }]),
      `endpoints 'a' and 'b' have the same device name 'BLUESCRIPT'; give each esp32 endpoint a "deviceName" of its own`,
    );
    rejects(
      config([{ name: "a", board: "esp32", deviceName: "BLUESCRIPT" }, { name: "b", board: "esp32" }]),
      /endpoints 'a' and 'b' have the same device name 'BLUESCRIPT'/,
    );
    rejects(
      config([{ name: "a", board: "esp32", deviceName: "X" }, { name: "b", board: "esp32", deviceName: "X" }]),
      /endpoints 'a' and 'b' have the same device name 'X'/,
    );
  });

  it("lets host endpoints share the absence of a device name", () => {
    assert.equal(
      validateDeviceNames([
        { name: "a", board: "host" },
        { name: "b", board: "host" },
        { name: "c", board: "esp32" },
      ]),
      undefined,
    );
  });
});

describe("config — findProjectRoot (spec §input-files)", () => {
  it("finds choreobs.json in the directory itself or the nearest parent", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "choreobs-root-")));
    try {
      writeFileSync(join(root, "choreobs.json"), config([]), "utf8");
      mkdirSync(join(root, "src", "deep"), { recursive: true });
      assert.equal(findProjectRoot(root), root);
      assert.equal(findProjectRoot(join(root, "src", "deep")), root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when no directory up to the root holds one", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "choreobs-none-")));
    try {
      assert.throws(
        () => findProjectRoot(dir),
        (e: Error) => e instanceof ConfigError && /cannot find choreobs\.json/.test(e.message),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addEndpoint, CommandError, createProject, runProject, writeProject } from "../../src/workspace/index.js";
import { ConfigError } from "../../src/config/index.js";
import {
  FakeBscript,
  readJson,
  scaffold,
  withTempDir,
  withTempDirAsync,
  writeFiles,
} from "../support/project.js";

/** A prompt that must not be reached. */
const noPrompt = async (): Promise<never> => {
  throw new Error("prompted");
};

/** A new project at `root/p` made by `choreobs create`. */
function created(root: string, bscript = new FakeBscript()): { project: string; bscript: FakeBscript } {
  const project = createProject(root, "p", bscript);
  return { project, bscript };
}

describe("choreobs create (spec §commands)", () => {
  it("makes choreobs.json, an empty src/index.cbs, and the workspace", () => {
    withTempDir((root) => {
      const { project, bscript } = created(root);
      assert.equal(project, join(root, "p"));
      assert.equal(readFileSync(join(project, "choreobs.json"), "utf8"), `{\n  "name": "p",\n  "endpoints": []\n}\n`);
      assert.equal(readFileSync(join(project, "src/index.cbs"), "utf8"), "");
      assert.deepEqual(bscript.commands(project), [".$ bscript workspace create workspace"]);
      assert.ok(existsSync(join(project, "workspace/bsworkspace.json")));
      // An empty project compiles to nothing, and writes nothing.
      assert.deepEqual(writeProject(project).errors, []);
    });
  });

  it("rejects a name that is not one directory, and a directory that exists", () => {
    withTempDir((root) => {
      for (const name of ["", ".", "..", "a/b", "a\\b"]) {
        assert.throws(() => createProject(root, name, new FakeBscript()), CommandError, name);
      }
      mkdirSync(join(root, "p"));
      assert.throws(() => createProject(root, "p", new FakeBscript()), /already exists/);
    });
  });

  it("makes nothing when bscript is not installed", () => {
    withTempDir((root) => {
      const bscript = new FakeBscript();
      bscript.installed = false;
      assert.throws(() => createProject(root, "p", bscript), /bscript.*is not on PATH/);
      assert.ok(!existsSync(join(root, "p")));
    });
  });

  it("keeps the project when bscript fails, and says add-endpoint makes the workspace", () => {
    withTempDir((root) => {
      const bscript = new FakeBscript();
      bscript.failOn = "workspace create";
      assert.throws(() => createProject(root, "p", bscript), /add-endpoint` makes it/);
      assert.ok(existsSync(join(root, "p/choreobs.json")));
    });
  });
});

describe("choreobs add-endpoint (spec §commands)", () => {
  it("makes the project, registers it, and adds the endpoint to choreobs.json last", async () => {
    await withTempDirAsync(async (root) => {
      const { project, bscript } = created(root);
      const result = await addEndpoint(project, { name: "alice", board: "host" }, bscript, noPrompt);
      assert.equal(result.added, true);
      assert.deepEqual(result.endpoint, { name: "alice", board: "host" });
      assert.deepEqual(bscript.commands(project).slice(1), [
        "workspace$ bscript project create alice -b host",
        "workspace$ bscript workspace add alice",
      ]);
      assert.deepEqual(readJson(join(project, "choreobs.json")).endpoints, [{ name: "alice", board: "host" }]);
      assert.deepEqual(readJson(join(project, "workspace/bsworkspace.json")).projects, [{ path: "./alice" }]);
    });
  });

  it("passes the device name of an esp32 endpoint to bscript and to choreobs.json", async () => {
    await withTempDirAsync(async (root) => {
      const { project, bscript } = created(root);
      await addEndpoint(project, { name: "bob", board: "esp32", deviceName: "BOB" }, bscript, noPrompt);
      assert.equal(bscript.commands(project).at(-1), "workspace$ bscript workspace add bob -d BOB");
      assert.deepEqual(readJson(join(project, "choreobs.json")).endpoints, [{ name: "bob", board: "esp32", deviceName: "BOB" }]);
    });
  });

  it("asks for the board when -b is left out", async () => {
    await withTempDirAsync(async (root) => {
      const { project, bscript } = created(root);
      const asked: string[] = [];
      await addEndpoint(project, { name: "alice" }, bscript, async (name) => {
        asked.push(name);
        return "esp32";
      });
      assert.deepEqual(asked, ["alice"]);
      assert.deepEqual(readJson(join(project, "choreobs.json")).endpoints, [{ name: "alice", board: "esp32" }]);
    });
  });

  it("keeps choreobs.json's other keys, in their order", async () => {
    await withTempDirAsync(async (root) => {
      const { project, bscript } = created(root);
      writeFileSync(join(project, "choreobs.json"), `{"implicitDyn": false, "name": "p", "endpoints": [], "note": 1}`);
      await addEndpoint(project, { name: "alice", board: "host" }, bscript, noPrompt);
      assert.equal(
        readFileSync(join(project, "choreobs.json"), "utf8"),
        `{\n  "implicitDyn": false,\n  "name": "p",\n  "endpoints": [\n    {\n      "name": "alice",\n      "board": "host"\n    }\n  ],\n  "note": 1\n}\n`,
      );
    });
  });

  it("rejects what would make choreobs.json invalid, before it asks or runs anything", async () => {
    await withTempDirAsync(async (root) => {
      const { project, bscript } = created(root);
      await addEndpoint(project, { name: "Alice", board: "esp32" }, bscript, noPrompt);
      const calls = bscript.calls.length;
      for (const options of [
        { name: "while" },
        { name: "alice" },
        { name: "__x" },
        { name: "bob", board: "arduino" },
        { name: "bob", board: "host", deviceName: "B" },
        { name: "bob", board: "esp32" },
      ]) {
        await assert.rejects(addEndpoint(project, options, bscript, noPrompt), ConfigError, JSON.stringify(options));
      }
      assert.equal(bscript.calls.length, calls);
      assert.equal(readJson(join(project, "choreobs.json")).endpoints.length, 1);
    });
  });

  it("makes the workspace when it is missing", async () => {
    await withTempDirAsync(async (root) => {
      writeFiles(root, { "choreobs.json": { name: "p", endpoints: [] }, "src/index.cbs": "" });
      const bscript = new FakeBscript();
      const result = await addEndpoint(root, { name: "alice", board: "host" }, bscript, noPrompt);
      assert.deepEqual(bscript.commands(root), [
        ".$ bscript workspace create workspace",
        "workspace$ bscript project create alice -b host",
        "workspace$ bscript workspace add alice",
      ]);
      assert.equal(result.done[0], "made the workspace workspace/");
    });
  });

  it("repairs a listed endpoint: makes only what is missing, asks nothing, leaves choreobs.json", async () => {
    await withTempDirAsync(async (root) => {
      scaffold(root, [{ name: "alice", board: "host" }, { name: "bob", board: "esp32", deviceName: "BOB" }]);
      rmSync(join(root, "workspace"), { recursive: true });
      const before = readFileSync(join(root, "choreobs.json"), "utf8");
      const bscript = new FakeBscript();
      for (const name of ["alice", "bob"]) {
        const result = await addEndpoint(root, { name }, bscript, noPrompt);
        assert.equal(result.added, false);
      }
      assert.deepEqual(bscript.commands(root), [
        ".$ bscript workspace create workspace",
        "workspace$ bscript project create alice -b host",
        "workspace$ bscript workspace add alice",
        "workspace$ bscript project create bob -b esp32",
        "workspace$ bscript workspace add bob -d BOB",
      ]);
      assert.equal(readFileSync(join(root, "choreobs.json"), "utf8"), before);
      assert.deepEqual(writeProject(root).errors, []);
    });
  });

  it("does nothing for a listed endpoint whose project is complete", async () => {
    await withTempDirAsync(async (root) => {
      scaffold(root, [{ name: "alice", board: "host" }]);
      const bscript = new FakeBscript();
      bscript.installed = false;
      const result = await addEndpoint(root, { name: "alice", board: "host" }, bscript, noPrompt);
      assert.deepEqual(result.done, []);
      assert.deepEqual(bscript.calls, []);
    });
  });

  it("rejects a -b or -d that disagrees with choreobs.json for a listed endpoint", async () => {
    await withTempDirAsync(async (root) => {
      scaffold(root, [{ name: "alice", board: "host" }, { name: "bob", board: "esp32" }]);
      const bscript = new FakeBscript();
      await assert.rejects(addEndpoint(root, { name: "alice", board: "esp32" }, bscript, noPrompt), /already in choreobs.json with board 'host'/);
      await assert.rejects(addEndpoint(root, { name: "alice", deviceName: "A" }, bscript, noPrompt), /has no device name/);
      await assert.rejects(addEndpoint(root, { name: "bob", deviceName: "B" }, bscript, noPrompt), /device name 'BLUESCRIPT', not 'B'/);
      // The default, written out, agrees with leaving it out.
      await addEndpoint(root, { name: "bob", deviceName: "BLUESCRIPT" }, bscript, noPrompt);
    });
  });

  it("takes over a matching project left by an earlier attempt, and registers it", async () => {
    await withTempDirAsync(async (root) => {
      const { project, bscript } = created(root);
      bscript.failOn = "workspace add";
      await assert.rejects(addEndpoint(project, { name: "alice", board: "host" }, bscript, noPrompt), CommandError);
      // The project was made, but the endpoint is not in choreobs.json yet.
      assert.ok(existsSync(join(project, "workspace/alice/bsconfig.json")));
      assert.deepEqual(readJson(join(project, "choreobs.json")).endpoints, []);
      bscript.failOn = undefined;
      const result = await addEndpoint(project, { name: "alice", board: "host" }, bscript, noPrompt);
      assert.deepEqual(result.done, [
        "took over the existing BlueScript project workspace/alice",
        "registered workspace/alice in the workspace",
        "added endpoint 'alice' to choreobs.json",
      ]);
    });
  });

  it("checks everything before running bscript: a disagreeing project, registration, or workspace", async () => {
    await withTempDirAsync(async (root) => {
      const { project, bscript } = created(root);
      const ws = join(project, "workspace");
      bscript.run(["project", "create", "alice", "-b", "esp32"], ws);
      bscript.run(["project", "create", "radio", "-b", "esp32"], ws);
      bscript.run(["workspace", "add", "radio"], ws);
      mkdirSync(join(ws, "carol"));
      const calls = bscript.calls.length;
      await assert.rejects(addEndpoint(project, { name: "alice", board: "host" }, bscript, noPrompt), /is a project for board 'esp32'/);
      await assert.rejects(addEndpoint(project, { name: "bob", board: "esp32" }, bscript, noPrompt), /workspace\/radio is registered in the workspace with device name 'BLUESCRIPT'/);
      await assert.rejects(addEndpoint(project, { name: "carol", board: "host" }, bscript, noPrompt), /workspace\/carol exists but is not a BlueScript project/);
      assert.equal(bscript.calls.length, calls);

      rmSync(join(ws, "bsworkspace.json"));
      await assert.rejects(addEndpoint(project, { name: "dave", board: "host" }, bscript, noPrompt), /workspace\/ exists but has no bsworkspace\.json/);
      assert.equal(bscript.calls.length, calls);
      assert.deepEqual(readJson(join(project, "choreobs.json")).endpoints, []);
    });
  });

  it("refuses to register next to a registered project bscript cannot read", async () => {
    await withTempDirAsync(async (root) => {
      const { project, bscript } = created(root);
      const ws = join(project, "workspace");
      bscript.run(["project", "create", "old", "-b", "host"], ws);
      bscript.run(["workspace", "add", "old"], ws);
      rmSync(join(ws, "old"), { recursive: true });
      await assert.rejects(addEndpoint(project, { name: "alice", board: "host" }, bscript, noPrompt), /checks every registered project/);
    });
  });
});

describe("choreobs run (spec §commands)", () => {
  const TRANSFER = `let x: integer@alice = 1@alice;\nlet y: integer@bob <- x;\n`;

  it("writes the project, then runs every endpoint by name in the workspace", () => {
    withTempDir((root) => {
      scaffold(root, [{ name: "alice", board: "host" }, { name: "bob", board: "host" }], TRANSFER);
      const bscript = new FakeBscript();
      const seen: string[] = [];
      const result = runProject(root, bscript, (written) => {
        seen.push(`written ${written.written.length}`);
        assert.deepEqual(bscript.calls, [], "ran before reporting the write");
      });
      assert.deepEqual(result.errors, []);
      assert.deepEqual(seen, ["written 4"]);
      assert.match(readFileSync(join(root, "workspace/alice/src/index.bs"), "utf8"), /sendInteger/);
      assert.deepEqual(bscript.commands(root), ["workspace$ bscript workspace run alice bob"]);
    });
  });

  it("passes --stats to bscript only when asked", () => {
    withTempDir((root) => {
      scaffold(root, [{ name: "alice", board: "host" }, { name: "bob", board: "host" }], TRANSFER);
      const bscript = new FakeBscript();
      runProject(root, bscript, undefined, { stats: true });
      runProject(root, bscript, undefined, { stats: false });
      assert.deepEqual(bscript.commands(root), [
        "workspace$ bscript workspace run --stats alice bob",
        "workspace$ bscript workspace run alice bob",
      ]);
    });
  });

  it("leaves out a registered project that is no endpoint's", () => {
    withTempDir((root) => {
      const setup = scaffold(root, [{ name: "alice", board: "host" }, { name: "bob", board: "host" }], TRANSFER);
      setup.run(["project", "create", "old", "-b", "host"], join(root, "workspace"));
      setup.run(["workspace", "add", "old"], join(root, "workspace"));
      const bscript = new FakeBscript();
      const result = runProject(root, bscript);
      assert.equal(result.warnings.length, 1);
      assert.deepEqual(bscript.commands(root), ["workspace$ bscript workspace run alice bob"]);
    });
  });

  it("runs nothing when the program does not compile, or the workspace disagrees", () => {
    withTempDir((root) => {
      scaffold(root, [{ name: "alice", board: "host" }, { name: "bob", board: "host" }], `let x: integer@alice = true@alice;`);
      const bscript = new FakeBscript();
      assert.ok(runProject(root, bscript).errors.length > 0);
      rmSync(join(root, "workspace/bob"), { recursive: true });
      writeFileSync(join(root, "src/index.cbs"), TRANSFER);
      assert.ok(runProject(root, bscript).errors.length > 0);
      assert.deepEqual(bscript.calls, []);
    });
  });

  it("checks for bscript before it writes anything", () => {
    withTempDir((root) => {
      scaffold(root, [{ name: "alice", board: "host" }], `let x: integer@alice = 1@alice;`);
      const bscript = new FakeBscript();
      bscript.installed = false;
      assert.throws(() => runProject(root, bscript), /bscript.*is not on PATH/);
      assert.equal(readFileSync(join(root, "workspace/alice/src/index.bs"), "utf8"), `console.log("Hello world!");\n`);
    });
  });

  it("fails for a project without endpoints, and when bscript fails", () => {
    withTempDir((root) => {
      const { project } = created(root);
      assert.throws(() => runProject(project, new FakeBscript()), /there is no endpoint to run/);
    });
    withTempDir((root) => {
      scaffold(root, [{ name: "alice", board: "host" }], `let x: integer@alice = 1@alice;`);
      const bscript = new FakeBscript();
      bscript.failOn = "workspace run";
      assert.throws(() => runProject(root, bscript), CommandError);
    });
  });
});

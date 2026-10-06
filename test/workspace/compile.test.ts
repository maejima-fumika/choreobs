import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeProject } from "../../src/workspace/index.js";
import { runtimeSource } from "../../src/runtime/source.js";
import { readJson, scaffold, withTempDir, writeFiles } from "../support/project.js";
import { aliceBob } from "../support/config.js";

const TRANSFER = `let x: integer@alice = 1@alice;\nlet y: integer@bob <- x;\n`;
const ALICE_BOB = [
  { name: "alice", board: "host" },
  { name: "bob", board: "host" },
] as const;

/** The messages of a failed `writeProject`, after checking that it wrote nothing. */
function failure(root: string): string[] {
  const result = writeProject(root);
  assert.ok(result.errors.length > 0, "expected errors");
  assert.deepEqual(result.written, []);
  for (const endpoint of ["alice", "bob"]) {
    assert.ok(!existsSync(join(root, "workspace", endpoint, "src", "__runtime.bs")), `${endpoint} was written`);
  }
  return result.errors.map((e) => e.message);
}

function editJson(path: string, edit: (data: any) => void): void {
  const data = readJson(path);
  edit(data);
  writeFileSync(path, JSON.stringify(data));
}

describe("choreobs compile — writing into the workspace (spec §output-files)", () => {
  it("writes each endpoint's program to its entry file, and its runtime file beside it", () => {
    withTempDir((root) => {
      scaffold(root, ALICE_BOB, TRANSFER);
      const result = writeProject(root);
      assert.deepEqual(result.errors, []);
      assert.deepEqual(result.warnings, []);
      assert.deepEqual(result.written, [
        join(root, "workspace/alice/src/index.bs"),
        join(root, "workspace/alice/src/__runtime.bs"),
        join(root, "workspace/bob/src/index.bs"),
        join(root, "workspace/bob/src/__runtime.bs"),
      ]);
      assert.match(readFileSync(join(root, "workspace/alice/src/index.bs"), "utf8"), /sendInteger\("bob", "__top_0", x\)/);
      assert.equal(readFileSync(join(root, "workspace/bob/src/__runtime.bs"), "utf8"), runtimeSource("bob", aliceBob.endpoints, false));
    });
  });

  it("leaves bscript's own files as they are", () => {
    withTempDir((root) => {
      scaffold(root, ALICE_BOB, TRANSFER);
      const files = ["workspace/bsworkspace.json", "workspace/alice/bsconfig.json", "workspace/alice/.gitignore"];
      const before = files.map((f) => readFileSync(join(root, f), "utf8"));
      assert.deepEqual(writeProject(root).errors, []);
      assert.deepEqual(files.map((f) => readFileSync(join(root, f), "utf8")), before);
    });
  });

  it("follows entryFile, BlueScript's default when there is none, and makes missing directories", () => {
    withTempDir((root) => {
      scaffold(root, ALICE_BOB, TRANSFER);
      editJson(join(root, "workspace/alice/bsconfig.json"), (c) => {
        c.entryFile = "./src/app/main.bs";
      });
      editJson(join(root, "workspace/bob/bsconfig.json"), (c) => {
        delete c.entryFile;
        delete c.srcDir;
      });
      assert.deepEqual(writeProject(root).errors, []);
      assert.ok(existsSync(join(root, "workspace/alice/src/app/main.bs")));
      assert.ok(existsSync(join(root, "workspace/alice/src/app/__runtime.bs")));
      assert.ok(existsSync(join(root, "workspace/bob/index.bs")));
      assert.ok(existsSync(join(root, "workspace/bob/__runtime.bs")));
    });
  });

  it("rejects an entry file under the compiler's prefix, or outside srcDir", () => {
    withTempDir((root) => {
      scaffold(root, ALICE_BOB, TRANSFER);
      editJson(join(root, "workspace/alice/bsconfig.json"), (c) => {
        c.entryFile = "./src/__runtime.bs";
      });
      editJson(join(root, "workspace/bob/bsconfig.json"), (c) => {
        c.entryFile = "./other/index.bs";
      });
      const messages = failure(root);
      assert.ok(messages.some((m) => /entry file workspace\/alice\/src\/__runtime\.bs begins with '__'/.test(m)), messages.join("\n"));
      assert.ok(messages.some((m) => /entry file workspace\/bob\/other\/index\.bs is not under .*workspace\/bob\/src/.test(m)), messages.join("\n"));
    });
  });

  it("writes nothing for a program that does not compile", () => {
    withTempDir((root) => {
      scaffold(root, ALICE_BOB, `let x: integer@alice = true@alice;`);
      const result = writeProject(root);
      assert.ok(result.errors.length > 0);
      assert.deepEqual(result.written, []);
      assert.equal(readFileSync(join(root, "workspace/alice/src/index.bs"), "utf8"), `console.log("Hello world!");\n`);
    });
  });

  it("fails without a workspace, and points at add-endpoint", () => {
    withTempDir((root) => {
      writeFiles(root, { "choreobs.json": { name: "t", endpoints: ALICE_BOB }, "src/index.cbs": TRANSFER });
      const result = writeProject(root);
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0]!.message, /there is no workspace.*choreobs add-endpoint/);
    });
  });

  it("fails for a workspace/ that is not a BlueScript workspace", () => {
    withTempDir((root) => {
      writeFiles(root, { "choreobs.json": { name: "t", endpoints: ALICE_BOB }, "src/index.cbs": TRANSFER, "workspace/x": "" });
      const result = writeProject(root);
      assert.match(result.errors[0]!.message, /workspace\/ exists but has no bsworkspace\.json/);
    });
  });

  it("fails for an endpoint without a project, or with one that is not registered", () => {
    withTempDir((root) => {
      scaffold(root, ALICE_BOB, TRANSFER);
      rmSync(join(root, "workspace/alice"), { recursive: true });
      editJson(join(root, "workspace/bsworkspace.json"), (w) => {
        w.projects = [];
      });
      const messages = failure(root);
      assert.ok(messages.some((m) => /endpoint 'alice' has no BlueScript project.*choreobs add-endpoint alice/.test(m)));
      assert.ok(messages.some((m) => /endpoint 'bob's project workspace\/bob is not registered.*choreobs add-endpoint bob/.test(m)));
    });
  });

  it("fails where the project disagrees with choreobs.json: project name, board, device name", () => {
    withTempDir((root) => {
      scaffold(root, [{ name: "alice", board: "host" }, { name: "bob", board: "esp32", deviceName: "BOB" }], TRANSFER);
      editJson(join(root, "choreobs.json"), (c) => {
        c.endpoints[1].deviceName = "B2";
      });
      editJson(join(root, "workspace/alice/bsconfig.json"), (c) => {
        c.projectName = "alicia";
        c.boardName = "esp32";
      });
      const messages = failure(root);
      assert.ok(messages.some((m) => /names the project 'alicia'/.test(m)), messages.join("\n"));
      assert.ok(messages.some((m) => /is a project for board 'esp32', but choreobs.json's endpoint 'alice' says 'host'/.test(m)));
      assert.ok(messages.some((m) => /registers workspace\/bob with device name 'BOB', but choreobs.json's endpoint 'bob' says 'B2'/.test(m)));
    });
  });

  it("counts a missing device name as BLUESCRIPT on either side", () => {
    withTempDir((root) => {
      scaffold(root, [{ name: "alice", board: "host" }, { name: "bob", board: "esp32", deviceName: "BLUESCRIPT" }], TRANSFER);
      editJson(join(root, "choreobs.json"), (c) => {
        delete c.endpoints[1].deviceName;
      });
      assert.deepEqual(writeProject(root).errors, []);
    });
  });

  it("matches a registration by resolved path, as bscript does", () => {
    withTempDir((root) => {
      scaffold(root, ALICE_BOB, TRANSFER);
      editJson(join(root, "workspace/bsworkspace.json"), (w) => {
        w.projects = [{ path: "alice" }, { path: join(root, "workspace", "bob") }];
      });
      assert.deepEqual(writeProject(root).errors, []);
    });
  });

  it("warns about a registered project that is no endpoint's, and writes all the same", () => {
    withTempDir((root) => {
      const bscript = scaffold(root, ALICE_BOB, TRANSFER);
      bscript.run(["project", "create", "old", "-b", "host"], join(root, "workspace"));
      bscript.run(["workspace", "add", "old"], join(root, "workspace"));
      const result = writeProject(root);
      assert.deepEqual(result.errors, []);
      assert.deepEqual(result.warnings, [
        "workspace/old is registered in the workspace but is no endpoint's; `choreobs run` leaves it out, but `bscript workspace run` on its own runs it",
      ]);
      assert.equal(result.written.length, 4);
    });
  });

  it("fails where another registered project takes an endpoint's project name or device name", () => {
    withTempDir((root) => {
      const bscript = scaffold(root, [{ name: "alice", board: "host" }, { name: "bob", board: "esp32", deviceName: "BOB" }], TRANSFER);
      const ws = join(root, "workspace");
      bscript.run(["project", "create", "old", "-b", "host"], ws);
      bscript.run(["workspace", "add", "old"], ws);
      bscript.run(["project", "create", "radio", "-b", "esp32"], ws);
      bscript.run(["workspace", "add", "radio", "-d", "BOB"], ws);
      editJson(join(ws, "old/bsconfig.json"), (c) => {
        c.projectName = "alice";
      });
      const messages = failure(root);
      assert.ok(messages.some((m) => /workspace\/old is registered in the workspace under the project name 'alice'/.test(m)), messages.join("\n"));
      assert.ok(messages.some((m) => /workspace\/radio is registered in the workspace with device name 'BOB'/.test(m)));
    });
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { addEndpoint, installPackages, writeProject } from "../../src/workspace/index.js";
import { FakeBscript, projectConfig, readJson, scaffold, withTempDir, withTempDirAsync, writeFiles } from "../support/project.js";

const THERMO = "https://example.com/bs-thermo.git";
const UNITS = "https://example.com/bs-units.git";
const GPIO = "https://example.com/bs-gpio-esp32.git";
const CLOCK = "https://example.com/bs-clock.git";

/** Teaches `bscript` the packages: `thermo`, which depends on `units`; an esp32 `gpio`; and `bs-clock`. */
function withPackages(bscript: FakeBscript): FakeBscript {
  bscript.packages.set(THERMO, {
    projectName: "thermo",
    boardName: "host",
    files: { "index.bs": "import { scale } from 'units';\nexport class Thermometer {}\n" },
    dependencies: { units: UNITS },
  });
  bscript.packages.set(UNITS, { projectName: "units", boardName: "host", files: { "index.bs": "export const scale: float = 1.0;\n" } });
  bscript.packages.set(GPIO, { projectName: "gpio", boardName: "esp32" });
  bscript.packages.set(CLOCK, { projectName: "bs-clock", boardName: "host" });
  return bscript;
}

/** A source file that imports `thermo`, and a program that imports from it. */
const WRAPPER = {
  "src/thermo@alice.bs":
    "import { Thermometer } from 'thermo';\nconst t = new Thermometer();\nexport function readCelsius(): float {\n  return 21.5;\n}\n",
};
const PROGRAM = `import@alice { readCelsius } from "./thermo@alice";\nlet t: float@alice = readCelsius();\nlet u: float@bob <- t;\n`;

/** alice lists `dependencies`; bob lists none. Nothing is installed yet. */
function project(root: string, dependencies: Record<string, string>): FakeBscript {
  const bscript = withPackages(
    scaffold(root, [{ name: "alice", board: "host", dependencies }, { name: "bob", board: "host" }], PROGRAM),
  );
  writeFiles(root, WRAPPER);
  bscript.calls.length = 0;
  return bscript;
}

function setDependencies(root: string, endpoint: string, dependencies: Record<string, string> | undefined): void {
  const path = join(root, "choreobs.json");
  const config = readJson(path);
  const entry = config.endpoints.find((e: { name: string }) => e.name === endpoint);
  if (dependencies === undefined) {
    delete entry.dependencies;
  } else {
    entry.dependencies = dependencies;
  }
  writeFiles(root, { "choreobs.json": config });
}

function errorsOf(root: string): string[] {
  const result = writeProject(root);
  assert.deepEqual(result.written, []);
  return result.errors.map((e) => e.message);
}

describe("choreobs install (spec §commands, §bluescript-packages)", () => {
  it("installs each listed package, with its tag; compile then writes the source file that imports it", () => {
    withTempDir((root) => {
      const bscript = project(root, { thermo: `${THERMO}#v1.0.0` });
      assert.deepEqual(errorsOf(root), [
        "endpoint 'alice's packages are not the ones choreobs.json lists: " +
          "'thermo' is not installed as listed (bsconfig.json does not list it); run `choreobs install`",
      ]);

      assert.deepEqual(installPackages(root, bscript).done, [
        `installed package 'thermo' (${THERMO}#v1.0.0) in workspace/alice`,
      ]);
      assert.deepEqual(bscript.commands(root), [`workspace/alice$ bscript project install ${THERMO} -t v1.0.0`]);
      assert.deepEqual(readJson(join(root, "workspace/alice/bsconfig.json")).dependencies, { thermo: `${THERMO}#v1.0.0` });
      // What `thermo` depends on is installed beside it, and not listed.
      assert.ok(existsSync(join(root, "workspace/alice/packages/units/index.bs")));

      const result = writeProject(root);
      assert.deepEqual(result.errors, []);
      assert.ok(result.written.includes(join(root, "workspace/alice/src/thermo@alice.bs")));
      assert.match(readFileSync(join(root, "workspace/alice/src/index.bs"), "utf8"), /^import \{ readCelsius \} from "\.\/thermo@alice";$/m);
    });
  });

  it("runs no bscript when every package is installed, and needs none", () => {
    withTempDir((root) => {
      const bscript = project(root, { thermo: THERMO });
      installPackages(root, bscript);
      bscript.calls.length = 0;
      bscript.installed = false;
      assert.deepEqual(installPackages(root, bscript).done, []);
      assert.deepEqual(bscript.calls, []);
    });
  });

  it("uninstalls what choreobs.json does not list, and installs again what it lists otherwise", () => {
    withTempDir((root) => {
      const bscript = project(root, { thermo: `${THERMO}#v1.0.0` });
      installPackages(root, bscript);
      setDependencies(root, "alice", { thermo: THERMO });
      bscript.run(["project", "install", CLOCK], join(root, "workspace/bob"));
      assert.match(errorsOf(root).join("\n"), /'thermo' is not installed as listed \(bsconfig.json lists it as ".*#v1.0.0"\)/);
      assert.match(errorsOf(root).join("\n"), /endpoint 'bob's packages .*'bs-clock' is installed but not listed in choreobs.json/);

      bscript.calls.length = 0;
      assert.deepEqual(installPackages(root, bscript).done, [
        `installed package 'thermo' (${THERMO}) in workspace/alice`,
        "uninstalled package 'bs-clock' from workspace/bob",
      ]);
      assert.deepEqual(bscript.commands(root), [
        `workspace/alice$ bscript project install ${THERMO}`,
        "workspace/bob$ bscript project uninstall bs-clock",
      ]);
      assert.ok(!existsSync(join(root, "workspace/bob/packages/bs-clock")));
      assert.deepEqual(writeProject(root).errors, []);
    });
  });

  it("installs again a package whose directory is gone", () => {
    withTempDir((root) => {
      const bscript = project(root, { thermo: THERMO });
      installPackages(root, bscript);
      rmSync(join(root, "workspace/alice/packages/thermo"), { recursive: true });
      assert.match(errorsOf(root).join("\n"), /'thermo' is not installed as listed \(workspace\/alice\/packages\/thermo does not exist\)/);
      bscript.calls.length = 0;
      installPackages(root, bscript);
      assert.deepEqual(bscript.commands(root), [`workspace/alice$ bscript project install ${THERMO}`]);
    });
  });

  it("stops when bscript names the package otherwise, saying which name to write", () => {
    withTempDir((root) => {
      const bscript = project(root, { clock: CLOCK });
      assert.throws(
        () => installPackages(root, bscript),
        /the package at ".*bs-clock.git" is named 'bs-clock', not 'clock': .*write 'bs-clock' as its name in choreobs.json's endpoint 'alice'/,
      );
      setDependencies(root, "alice", { "bs-clock": CLOCK });
      bscript.calls.length = 0;
      assert.deepEqual(installPackages(root, bscript).done, []);
    });
  });

  it("stops at a package for another board, before running bscript the next time", () => {
    withTempDir((root) => {
      const bscript = project(root, { gpio: GPIO });
      assert.throws(
        () => installPackages(root, bscript),
        /workspace\/alice\/packages\/gpio is a package for board 'esp32', but endpoint 'alice' runs on 'host'/,
      );
      bscript.calls.length = 0;
      assert.throws(() => installPackages(root, bscript), /is a package for board 'esp32'/);
      assert.deepEqual(bscript.calls, []);
      assert.match(errorsOf(root).join("\n"), /is a package for board 'esp32'/);
    });
  });

  it("needs every endpoint's project and the workspace, and checks for bscript when it has work", () => {
    withTempDir((root) => {
      const bscript = project(root, { thermo: THERMO });
      bscript.installed = false;
      assert.throws(() => installPackages(root, bscript), /bscript.*is not on PATH/);

      rmSync(join(root, "workspace/bob"), { recursive: true });
      assert.throws(() => installPackages(root, bscript), /endpoint 'bob' has no BlueScript project: .*run `choreobs add-endpoint bob`/);
      rmSync(join(root, "workspace"), { recursive: true });
      assert.throws(() => installPackages(root, bscript), /there is no workspace/);
      assert.deepEqual(bscript.calls, []);
    });
  });
});

describe("choreobs add-endpoint installs a listed endpoint's packages (spec §commands)", () => {
  it("makes the project and installs what choreobs.json lists, after registering it", async () => {
    await withTempDirAsync(async (root) => {
      writeFiles(root, {
        "choreobs.json": projectConfig([{ name: "alice", board: "host", dependencies: { thermo: `${THERMO}#v2` } }]),
        "src/index.cbs": "",
      });
      const bscript = withPackages(new FakeBscript());
      const result = await addEndpoint(root, { name: "alice" }, bscript, async () => {
        throw new Error("prompted");
      });
      assert.deepEqual(bscript.commands(root), [
        ".$ bscript workspace create workspace",
        "workspace$ bscript project create alice -b host",
        "workspace$ bscript workspace add alice",
        `workspace/alice$ bscript project install ${THERMO} -t v2`,
      ]);
      assert.equal(result.done.at(-1), `installed package 'thermo' (${THERMO}#v2) in workspace/alice`);
      assert.deepEqual(writeProject(root).errors, []);
    });
  });

  it("leaves a package choreobs.json does not list to choreobs install", async () => {
    await withTempDirAsync(async (root) => {
      const bscript = project(root, {});
      bscript.run(["project", "install", CLOCK], join(root, "workspace/alice"));
      bscript.calls.length = 0;
      const result = await addEndpoint(root, { name: "alice" }, bscript, async () => {
        throw new Error("prompted");
      });
      assert.deepEqual(result.done, []);
      assert.deepEqual(bscript.calls, []);
      assert.match(errorsOf(root).join("\n"), /'bs-clock' is installed but not listed in choreobs.json; run `choreobs install`/);
    });
  });

  it("stops at a package for another board before running bscript", async () => {
    await withTempDirAsync(async (root) => {
      const bscript = project(root, { gpio: GPIO });
      bscript.run(["project", "install", GPIO], join(root, "workspace/alice"));
      bscript.calls.length = 0;
      await assert.rejects(
        addEndpoint(root, { name: "alice" }, bscript, async () => {
          throw new Error("prompted");
        }),
        /is a package for board 'esp32'/,
      );
      assert.deepEqual(bscript.calls, []);
    });
  });
});

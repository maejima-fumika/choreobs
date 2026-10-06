import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import {
  readSourceFiles,
  sourceFileOwner,
  sourceFilesFor,
  validateSourceFiles,
} from "../../src/local-imports/index.js";
import type { SpecId } from "../../src/spec/ref.js";
import { sourceFiles } from "../support/compile.js";
import { withTempDir, writeFiles } from "../support/project.js";

const ENDPOINTS = ["alice", "bob"];

/** `paths` as source files with empty text. */
function files(...paths: string[]) {
  return sourceFiles(Object.fromEntries(paths.map((p) => [p, ""])));
}

function rejected(paths: string[], message: string, spec: SpecId): void {
  const problem = validateSourceFiles(files(...paths), ENDPOINTS);
  assert.ok(problem, `expected ${paths.join(", ")} to be rejected`);
  assert.ok(problem.message.includes(message), problem.message);
  assert.ok(problem.spec.includes(spec), JSON.stringify(problem.spec));
  assert.equal(problem.span, undefined);
}

describe("BlueScript source files (spec §bluescript-source-files)", () => {
  describe("names (spec §bluescript-source-file-names)", () => {
    it("accepts names like identifiers, with '-', and an endpoint after '@'", () => {
      assert.equal(
        validateSourceFiles(files("clock.bs", "sensor@alice.bs", "filters/smooth-2.bs", "_private/x_y.bs", "a/b/c@bob.bs"), ENDPOINTS),
        undefined,
      );
    });

    it("rejects an unknown endpoint, `every` and `dyn` after '@'", () => {
      rejected(["sensor@carol.bs"], "'carol' is not an endpoint listed in choreobs.json", "invalid-bluescript-file-name");
      rejected(["sensor@every.bs"], "'every' is not an individual location", "invalid-bluescript-file-name");
      rejected(["sensor@dyn.bs"], "'dyn' is not an individual location", "invalid-bluescript-file-name");
    });

    it("rejects two '@'s, nothing before '@', and '@' in a directory", () => {
      rejected(["a@b@alice.bs"], "has more than one '@'", "invalid-bluescript-file-name");
      rejected(["@alice.bs"], "has no name before '@'", "invalid-bluescript-file-name");
      rejected(["lib@alice/x.bs"], "a directory's name may not contain '@'", "invalid-bluescript-file-name");
    });

    it("rejects a name that begins with a digit or holds a character a build would choke on", () => {
      rejected(["1st.bs"], "the file name '1st' must begin with a letter or '_'", "invalid-bluescript-file-name");
      rejected(["123.bs"], "the file name '123'", "invalid-bluescript-file-name");
      rejected(["my clock.bs"], "the file name 'my clock'", "invalid-bluescript-file-name");
      rejected(["lib.v2/x.bs"], "the directory name 'lib.v2'", "invalid-bluescript-file-name");
      rejected(["a.b.bs"], "the file name 'a.b'", "invalid-bluescript-file-name");
    });

    it("reserves the compiler's prefix on every name of the path (spec §reserved-input-file-name)", () => {
      rejected(["__util.bs"], "must not begin with '__'", "reserved-input-file-name");
      rejected(["__lib/clock.bs"], "must not begin with '__'", "reserved-input-file-name");
      rejected(["__runtime.bs"], "must not begin with '__'", "reserved-input-file-name");
    });

    it("rejects paths that differ only in case", () => {
      rejected(["Clock.bs", "clock.bs"], "differ only in case", "invalid-bluescript-file-name");
      rejected(["Lib/x.bs", "lib/x.bs"], "differ only in case", "invalid-bluescript-file-name");
    });
  });

  describe("where each file goes (spec §bluescript-source-file-copies)", () => {
    it("sends an endpoint-specific file to its endpoint alone, and a shared one to all", () => {
      assert.deepEqual(sourceFileOwner("clock.bs"), { kind: "shared" });
      assert.deepEqual(sourceFileOwner("lib/sensor@alice.bs"), { kind: "endpoint", endpoint: "alice" });
      const all = files("clock.bs", "lib/sensor@alice.bs", "motor@bob.bs");
      assert.deepEqual(sourceFilesFor("alice", all), ["clock.bs", "lib/sensor@alice.bs"]);
      assert.deepEqual(sourceFilesFor("bob", all), ["clock.bs", "motor@bob.bs"]);
    });
  });

  describe("reading src/", () => {
    it("reads every .bs file below it, in path order, and nothing else", () => {
      withTempDir((root) => {
        writeFiles(root, {
          "src/index.cbs": "",
          "src/zeta.bs": "z",
          "src/clock.bs": "c",
          "src/lib/filters/smooth.bs": "s",
          "src/notes.txt": "not a source file",
          "src/lib/native.c": "",
        });
        mkdirSync(join(root, "src", "empty"));
        symlinkSync(join(root, "src", "clock.bs"), join(root, "src", "link.bs"));
        const read = readSourceFiles(join(root, "src"));
        assert.deepEqual([...read.entries()], [
          ["clock.bs", "c"],
          ["lib/filters/smooth.bs", "s"],
          ["zeta.bs", "z"],
        ]);
      });
    });
  });
});

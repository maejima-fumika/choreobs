import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { join } from "node:path";
import { compileProject } from "../../src/driver/index.js";
import { assertNoChoreoResidue, bs, compile, expectSuccess, sourceFiles } from "../support/compile.js";
import { aliceBob } from "../support/config.js";
import { projectConfig, withTempDir, writeFiles } from "../support/project.js";
import { importsOf, inspectOutputs } from "../../scripts/fuzz/inspect.js";

const FILES = sourceFiles({
  "foo@alice.bs": "export function foo(): integer { return 1; }\nexport function foo2(x: integer): integer { return x; }\n",
  "bob/baa@bob.bs": "export function baa(): void {}\n",
  "now.bs": "export function now(): integer { return 0; }\n",
});

function compiled(source: string) {
  const result = compile(source, aliceBob, "index.cbs", FILES);
  expectSuccess(result);
  for (const out of result.outputs) {
    assertNoChoreoResidue(out.source, out.endpoint);
  }
  return result;
}

describe("local imports, end to end (spec §import-projection, §import-code-generation)", () => {
  it("keeps each import at its own endpoint, as written, less the location", () => {
    const result = compiled(`import@alice { foo as fooAtAlice, foo2 as fooA } from "./foo@alice";
import@bob { baa } from "./bob/baa@bob";
import@alice { now as nowAtAlice } from "./now";
import@bob { now as nowAtBob } from "./now";
`);
    assert.equal(bs(result, "alice"), `import { foo as fooAtAlice, foo2 as fooA } from "./foo@alice";
import { now as nowAtAlice } from "./now";`);
    assert.equal(bs(result, "bob"), `import { baa } from "./bob/baa@bob";
import { now as nowAtBob } from "./now";`);
  });

  it("projects calls and constants as those of a local function and constant there", () => {
    const result = compiled(`import@alice { foo2 } from "./foo@alice";
import@alice { now as nowAtAlice } from "./now";
import@bob { now as nowAtBob } from "./now";

let t: integer@alice = foo2(nowAtAlice());
let u: integer@bob <- t;
let v: integer@bob = nowAtBob() + u;
`);
    assert.equal(bs(result, "alice"), `import { foo2 } from "./foo@alice";
import { now as nowAtAlice } from "./now";

let t: integer = foo2(nowAtAlice());
sendInteger("bob", "__top_0", t);`);
    assert.equal(bs(result, "bob"), `import { now as nowAtBob } from "./now";

let u: integer = receiveInteger("alice", "__top_0");
let v: integer = nowAtBob() + u;`);
  });

  it("puts the runtime import first, and casts a dyn argument at every endpoint", () => {
    const result = compiled(`import@alice { foo2 } from "./foo@alice";
let d = 3;
let r: integer@alice = foo2(d);
`);
    assert.equal(bs(result, "alice"), `import { __DynVal, __dynUnbound, __cast, __loc_alice } from "./__runtime";
import { foo2 } from "./foo@alice";

let d: __DynVal = __dynUnbound(3);
let r: integer = foo2(__cast(d, __loc_alice));`);
    assert.equal(bs(result, "bob"), `import { __nothing1, __DynVal, __dynUnbound, __cast, __loc_alice } from "./__runtime";

let d: __DynVal = __dynUnbound(3);
__nothing1(__cast(d, __loc_alice));`);
    assert.deepEqual(importsOf(result.outputs[0]!.source), ["__DynVal", "__dynUnbound", "__cast", "__loc_alice"]);
    assert.equal(inspectOutputs(result, aliceBob.endpoints), undefined);
  });

  it("writes `name` for `name as name`", () => {
    const result = compiled(`import@alice { now as now } from "./now";\nlet x: integer@alice = now();`);
    assert.match(bs(result, "alice"), /^import \{ now \} from "\.\/now";\n\n/);
  });

  it("gives each endpoint the shared files and its own, in path order (spec §bluescript-source-file-copies)", () => {
    const result = compiled(`let x: integer@alice = 1@alice;`);
    assert.deepEqual(
      result.sourceFiles.map((f) => `${f.endpoint}:${f.path}`),
      ["alice:foo@alice.bs", "alice:now.bs", "bob:bob/baa@bob.bs", "bob:now.bs"],
    );
    assert.equal(result.sourceFiles[1]!.source, FILES.get("now.bs"));
  });

  it("reads the source files of a project from disk", () => {
    withTempDir((root) => {
      writeFiles(root, {
        "choreobs.json": projectConfig(["alice", "bob"]),
        "src/index.cbs": `import@bob { smooth } from "./filters/smooth";\nlet y: float@bob = smooth(1.0@bob);\n`,
        "src/filters/smooth.bs": "export function smooth(x: float): float { return x; }\n",
      });
      const result = compileProject(root);
      expectSuccess(result);
      assert.deepEqual([...result.files!.keys()], ["filters/smooth.bs"]);
      assert.match(result.outputs[1]!.source, /^import \{ smooth \} from "\.\/filters\/smooth";/);
      assert.equal(join(root, "src", "index.cbs"), result.sourcePath);
    });
  });
});

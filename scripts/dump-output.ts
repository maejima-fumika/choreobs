import { compileSource } from "../src/driver/compile.js";

const config = { participants: ["alice", "bob"] };

const sources: Record<string, string> = {
  "15.1": `
let x: integer@alice = 42@alice;
let y: integer@bob <~ x;
`,
  "15.2": `
let localOk: boolean@alice = true@alice;
let ok: boolean@every <~ localOk;

if (ok) {
    let msg: string@bob = "ok"@bob;
} else {
    let msg: string@bob = "ng"@bob;
}
`,
  "15.3": `
function add@alice(a: integer, b: integer): integer {
    return a + b;
}

let x: integer@alice = add(1@alice, 2@alice);
`,
  "15.4": `
function choose@every(c: boolean@every): integer@alice {
    if (c) {
        return 1@alice;
    } else {
        return 0@alice;
    }
}

let c: boolean@every = true@every;
let x: integer@alice = choose(c);
`,
  "15.5": `
let cont: boolean@every = true@every;

while (cont) {
    let x: integer@alice = 1@alice;
    let y: integer@bob <~ x;

    let nextLocal: boolean@bob = false@bob;
    cont <~ nextLocal;
}
`,
  "15.6": `
for (
    let i: integer@every = 0@every;
    i < 3@every;
    i = i + 1@every
) {
    let x: integer@alice = i;
    let y: integer@bob <~ x;
}
`,
};

for (const [name, source] of Object.entries(sources)) {
  const r = compileSource(source, "index.cbs", config);
  console.log("\n#####", name, "#####", "success:", r.success);
  if (!r.success) {
    console.log(r.errors);
    continue;
  }
  for (const o of r.outputs) {
    console.log("---", o.participant, "---");
    console.log(o.source);
  }
}

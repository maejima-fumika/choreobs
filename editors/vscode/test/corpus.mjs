// Runs the grammar over every .cbs program in examples/ and benchmarks/.
//
// These programs all compile, so the grammar must give none of their tokens
// an `invalid.*` scope, and must finish every file back at the top level: a
// string or block comment still open at the end means it swallowed code.

import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import vsctm from "vscode-textmate";
import oniguruma from "vscode-oniguruma";

const require = createRequire(import.meta.url);
const HERE = import.meta.dirname;
const EXTENSION = join(HERE, "..");
const REPO = join(EXTENSION, "..", "..");
const CORPUS_DIRS = ["examples", "benchmarks"].map((d) => join(REPO, d));

const wasm = readFileSync(join(dirname(require.resolve("vscode-oniguruma")), "onig.wasm"));
await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));

const registry = new vsctm.Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
    createOnigString: (s) => new oniguruma.OnigString(s),
  }),
  loadGrammar: async (scopeName) => {
    if (scopeName !== "source.choreobs") return null;
    const path = join(EXTENSION, "syntaxes", "choreobs.tmLanguage.json");
    return vsctm.parseRawGrammar(readFileSync(path, "utf8"), path);
  },
});
const grammar = await registry.loadGrammar("source.choreobs");
// The state a line ends in when nothing is left open.
const TOP_LEVEL = grammar.tokenizeLine("", vsctm.INITIAL).ruleStack;

function* cbsFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "workspace") yield* cbsFiles(path);
    } else if (entry.name.endsWith(".cbs")) {
      yield path;
    }
  }
}

let files = 0;
const failures = [];
for (const path of CORPUS_DIRS.flatMap((d) => [...cbsFiles(d)])) {
  files += 1;
  const name = relative(REPO, path);
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  let stack = vsctm.INITIAL;
  lines.forEach((line, i) => {
    const result = grammar.tokenizeLine(line, stack);
    for (const token of result.tokens) {
      const invalid = token.scopes.find((s) => s.startsWith("invalid."));
      if (invalid !== undefined) {
        const text = line.slice(token.startIndex, token.endIndex);
        failures.push(`${name}:${i + 1}:${token.startIndex + 1}: '${text}' is ${invalid}`);
      }
    }
    stack = result.ruleStack;
  });
  if (!stack.equals(TOP_LEVEL)) {
    failures.push(`${name}: the file ends inside a string or block comment`);
  }
}

if (files === 0) {
  console.error("corpus: no .cbs files found");
  process.exit(1);
}
if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`corpus: ${failures.length} problem(s) in ${files} files`);
  process.exit(1);
}
console.log(`✓ corpus: ${files} .cbs files tokenized cleanly`);

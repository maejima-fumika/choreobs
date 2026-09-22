/** The TypeScript trees that may cite the spec: everything `npm run typecheck` sees. */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./parse.js";

const TREES = ["src", "test", "scripts"] as const;

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path, out);
    } else if (entry.name.endsWith(".ts")) {
      out.push(path);
    }
  }
}

/** Absolute paths, in a stable order. */
export function sourceFiles(): readonly string[] {
  const out: string[] = [];
  for (const tree of TREES) {
    walk(join(REPO_ROOT, tree), out);
  }
  return out.sort();
}

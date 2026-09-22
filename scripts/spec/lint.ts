/**
 * Checks that spec.md and the repo agree about what the sections are.
 *
 * Two of these rules are the ratchet the whole refactor rests on: no raw
 * section number survives in spec.md's prose, and none survives in the source
 * trees. Once they are green a renumber cannot strand a stale reference,
 * because there is no number left anywhere to go stale.
 *
 * Pure, so `test/spec/registry.test.ts` can run it as part of `npm test` —
 * which matters, because `npm test` is this repo's only gate.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import {
  LINK_REF,
  parseSpec,
  RAW_REF,
  REPO_ROOT,
  SLUG_REF,
  SPEC_PATH,
  type SpecDocument,
} from "./parse.js";
import { renderSections } from "./registry.js";
import { renumber } from "./renumber.js";
import { sourceFiles } from "./files.js";

/**
 * The modules that define the notation and explain its hazards. Their `§7.8`s
 * are examples of the form, not citations of a section.
 */
const NOTATION_MODULES = ["src/spec/", "scripts/spec/"];

/** `Section 7.11` / `Sections 7.11 and 7.11.1` written as plain prose. */
const PROSE_REF = /\bSections? \d+(\.\d+)*/;

export interface Finding {
  readonly where: string;
  readonly message: string;
}

function markdownFiles(): readonly string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
        continue;
      }
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith(".md") && path !== SPEC_PATH) {
        out.push(path);
      }
    }
  };
  walk(REPO_ROOT);
  return out.sort();
}

function checkHeadings(doc: SpecDocument, add: (w: string, m: string) => void): void {
  for (const h of doc.headings) {
    const where = `spec.md:${h.line}`;
    if (!h.anchored) {
      add(where, `heading '${h.title}' has no anchor — run \`npm run spec:fmt\``);
    }
    if (h.title.includes("<a ")) {
      add(where, `heading '${h.title}' carries more than one anchor`);
    }
    const depth = h.number === null ? null : h.number.split(".").length;
    if (depth !== null && depth !== h.level - 1) {
      add(
        where,
        `'${h.number}' is ${depth} level(s) deep but the heading is h${h.level}; ` +
          `an h${h.level} takes a ${h.level - 1}-level number`,
      );
    }
    if (h.number === null && h.level !== 1 && h.level < 4) {
      add(where, `h${h.level} '${h.title}' must be numbered`);
    }
  }
}

function checkSpecBody(doc: SpecDocument, add: (w: string, m: string) => void): void {
  doc.lines.forEach((line, i) => {
    const where = `spec.md:${i + 1}`;
    if (doc.inFence[i] === true) {
      for (const m of line.matchAll(RAW_REF)) {
        add(where, `§${m[1]} inside a code block: write §slug there`);
      }
      return;
    }
    // Outside a fence every reference must be a link, so that renumbering can
    // refill its text.
    for (const m of line.matchAll(RAW_REF)) {
      const linked = line[m.index - 1] === "[" && line.slice(m.index + m[0].length).startsWith("](#");
      if (!linked) {
        add(where, `bare §${m[1]} in prose: write [§${m[1]}](#slug)`);
      }
    }
    for (const m of line.matchAll(LINK_REF)) {
      const target = doc.bySlug.get(m[3]!);
      if (target === undefined) {
        add(where, `link to #${m[3]}, which is not a heading`);
      } else if (target.number === null) {
        add(where, `link to #${m[3]}, which has no number to cite`);
      } else if (target.number !== m[2]) {
        add(where, `link reads §${m[2]} but #${m[3]} is §${target.number}`);
      }
    }
    // "Sections 7.11 and 7.11.1" names sections without linking them, so
    // nothing would keep it in step with a renumber.
    if (PROSE_REF.test(line.replace(LINK_REF, ""))) {
      add(where, `unlinked prose reference: ${line.trim().slice(0, 80)}`);
    }
  });
}

function checkSources(doc: SpecDocument, add: (w: string, m: string) => void): void {
  for (const path of [...sourceFiles(), ...markdownFiles()]) {
    const rel = relative(REPO_ROOT, path);
    if (NOTATION_MODULES.some((prefix) => rel.startsWith(prefix))) {
      continue;
    }
    const text = readFileSync(path, "utf8");
    if (!text.includes("§")) {
      continue;
    }
    for (const m of text.matchAll(SLUG_REF)) {
      if (!doc.bySlug.has(m[1]!)) {
        add(rel, `§${m[1]} is not a section of spec.md`);
      }
    }
    for (const m of text.matchAll(RAW_REF)) {
      add(rel, `§${m[1]} is a section number: cite the slug instead`);
    }
  }
}

export function checkSpec(): readonly Finding[] {
  const findings: Finding[] = [];
  const add = (where: string, message: string): void => {
    findings.push({ where, message });
  };

  let doc: SpecDocument;
  try {
    doc = parseSpec();
  } catch (e) {
    return [{ where: "spec.md", message: e instanceof Error ? e.message : String(e) }];
  }

  checkHeadings(doc, add);
  checkSpecBody(doc, add);
  checkSources(doc, add);

  if (renumber(doc.text) !== doc.text) {
    add("spec.md", "numbering is stale — run `npm run spec:fmt`");
  }
  const registryPath = join(REPO_ROOT, "src", "spec", "sections.ts");
  if (readFileSync(registryPath, "utf8") !== renderSections()) {
    add("src/spec/sections.ts", "out of date with spec.md — run `npm run spec:sections`");
  }
  return findings;
}

/**
 * One-shot migration from section numbers to slugs. Deleted once it has run.
 *
 *   npx tsx scripts/spec/migrate.ts --step=anchors
 *   npx tsx scripts/spec/migrate.ts --step=links
 *
 * Every step is idempotent, so a reviewer can check a commit by re-running its
 * step against the parent revision and asking git for an empty diff rather
 * than reading a thousand changed lines.
 *
 * Two rules the whole migration turns on:
 *
 *   - References are rewritten by ONE maximal-munch pass. Looping over the
 *     number map and replacing key by key would corrupt every nested number,
 *     because `§7.1` is a prefix of `§7.11`.
 *   - A reference that does not resolve is fatal. There is no --force: the
 *     dangling references were fixed before this script ran, so its input is
 *     total.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import ts from "typescript";
import { parseSpec, requireNumber, REPO_ROOT, SPEC_PATH, type SpecDocument } from "./parse.js";
import { sourceFiles } from "./files.js";

/** `§7.8`, `§16`. Greedy, so a nested number is never split. */
const REF = /§(\d+(?:\.\d+)*)/g;
/** The seven prose references that spell the word out. */
const SECTION_REF = /\bSection (\d+(?:\.\d+)*)\b/g;
/** Inline code spans, which are left alone. */
const CODE_SPAN = /(`+[^`]*`+)/;

/** Is this match already the text of a `[§7.8](#slug)` link? */
function alreadyLinked(line: string, offset: number, length: number): boolean {
  return line[offset - 1] === "[" && line.slice(offset + length).startsWith("](#");
}

/** Rewrites the prose segments of a line, leaving inline code spans untouched. */
function outsideCodeSpans(line: string, rewrite: (segment: string) => string): string {
  return line
    .split(CODE_SPAN)
    .map((segment, i) => (i % 2 === 1 ? segment : rewrite(segment)))
    .join("");
}

// ---------------------------------------------------------------------------
// --step=anchors
// ---------------------------------------------------------------------------

/**
 * Writes each heading's slug into the heading line itself, so that moving a
 * heading moves its identity with it.
 */
function stepAnchors(doc: SpecDocument): string {
  const lines = [...doc.lines];
  for (const h of doc.headings) {
    if (h.anchored) {
      continue;
    }
    lines[h.line - 1] = `${lines[h.line - 1]!.trimEnd()} <a id="${h.slug}"></a>`;
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// --step=links
// ---------------------------------------------------------------------------

/**
 * Turns every cross-reference into a link to the target's slug, so that a
 * renumber only has to refill the link text.
 *
 * Inside a fenced block a link would not render, so a reference there becomes
 * `§slug` — the same form used in code comments across the repo. One rule:
 * in code a reference is `§slug`, in prose it is `[§7.8](#slug)`.
 */
function stepLinks(doc: SpecDocument): string {
  return doc.lines
    .map((line, i) => {
      const where = `spec.md:${i + 1}`;
      if (doc.inFence[i] === true) {
        return line.replace(REF, (_m, num: string) => `§${requireNumber(doc, num, where).slug}`);
      }
      // `offset` is into the string being replaced, so the guard has to read
      // that string and not the one the previous replace started from.
      return outsideCodeSpans(line, (segment) =>
        segment
          .replace(SECTION_REF, (m, num: string, offset: number, whole: string) =>
            alreadyLinked(whole, offset, m.length)
              ? m
              : `[Section ${num}](#${requireNumber(doc, num, where).slug})`,
          )
          .replace(REF, (m, num: string, offset: number, whole: string) =>
            alreadyLinked(whole, offset, m.length)
              ? m
              : `[§${num}](#${requireNumber(doc, num, where).slug})`,
          ),
      );
    })
    .join("\n");
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// TypeScript sources
// ---------------------------------------------------------------------------

/**
 * The files the migration rewrites.
 *
 * `src/spec/` and `scripts/spec/` are the machinery that defines the notation
 * and explains its hazards, so their own `§7.8`s are examples, not citations.
 * `load.test.ts` asserts `validateEndpoints`'s messages in full, so its
 * expectations have to move in the same commit as the messages.
 */
function migratable(): readonly string[] {
  return sourceFiles().filter((path) => {
    const rel = relative(REPO_ROOT, path);
    return (
      !rel.startsWith("src/spec/") &&
      !rel.startsWith("scripts/spec/") &&
      rel !== "test/config/load.test.ts"
    );
  });
}

/**
 * Where a `§` sits in a TypeScript file. The destination differs by region — a
 * comment keeps a bare `§slug`, a test title too, and a compiler message hands
 * its citation to the reporting call — so the classification has to be exact,
 * which is why this reads the AST instead of the raw text.
 */
interface Region {
  readonly kind: "comment" | "literal";
  readonly start: number;
  readonly end: number;
}

function regionsOf(text: string, fileName: string): readonly Region[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const regions: Region[] = [];
  const seenComment = new Set<number>();

  const addComments = (ranges: readonly ts.CommentRange[] | undefined): void => {
    for (const r of ranges ?? []) {
      if (!seenComment.has(r.pos)) {
        seenComment.add(r.pos);
        regions.push({ kind: "comment", start: r.pos, end: r.end });
      }
    }
  };

  const visit = (node: ts.Node): void => {
    addComments(ts.getLeadingCommentRanges(text, node.pos));
    // A comment on the last line of a block trails its statement and leads no
    // node at all, because the `}` that follows is a token, not a child.
    addComments(ts.getTrailingCommentRanges(text, node.end));
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      regions.push({ kind: "literal", start: node.getStart(sf), end: node.end });
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  addComments(ts.getLeadingCommentRanges(text, sf.endOfFileToken.pos));
  return regions;
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Right to left, so that an earlier edit cannot shift a later one's offsets. */
function applyEdits(text: string, edits: readonly Edit[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

function regionAt(regions: readonly Region[], offset: number): Region | undefined {
  return regions.find((r) => offset >= r.start && offset < r.end);
}

/** Every `§` must land in a classified region, or the rewrite would miss it. */
function eachRef(
  text: string,
  regions: readonly Region[],
  path: string,
  visit: (match: RegExpExecArray, region: Region) => void,
): void {
  REF.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF.exec(text)) !== null) {
    const region = regionAt(regions, m.index);
    if (region === undefined) {
      throw new Error(`${path}: §${m[1]} at offset ${m.index} is in neither a comment nor a literal`);
    }
    visit(m, region);
  }
}

// ---------------------------------------------------------------------------
// --step=refs
// ---------------------------------------------------------------------------

/**
 * Replaces numbers with slugs everywhere the reference is prose: comments in
 * every tree, and the `it`/`describe` titles that make up almost all of the
 * literals under `test/`.
 *
 * Test titles are decided by path, not by how the text looks. They are written
 * in the same `(spec §16.7)` shape as the compiler's own messages, so a
 * shape-driven rule would turn 200-odd test names into number-bearing
 * templates that churn on every renumber.
 */
function stepRefs(doc: SpecDocument): void {
  for (const path of migratable()) {
    const text = readFileSync(path, "utf8");
    if (!text.includes("§")) {
      continue;
    }
    const rel = relative(REPO_ROOT, path);
    const inTests = rel.startsWith("test/");
    const regions = regionsOf(text, path);
    const edits: Edit[] = [];

    eachRef(text, regions, rel, (m, region) => {
      if (region.kind === "literal") {
        if (!inTests) {
          return;
        }
        // A literal that is nothing but the reference is matched against what
        // the compiler prints, so it moves with the messages, not here.
        if (text.slice(region.start + 1, region.end - 1) === m[0]) {
          return;
        }
      }
      const slug = requireNumber(doc, m[1]!, rel).slug;
      edits.push({ start: m.index, end: m.index + m[0].length, text: `§${slug}` });
    });

    if (edits.length > 0) {
      writeFileSync(path, applyEdits(text, edits), "utf8");
      console.log(`  ${rel}: ${edits.length}`);
    }
  }
}

// ---------------------------------------------------------------------------
// --step=messages
// ---------------------------------------------------------------------------

/** A ` (spec §7.13, §16.41)` suffix inside a compiler message. */
const CITATION = / \((?:spec )?§\d+(?:\.\d+)*(?:, §\d+(?:\.\d+)*)*\)/g;

/**
 * Reporting helpers that take their citation as a trailing argument. Anything
 * else carrying a citation is reported and left alone: a `return`, a property,
 * a `new Error` for an internal invariant, and the one site that picks its
 * citation at run time all need a human.
 */
const CITATION_TAKERS: ReadonlySet<string> = new Set([
  "this.error",
  "this.fail",
  "this.consume",
  "this.consumeIdentifierToken",
  "inferenceError",
  "TypeResolveError",
]);

/** The call whose argument list holds this literal, directly or through a template. */
function enclosingCall(node: ts.Node): ts.CallExpression | ts.NewExpression | undefined {
  let child = node;
  let parent = node.parent as ts.Node | undefined;
  while (parent !== undefined) {
    if (ts.isTemplateSpan(parent) || ts.isTemplateExpression(parent)) {
      child = parent;
      parent = parent.parent;
      continue;
    }
    if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
        parent.arguments?.some((a) => a === child)) {
      return parent;
    }
    return undefined;
  }
  return undefined;
}

/**
 * Moves the citation out of the message and into the reporting call, so that a
 * renumber cannot touch what the compiler prints.
 */
function stepMessages(doc: SpecDocument): void {
  const skipped: string[] = [];

  for (const path of migratable()) {
    const rel = relative(REPO_ROOT, path);
    if (rel.startsWith("test/")) {
      continue;
    }
    const text = readFileSync(path, "utf8");
    if (!text.includes("§")) {
      continue;
    }
    const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const edits: Edit[] = [];
    const handled = new Set<ts.Node>();

    const literals: ts.Node[] = [];
    const collect = (node: ts.Node): void => {
      if (
        ts.isStringLiteralLike(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)
      ) {
        literals.push(node);
      }
      ts.forEachChild(node, collect);
    };
    collect(sf);

    for (const lit of literals) {
      const raw = text.slice(lit.getStart(sf), lit.end);
      CITATION.lastIndex = 0;
      const found = [...raw.matchAll(CITATION)];
      if (found.length === 0) {
        continue;
      }
      const line = sf.getLineAndCharacterOfPosition(lit.getStart(sf)).line + 1;
      const call = enclosingCall(lit);
      const callee = call === undefined ? undefined : call.expression.getText(sf);
      if (call === undefined || callee === undefined || !CITATION_TAKERS.has(callee)) {
        skipped.push(`${rel}:${line}: ${callee ?? "not a call argument"}`);
        continue;
      }
      if (handled.has(call)) {
        skipped.push(`${rel}:${line}: second citation in one call`);
        continue;
      }
      handled.add(call);

      const slugs: string[] = [];
      for (const hit of found) {
        REF.lastIndex = 0;
        let n: RegExpExecArray | null;
        while ((n = REF.exec(hit[0])) !== null) {
          slugs.push(requireNumber(doc, n[1]!, `${rel}:${line}`).slug);
        }
      }

      edits.push({ start: lit.getStart(sf), end: lit.end, text: raw.replace(CITATION, "") });

      // A call already broken across lines gets the citation on a line of its
      // own, at the indentation its other arguments use.
      const last = call.arguments![call.arguments!.length - 1]!;
      const arg = `[${slugs.map((s) => `"${s}"`).join(", ")}]`;
      const lastLine = sf.getLineAndCharacterOfPosition(last.getStart(sf));
      const call0 = sf.getLineAndCharacterOfPosition(call.getStart(sf));
      const oneLine = lastLine.line === call0.line;
      const width = lastLine.character + (last.end - last.getStart(sf)) + arg.length + 3;
      const indent = " ".repeat(oneLine ? call0.character + 2 : lastLine.character);
      const separator = oneLine && width <= 100 ? ", " : `,\n${indent}`;
      edits.push({ start: last.end, end: last.end, text: `${separator}${arg}` });
    }

    if (edits.length > 0) {
      writeFileSync(path, applyEdits(text, edits), "utf8");
      console.log(`  ${rel}: ${edits.length / 2} call(s)`);
    }
  }

  if (skipped.length > 0) {
    console.log(`\n  left for a human (${skipped.length}):`);
    for (const s of skipped) {
      console.log(`    ${s}`);
    }
  }
}

// ---------------------------------------------------------------------------

const SPEC_STEPS = {
  anchors: stepAnchors,
  links: stepLinks,
} as const;

const SOURCE_STEPS = {
  refs: stepRefs,
  messages: stepMessages,
} as const;

const STEP_NAMES = [...Object.keys(SPEC_STEPS), ...Object.keys(SOURCE_STEPS)];

function runSpecStep(step: keyof typeof SPEC_STEPS): number {
  const before = readFileSync(SPEC_PATH, "utf8");
  const after = SPEC_STEPS[step](parseSpec(before));

  // Idempotence is what makes the resulting commit checkable: applying the
  // step to its own output must change nothing.
  if (SPEC_STEPS[step](parseSpec(after)) !== after) {
    console.error(`--step=${step} is not idempotent; refusing to write`);
    return 2;
  }
  if (after === before) {
    console.log(`--step=${step}: already applied`);
    return 0;
  }
  writeFileSync(SPEC_PATH, after, "utf8");
  console.log(`--step=${step}: wrote spec.md`);
  return 0;
}

function main(argv: readonly string[]): number {
  const step = argv.find((a) => a.startsWith("--step="))?.slice("--step=".length);
  if (step === undefined || !STEP_NAMES.includes(step)) {
    console.error(`usage: migrate.ts --step=<${STEP_NAMES.join("|")}>`);
    return 1;
  }
  if (Object.hasOwn(SPEC_STEPS, step)) {
    return runSpecStep(step as keyof typeof SPEC_STEPS);
  }
  console.log(`--step=${step}:`);
  SOURCE_STEPS[step as keyof typeof SOURCE_STEPS](parseSpec());
  return 0;
}

process.exit(main(process.argv.slice(2)));

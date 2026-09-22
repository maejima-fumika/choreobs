/**
 * The one place that knows how a spec.md heading line is written.
 *
 * A heading's identity is its slug, not its number: the number says where the
 * heading sits today, the slug says which rule it states. Everything else in
 * `scripts/spec/` reads the document through here, so the heading grammar and
 * the fence tracking exist once.
 *
 * The heading pattern makes both the number and the anchor optional, so the
 * same parser works before and after the anchors are written into the file.
 * Once a heading carries an anchor, that anchor *is* the slug and the
 * generator below is never consulted for it again — which is what makes
 * renaming a heading safe.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SPEC_PATH = join(REPO_ROOT, "spec.md");

/** `### 7.8 Transfer Typing <a id="transfer-typing"></a>` */
const HEADING =
  /^(#{1,6})[ \t]+(?:(\d+(?:\.\d+)*)\.?[ \t]+)?(.*?)(?:[ \t]*<a id="([a-z][a-z0-9-]*)"><\/a>)?[ \t]*$/;

/** A fence opener or closer. Every fence in spec.md is three backticks at column 0. */
const FENCE = /^```/;

export interface Heading {
  readonly level: number;
  /** `"7.8"`, or null for the title and the 54 unnumbered `####` headings. */
  readonly number: string | null;
  readonly title: string;
  readonly slug: string;
  /** Whether the slug was read from an anchor in the file rather than generated. */
  readonly anchored: boolean;
  /** 1-based. */
  readonly line: number;
}

export interface SpecDocument {
  readonly text: string;
  readonly lines: readonly string[];
  readonly headings: readonly Heading[];
  /** 0-based line index -> is this line inside a fenced block? Fences themselves are false. */
  readonly inFence: readonly boolean[];
  /** Numbered headings, keyed by number (`"7.8"`). Includes the 17 chapter numbers. */
  readonly byNumber: ReadonlyMap<string, Heading>;
  readonly bySlug: ReadonlyMap<string, Heading>;
}

/**
 * Short keys used to disambiguate headings that share a title, such as the
 * three "Direct Communication" sections in chapters 11, 12 and 15.
 */
const CHAPTER_KEYS: Readonly<Record<string, string>> = {
  "1": "overview", "2": "io", "3": "endpoints", "4": "lex", "5": "syntax",
  "6": "names", "7": "types", "8": "annotations", "9": "stmts", "10": "functions",
  "11": "transfer", "12": "epp", "13": "codegen", "14": "runtime", "15": "examples",
  "16": "errors", "17": "future",
};

/**
 * Hand-picked slugs, keyed by `<chapter>/<mechanical base>`.
 *
 * Migration-time only: once the anchors are in spec.md the slugs are read from
 * there. Two jobs — give the normative statement of a repeated title the bare
 * slug (its restatements keep the mechanical chapter prefix), and shorten the
 * handful of slugs the mechanical rule makes unreadably long.
 */
const SLUG_OVERRIDES: Readonly<Record<string, string>> = {
  "6/function-names": "function-names",
  "9/break-and-continue": "break-and-continue",
  "16/break-and-continue": "err-break-and-continue",
  "10/choreography-function": "choreography-function-kind",
  "10/local-function": "local-function-kind",
  "15/choreography-function": "example-choreography-function",
  "15/local-function": "example-local-function",
  "11/direct-communication": "direct-communication",
  "15/direct-communication": "example-direct-communication",
  "11/local-copy": "local-copy",
  "15/broadcast": "example-broadcast",

  "10/calling-local-functions-from-a-choreography-context": "calling-local-from-choreography",
  "16/calling-a-choreography-function-from-a-local-function": "calling-choreography-from-local",
  "12/transfer-declaration-versus-transfer-assignment": "transfer-decl-vs-assignment",
  "16/invalid-every-array-assignment-to-individual-location": "err-every-array-assignment",
  "16/invalid-every-array-argument-to-individual-location-parameter": "err-every-array-argument",
  "16/name-already-held-in-the-value-namespace": "err-name-already-held",

  // Titles whose mechanical slug loses what the heading is about, or says so
  // generically enough that a citation would not read as anything.
  "2/rules": "endpoint-rules",
  "4/maximal-munch-and": "maximal-munch-and-transfer",
  "7/length": "array-length",
  "7/push": "array-push",
  "12/the-rule": "expression-projection-rule",
  "12/definition": "epp-definition",
  "14/where-it-appears": "nothing-where-it-appears",
  "17/control-flow": "future-control-flow",
  "17/data-structures": "future-data-structures",
  "17/communication-features": "future-communication-features",

  // Two pairs of sub-headings that both read "... a choreography/local
  // context": one under condition typing, one under call typing.
  "7/choreography-context": "if-condition-choreography-context",
  "7/local-context": "if-condition-local-context",
  "7/in-a-choreography-context": "call-in-a-choreography-context",
  "7/in-a-local-context": "call-in-a-local-context",

  // Chapter 13 restates chapters 10 and 12 for code generation.
  "13/local-functions": "codegen-local-functions",
  "13/choreography-functions": "codegen-choreography-functions",

  // Every worked example carries the prefix, not only the four whose titles
  // happen to repeat a normative heading.
  "15/while-with-transfer": "example-while-with-transfer",
  "15/for-loop": "example-for-loop",
  "15/cleanup-of-nothing": "example-cleanup-of-nothing",
  "15/return-type-inference-with-numeric-lub": "example-return-type-inference",
  "15/mutable-arrays": "example-mutable-arrays",
};

/** `Mixing \`return;\` and \`return expr;\`` -> `mixing-return-and-return-expr` */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    // Code ticks and apostrophes are dropped rather than separated, so
    // `.push` reads as `push` and `Endpoint's` as `endpoints`.
    .replace(/[`'\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface RawHeading {
  readonly level: number;
  readonly number: string | null;
  readonly title: string;
  readonly anchor: string | null;
  readonly line: number;
  /** The enclosing chapter's number, for disambiguation. */
  readonly chapter: string;
}

function scan(lines: readonly string[]): { raw: RawHeading[]; inFence: boolean[] } {
  const raw: RawHeading[] = [];
  const inFence: boolean[] = [];
  let fenced = false;
  let chapter = "0";

  for (const [i, line] of lines.entries()) {
    if (FENCE.test(line)) {
      inFence.push(false);
      fenced = !fenced;
      continue;
    }
    inFence.push(fenced);
    if (fenced) {
      continue;
    }
    const m = HEADING.exec(line);
    if (m === null) {
      continue;
    }
    const level = m[1]!.length;
    const number = m[2] ?? null;
    if (level === 2 && number !== null) {
      chapter = number;
    }
    raw.push({ level, number, title: m[3]!, anchor: m[4] ?? null, line: i + 1, chapter });
  }

  if (fenced) {
    throw new Error("spec.md: unterminated fenced code block");
  }
  return { raw, inFence };
}

/**
 * The slug a heading gets when it has no anchor yet: its title, with a chapter
 * key prefixed when another heading shares that title, and the override table
 * applied last.
 */
function generateSlug(h: RawHeading, baseCounts: ReadonlyMap<string, number>): string {
  const base = slugify(h.title);
  const override = SLUG_OVERRIDES[`${h.chapter}/${base}`];
  if (override !== undefined) {
    return override;
  }
  if ((baseCounts.get(base) ?? 0) > 1) {
    const key = CHAPTER_KEYS[h.chapter];
    if (key === undefined) {
      throw new Error(`spec.md:${h.line}: no chapter key for chapter ${h.chapter}`);
    }
    return `${key}-${base}`;
  }
  return base;
}

export function parseSpec(text: string = readFileSync(SPEC_PATH, "utf8")): SpecDocument {
  const lines = text.split("\n");
  const { raw, inFence } = scan(lines);

  const baseCounts = new Map<string, number>();
  for (const h of raw) {
    const base = slugify(h.title);
    baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
  }

  const headings: Heading[] = raw.map((h) => ({
    level: h.level,
    number: h.number,
    title: h.title,
    slug: h.anchor ?? generateSlug(h, baseCounts),
    anchored: h.anchor !== null,
    line: h.line,
  }));

  const byNumber = new Map<string, Heading>();
  const bySlug = new Map<string, Heading>();
  for (const h of headings) {
    if (h.number !== null) {
      const clash = byNumber.get(h.number);
      if (clash !== undefined) {
        throw new Error(`spec.md:${h.line}: number ${h.number} is already used at line ${clash.line}`);
      }
      byNumber.set(h.number, h);
    }
    const clash = bySlug.get(h.slug);
    if (clash !== undefined) {
      throw new Error(
        `spec.md:${h.line}: slug '${h.slug}' is already used at line ${clash.line} ` +
          `('${clash.title}' vs '${h.title}') — add an entry to SLUG_OVERRIDES`,
      );
    }
    bySlug.set(h.slug, h);
  }

  return { text, lines, headings, inFence, byNumber, bySlug };
}

/**
 * Resolves a section number to its heading, failing loudly. Every reference in
 * the repo must resolve: there is no tolerated dangling reference.
 */
export function requireNumber(doc: SpecDocument, number: string, where: string): Heading {
  const hit = doc.byNumber.get(number);
  if (hit === undefined) {
    throw new Error(`${where}: §${number} does not exist in spec.md`);
  }
  return hit;
}

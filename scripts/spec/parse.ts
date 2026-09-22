/**
 * The one place that knows how spec.md writes a heading and a reference.
 *
 * A heading's identity is its slug, not its number: the number says where the
 * heading sits today, the slug says which rule it states.
 *
 * Once a heading carries an anchor, that anchor *is* the slug and is never
 * re-derived — which is what makes renaming a heading safe. A heading written
 * without one gets a slug proposed from its title, which `spec:fmt` then
 * writes into the file, fixing it from then on.
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

/**
 * How a reference is written. `§7.8` is a number where a slug belongs; `§slug`
 * is the form used in code, where a link would not render; the link form is
 * used in prose, and its text is what `spec:fmt` refills.
 */
export const RAW_REF = /§(\d+(?:\.\d+)*)/g;
export const SLUG_REF = /§([a-z][a-z0-9-]*)/g;
export const LINK_REF = /\[(§|Section )(\d+(?:\.\d+)*)\]\(#([a-z][a-z0-9-]*)\)/g;

export interface Heading {
  readonly level: number;
  /** `"7.8"`, or null for the title and the unnumbered `####` headings. */
  readonly number: string | null;
  readonly title: string;
  readonly slug: string;
  /** False while the slug is only a proposal, until `spec:fmt` writes it down. */
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

/** `Mixing \`return;\` and \`return expr;\`` -> `mixing-return-and-return-expr` */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    // Code ticks and apostrophes are dropped rather than separated, so
    // `.push` reads as `push` and `Endpoint's` as `endpoints`.
    .replace(/[`'’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface RawHeading {
  readonly level: number;
  readonly number: string | null;
  readonly title: string;
  readonly anchor: string | null;
  readonly line: number;
}

function scan(lines: readonly string[]): { raw: RawHeading[]; inFence: boolean[] } {
  const raw: RawHeading[] = [];
  const inFence: boolean[] = [];
  let fenced = false;

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
    raw.push({
      level: m[1]!.length,
      number: m[2] ?? null,
      title: m[3]!,
      anchor: m[4] ?? null,
      line: i + 1,
    });
  }

  if (fenced) {
    throw new Error("spec.md: unterminated fenced code block");
  }
  return { raw, inFence };
}

export function parseSpec(text: string = readFileSync(SPEC_PATH, "utf8")): SpecDocument {
  const lines = text.split("\n");
  const { raw, inFence } = scan(lines);

  const headings: Heading[] = raw.map((h) => ({
    level: h.level,
    number: h.number,
    title: h.title,
    slug: h.anchor ?? slugify(h.title),
    anchored: h.anchor !== null,
    line: h.line,
  }));

  const byNumber = new Map<string, Heading>();
  const bySlug = new Map<string, Heading>();
  for (const h of headings) {
    if (h.number !== null) {
      const clash = byNumber.get(h.number);
      if (clash !== undefined) {
        throw new Error(
          `spec.md:${h.line}: number ${h.number} is already used at line ${clash.line}`,
        );
      }
      byNumber.set(h.number, h);
    }
    const clash = bySlug.get(h.slug);
    if (clash !== undefined) {
      throw new Error(
        `spec.md:${h.line}: slug '${h.slug}' is already used at line ${clash.line} ` +
          `('${clash.title}' vs '${h.title}') — write one of the two anchors by hand`,
      );
    }
    bySlug.set(h.slug, h);
  }

  return { text, lines, headings, inFence, byNumber, bySlug };
}

/**
 * Recomputes spec.md's heading numbers from its heading structure, and refills
 * the text of every cross-reference link.
 *
 * This is the whole point of the refactor: a number is a position, so it is
 * derived, never typed. Inserting a chapter means editing one heading line and
 * running this.
 *
 * It does two things and nothing else — it does not invent slugs, move
 * headings, touch fenced blocks, or read any TypeScript.
 */
import { parseSpec, type SpecDocument } from "./parse.js";

const LINK = /\[(§|Section )(\d+(?:\.\d+)*)\]\(#([a-z][a-z0-9-]*)\)/g;

/**
 * A heading is numbered if it is written with a number today. Chapters and
 * sections always are; a `####` carries one only when it is worth citing, and
 * that decision stays the author's.
 */
function renumberHeadings(doc: SpecDocument): {
  readonly lines: string[];
  readonly numbers: ReadonlyMap<string, string>;
} {
  const lines = [...doc.lines];
  const numbers = new Map<string, string>();
  const counts = new Map<string, number>();
  const stack: { level: number; number: string | null }[] = [];

  for (const h of doc.headings) {
    while (stack.length > 0 && stack[stack.length - 1]!.level >= h.level) {
      stack.pop();
    }
    let assigned: string | null = null;
    if (h.number !== null) {
      // Ordinals count numbered siblings only. Under "Type Inference" an
      // unnumbered `#### Partial Annotations` sits between 7.14.1 and 7.14.2;
      // counting every sibling would shift that one and everything after it.
      const parent = stack[stack.length - 1]?.number ?? null;
      const key = parent ?? "";
      const ordinal = (counts.get(key) ?? 0) + 1;
      counts.set(key, ordinal);
      assigned = parent === null ? String(ordinal) : `${parent}.${ordinal}`;
      numbers.set(h.slug, assigned);
    }
    stack.push({ level: h.level, number: assigned });

    // Chapters are written `## 1. Overview`; everything below drops the dot.
    const hashes = "#".repeat(h.level);
    const label = assigned === null ? "" : `${assigned}${h.level === 2 ? "." : ""} `;
    lines[h.line - 1] = `${hashes} ${label}${h.title} <a id="${h.slug}"></a>`;
  }
  return { lines, numbers };
}

export function renumber(text: string): string {
  const doc = parseSpec(text);
  const { lines, numbers } = renumberHeadings(doc);

  return lines
    .map((line, i) =>
      doc.inFence[i] === true
        ? line
        : line.replace(LINK, (m, kind: string, _old: string, slug: string) => {
            const number = numbers.get(slug);
            return number === undefined ? m : `[${kind}${number}](#${slug})`;
          }),
    )
    .join("\n");
}

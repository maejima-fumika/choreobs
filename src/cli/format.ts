import type { CompileDiagnostic } from "../driver/compile.js";
import { SPEC_SECTIONS } from "../spec/sections.js";
import { specNumber } from "../spec/ref.js";

export function buildLineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

export function offsetToLineColumn(
  offset: number,
  lineStarts: readonly number[],
): { readonly line: number; readonly column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = lineStarts[mid]!;
    const next =
      mid + 1 < lineStarts.length ? lineStarts[mid + 1]! : Number.POSITIVE_INFINITY;
    if (offset < start) {
      high = mid - 1;
      continue;
    }
    if (offset >= next) {
      low = mid + 1;
      continue;
    }
    return { line: mid + 1, column: offset - start + 1 };
  }
  return { line: 1, column: offset + 1 };
}

/** Where a diagnostic points, in whichever span shape it carries. */
function formatLocation(
  error: CompileDiagnostic,
  lineStarts?: readonly number[],
): string {
  if (!("span" in error) || error.span === undefined) {
    return "";
  }
  const { start, end } = error.span;
  if (typeof start === "number" && typeof end === "number") {
    if (lineStarts === undefined) {
      return ` [${start}, ${end})`;
    }
    const startPos = offsetToLineColumn(start, lineStarts);
    const endPos = offsetToLineColumn(Math.max(start, end - 1), lineStarts);
    return (
      ` [line ${startPos.line}:${startPos.column}-${endPos.line}:${endPos.column}]` +
      ` [${start}, ${end})`
    );
  }
  if (typeof start === "object" && typeof end === "object") {
    return (
      ` [line ${start.line}:${start.column}-${end.line}:${end.column}]` +
      ` [${start.offset}, ${end.offset})`
    );
  }
  return "";
}

/**
 * A diagnostic as the CLI prints it: the message and its location, then one
 * line per spec section it rests on.
 *
 * The number is looked up rather than stored in the message, so it is right
 * for whatever spec.md says today. The title comes with it, because a number
 * alone still leaves the reader hunting; it goes on its own line, because a
 * title folded into the parenthesis stops reading as a sentence as soon as a
 * diagnostic cites two or three sections, which twenty of them do.
 */
export function formatDiagnostic(
  error: CompileDiagnostic,
  lineStarts?: readonly number[],
): string {
  const head = `${error.message}${formatLocation(error, lineStarts)}`;
  if (error.spec.length === 0) {
    return head;
  }
  const cites = error.spec.map(
    (id) => `    spec ${specNumber(id)} ${SPEC_SECTIONS[id].title}`,
  );
  return [head, ...cites].join("\n");
}

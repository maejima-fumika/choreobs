/**
 * Leaves out every location written inside a local function.
 *
 * Inside `function f@P` a location left out is `P` (spec §local-function-location-inference),
 * so in a program that compiles, deleting the written ones must change nothing.
 * It is one of the rewrites in `metamorphic.ts`, which compiles both forms and
 * compares the outputs. The declaration's own `@P` stays, since without it the
 * function would be a choreography one (spec §function-kinds).
 *
 * It works on tokens, so comments and strings are never touched.
 */
import { tokenize, TokenKind } from "../../src/lexer/index.js";
import { localFunctionRanges } from "../shared/local-functions.js";

/** `source` with the locations inside its local functions cut out; `source` itself if it has none. */
export function stripLocalFunctionLocations(source: string): string {
  const { tokens, errors } = tokenize(source);
  if (errors.length > 0) {
    throw new Error(`cannot strip locations from a source that does not lex: ${errors[0]!.message}`);
  }
  const cuts: [start: number, end: number][] = [];
  for (const [start, end] of localFunctionRanges(tokens)) {
    // Past `function f @ P`, whose `@P` stays.
    for (let i = start + 4; i < end; i += 1) {
      const token = tokens[i]!;
      if (token.kind === TokenKind.At) {
        const location = tokens[i + 1]!;
        cuts.push([token.span.start.offset, location.span.end.offset]);
        i += 1;
      }
    }
  }
  let stripped = "";
  let from = 0;
  for (const [start, end] of cuts) {
    stripped += source.slice(from, start);
    from = end;
  }
  return stripped + source.slice(from);
}

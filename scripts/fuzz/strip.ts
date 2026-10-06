/**
 * Leaves out every location written inside a local function.
 *
 * Inside `function f@P` a location left out is `P` (spec §local-function-location-inference),
 * so in a program that compiles, deleting the written ones must change nothing:
 * `run.ts`, `test/integration/fuzz.test.ts` and
 * `test/integration/local-omission.test.ts` compile both forms and compare the
 * outputs. The declaration's own `@P` stays, since without it the function
 * would be a choreography one (spec §function-kinds).
 *
 * It works on tokens, so comments and strings are never touched.
 */
import { tokenize, TokenKind } from "../../src/lexer/index.js";

/** `source` with the locations inside its local functions cut out; `source` itself if it has none. */
export function stripLocalFunctionLocations(source: string): string {
  const { tokens, errors } = tokenize(source);
  if (errors.length > 0) {
    throw new Error(`cannot strip locations from a source that does not lex: ${errors[0]!.message}`);
  }
  const cuts: [start: number, end: number][] = [];
  let i = 0;
  while (i < tokens.length) {
    const isLocalDeclaration =
      tokens[i]!.kind === TokenKind.Function &&
      tokens[i + 1]?.kind === TokenKind.Identifier &&
      tokens[i + 2]?.kind === TokenKind.At;
    if (!isLocalDeclaration) {
      i += 1;
      continue;
    }
    // Past `function f @ P`. Neither the parameters nor the return type hold a
    // brace, so the function ends with the brace that closes its body.
    i += 4;
    let depth = 0;
    for (; i < tokens.length; i += 1) {
      const token = tokens[i]!;
      if (token.kind === TokenKind.LBrace) {
        depth += 1;
      } else if (token.kind === TokenKind.RBrace) {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          break;
        }
      } else if (token.kind === TokenKind.At) {
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

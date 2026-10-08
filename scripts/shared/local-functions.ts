/**
 * Where a program's local functions are, in its tokens: shared by the scripts
 * that rewrite locations, which must tell a location inside a local function
 * from one in choreography code (spec §local-function-location-inference).
 */
import { TokenKind, type Token } from "../../src/lexer/index.js";

/**
 * Each local function `function f@P(...) {...}` as the token indices
 * `[start, end)`: from its `function` to just past the brace that closes its
 * body. A local function is told apart by the `@` straight after its name
 * (spec §function-kinds). Neither its parameters nor its return type hold a
 * brace, so the function ends with the brace that closes its body.
 */
export function localFunctionRanges(tokens: readonly Token[]): [start: number, end: number][] {
  const ranges: [number, number][] = [];
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
    const start = i;
    let depth = 0;
    for (i += 4; i < tokens.length; i += 1) {
      const kind = tokens[i]!.kind;
      if (kind === TokenKind.LBrace) {
        depth += 1;
      } else if (kind === TokenKind.RBrace) {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          break;
        }
      }
    }
    ranges.push([start, i]);
  }
  return ranges;
}

import type { Span } from "../ast/span.js";
import type { Token } from "../lexer/index.js";

export function spanOf(token: Token): Span {
  return {
    start: token.span.start.offset,
    end: token.span.end.offset,
  };
}

export function spanOfNode(node: { readonly span: Span }): Span {
  return node.span;
}

export function spanBetween(start: Token, end: Token): Span {
  return {
    start: start.span.start.offset,
    end: end.span.end.offset,
  };
}

function endOffset(end: Token | { readonly span: Span }): number {
  return "lexeme" in end ? end.span.end.offset : end.span.end;
}

/** Span from a token through an AST node (or second token). */
export function spanFrom(
  start: Token,
  end: Token | { readonly span: Span },
): Span {
  return {
    start: start.span.start.offset,
    end: endOffset(end),
  };
}

export function spanMerge(a: Span, b: Span): Span {
  return {
    start: Math.min(a.start, b.start),
    end: Math.max(a.end, b.end),
  };
}

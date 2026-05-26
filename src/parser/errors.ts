import type { Span } from "../ast/span.js";

export interface ParseError {
  readonly message: string;
  readonly span: Span;
}

export function parseError(message: string, span: Span): ParseError {
  return { message, span };
}

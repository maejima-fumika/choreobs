import type { Span } from "../ast/span.js";

export interface TypeCheckError {
  readonly message: string;
  readonly span: Span;
}

export function typeCheckError(message: string, span: Span): TypeCheckError {
  return { message, span };
}

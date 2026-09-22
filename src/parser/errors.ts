import type { Span } from "../ast/span.js";
import type { SpecCited, SpecRefs } from "../spec/ref.js";

export interface ParseError extends SpecCited {
  readonly message: string;
  readonly span: Span;
}

export function parseError(message: string, span: Span, spec: SpecRefs = []): ParseError {
  return { message, span, spec };
}

import type { Span } from "../ast/span.js";
import type { SpecCited, SpecRefs } from "../spec/ref.js";

export interface TypeCheckError extends SpecCited {
  readonly message: string;
  readonly span: Span;
}

export function typeCheckError(
  message: string,
  span: Span,
  spec: SpecRefs = [],
): TypeCheckError {
  return { message, span, spec };
}

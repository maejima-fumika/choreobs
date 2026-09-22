import type { SpecCited, SpecRefs } from "../spec/ref.js";
import type { SourceSpan } from "./position.js";

export interface LexicalError extends SpecCited {
  readonly message: string;
  readonly span: SourceSpan;
}

export function lexicalError(
  message: string,
  span: SourceSpan,
  spec: SpecRefs = [],
): LexicalError {
  return { message, span, spec };
}

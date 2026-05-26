import type { SourceSpan } from "./position.js";

export interface LexicalError {
  readonly message: string;
  readonly span: SourceSpan;
}

export function lexicalError(message: string, span: SourceSpan): LexicalError {
  return { message, span };
}

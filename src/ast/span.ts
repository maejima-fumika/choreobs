/** Byte-offset range in the source file (inclusive start, exclusive end). */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** Common supertype for every AST node. */
export interface AstNode {
  readonly span: Span;
}

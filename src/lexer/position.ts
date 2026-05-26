/** 1-based line and column in the source file. */
export interface Position {
  readonly line: number;
  readonly column: number;
  /** 0-based byte index into the UTF-16 source string. */
  readonly offset: number;
}

export interface SourceSpan {
  readonly start: Position;
  readonly end: Position;
}

export function positionAt(offset: number, line: number, column: number): Position {
  return { line, column, offset };
}

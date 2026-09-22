/** Arithmetic and remainder (spec §operators). */
export type ArithmeticOperator = "+" | "-" | "*" | "/" | "%";

/** Ordered comparison on numeric values (spec §operators). */
export type RelationalOperator = "<" | "<=" | ">" | ">=";

/** Strict equality (spec §operators-and-punctuation — `==` / `!=` are not in v0). */
export type EqualityOperator = "===" | "!==";

export type LogicalOperator = "&&" | "||";

export type UnaryOperator = "!" | "-";

export type BinaryOperator =
  | ArithmeticOperator
  | RelationalOperator
  | EqualityOperator
  | LogicalOperator;

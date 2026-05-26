/** Arithmetic and remainder (spec §7.11). */
export type ArithmeticOperator = "+" | "-" | "*" | "/" | "%";

/** Ordered comparison on numeric values (spec §7.11). */
export type RelationalOperator = "<" | "<=" | ">" | ">=";

/** Strict equality (spec §4.6 — `==` / `!=` are not in v0). */
export type EqualityOperator = "===" | "!==";

export type LogicalOperator = "&&" | "||";

export type UnaryOperator = "!" | "-";

export type BinaryOperator =
  | ArithmeticOperator
  | RelationalOperator
  | EqualityOperator
  | LogicalOperator;

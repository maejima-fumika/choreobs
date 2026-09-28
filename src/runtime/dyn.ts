import type { BinaryOperator, UnaryOperator } from "../ast/operators.js";

/**
 * The dynamic-location runtime (spec §dyn-runtime): the names the
 * generated code calls, and the one type it declares values with.
 *
 * Every name carries the compiler's `__` prefix, which the source language
 * reserves (spec §identifiers, §function-names), so none needs listing among
 * the reserved runtime names.
 */

/** The run-time representation of a `T@dyn` value (spec §dyn-val, §type-projection). */
export const DYN_VALUE_TYPE = "__DynVal";

/**
 * The runtime functions the generated code calls, in the order of the table
 * in spec §dyn-lowering. Imports are listed in this order too (spec §runtime-import).
 */
export const DYN_RUNTIME_FUNCTIONS = [
  "__dynUnbound",
  "__inject",
  "__cast",
  "__dynIntegerToFloat",
  "__dynFloatToInteger",
  "__dynPlus",
  "__dynSub",
  "__dynMul",
  "__dynDiv",
  "__dynMod",
  "__dynAnd",
  "__dynOr",
  "__dynLt",
  "__dynLe",
  "__dynGt",
  "__dynGe",
  "__dynEq",
  "__dynNeq",
  "__dynNot",
  "__dynNeg",
  "__dynArrayGet",
  "__dynArraySet",
  "__dynArrayPush",
  "__dynArrayLength",
  "__dynArrayNew",
  "__dynArrayAppend",
  "__dynTransfer",
] as const;

export type DynRuntimeFunction = (typeof DYN_RUNTIME_FUNCTIONS)[number];

const RUNTIME_FUNCTION_SET: ReadonlySet<string> = new Set(DYN_RUNTIME_FUNCTIONS);

export function isDynRuntimeFunction(name: string): name is DynRuntimeFunction {
  return RUNTIME_FUNCTION_SET.has(name);
}

/** Everything a generated file may import from the runtime, in import order. */
export const DYN_RUNTIME_EXPORTS: readonly string[] = [
  DYN_VALUE_TYPE,
  ...DYN_RUNTIME_FUNCTIONS,
];

/** A binary operator with a `dyn` operand (spec §dyn-operators). */
export const DYN_BINARY: Readonly<Record<BinaryOperator, DynRuntimeFunction>> = {
  "+": "__dynPlus",
  "-": "__dynSub",
  "*": "__dynMul",
  "/": "__dynDiv",
  "%": "__dynMod",
  "&&": "__dynAnd",
  "||": "__dynOr",
  "<": "__dynLt",
  "<=": "__dynLe",
  ">": "__dynGt",
  ">=": "__dynGe",
  "===": "__dynEq",
  "!==": "__dynNeq",
};

/** A unary operator on a `dyn` operand (spec §dyn-operators). */
export const DYN_UNARY: Readonly<Record<UnaryOperator, DynRuntimeFunction>> = {
  "!": "__dynNot",
  "-": "__dynNeg",
};

/** The location a runtime call names for a value that is not bound to one. */
export const DYN_LOCATION_NAME = "dyn";

/** The runtime file for `endpoint`, imported without its extension: BlueScript appends `.bs`. */
export function runtimeModuleName(endpoint: string): string {
  return `__runtime_${endpoint}`;
}

import type { BinaryOperator, UnaryOperator } from "../ast/operators.js";
import type { BaseType } from "../ast/syntax-types.js";

/**
 * Names of the Gradual ChoreoBS runtime support symbols emitted into the
 * generated BlueScript runtime module (spec §18.20).
 */
export const DYN_VALUE_CLASS = "DynValue";
export const EVERY_CONSTANT = "EVERY";
export const HERE_CONSTANT = "HERE";

export const PACK_DYNAMIC = "packDynamic";
export const REQUIRE_CONDITION = "requireCondition";
export const DYN_MOVE = "dynMove";

export const DYN_ARRAY_GET = "dynArrayGet";
export const DYN_ARRAY_SET = "dynArraySet";
export const DYN_ARRAY_PUSH = "dynArrayPush";
export const DYN_ARRAY_LENGTH = "dynArrayLength";

/** Runtime helper for a dynamic binary operator (spec §18.12.1–§18.12.3). */
export function dynBinaryCallee(operator: BinaryOperator): string {
  switch (operator) {
    case "+":
      return "dynAdd";
    case "-":
      return "dynSub";
    case "*":
      return "dynMul";
    case "/":
      return "dynDiv";
    case "%":
      return "dynMod";
    case "&&":
      return "dynAnd";
    case "||":
      return "dynOr";
    case "<":
      return "dynLt";
    case "<=":
      return "dynLe";
    case ">":
      return "dynGt";
    case ">=":
      return "dynGe";
    case "===":
      return "dynEq";
    case "!==":
      return "dynNeq";
  }
}

/** Runtime helper for a dynamic unary operator (spec §18.12.4). */
export function dynUnaryCallee(operator: UnaryOperator): string {
  return operator === "!" ? "dynNot" : "dynNeg";
}

/** Scalar require helper for a base type (spec §18.10.1). */
export function requireScalarCallee(base: BaseType): string {
  switch (base) {
    case "integer":
      return "requireIntegerAt";
    case "float":
      return "requireFloatAt";
    case "boolean":
      return "requireBooleanAt";
    case "string":
      return "requireStringAt";
    default:
      return "requireIntegerAt";
  }
}

/** Array require helper for an element base type (spec §18.10.6). */
export function requireArrayCallee(base: BaseType): string {
  switch (base) {
    case "float":
      return "requireFloatArrayAt";
    case "boolean":
      return "requireBooleanArrayAt";
    default:
      return "requireIntegerArrayAt";
  }
}

/**
 * The full set of gradual runtime helper callee names. Calls to these must be
 * preserved by EPP cleanup even on non-owner endpoints (spec §18.18, §18.19).
 */
export const GRADUAL_RUNTIME_CALLEES: ReadonlySet<string> = new Set([
  PACK_DYNAMIC,
  REQUIRE_CONDITION,
  DYN_MOVE,
  DYN_ARRAY_GET,
  DYN_ARRAY_SET,
  DYN_ARRAY_PUSH,
  DYN_ARRAY_LENGTH,
  "requireIntegerAt",
  "requireFloatAt",
  "requireBooleanAt",
  "requireStringAt",
  "requireIntegerArrayAt",
  "requireFloatArrayAt",
  "requireBooleanArrayAt",
  "dynAdd",
  "dynSub",
  "dynMul",
  "dynDiv",
  "dynMod",
  "dynAnd",
  "dynOr",
  "dynLt",
  "dynLe",
  "dynGt",
  "dynGe",
  "dynEq",
  "dynNeq",
  "dynNot",
  "dynNeg",
]);

export function isGradualRuntimeCallee(name: string): boolean {
  return GRADUAL_RUNTIME_CALLEES.has(name);
}

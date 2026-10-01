import type { BinaryOperator, UnaryOperator } from "../ast/operators.js";
import type { NumericType } from "../ast/syntax-types.js";
import type { Location } from "../ast/location.js";

/**
 * The dynamic-location runtime (spec §dyn-runtime): the names the
 * generated code calls, what each of them takes and yields, and the one type
 * it declares values with.
 *
 * Every name carries the compiler's `__` prefix, which the source language
 * reserves (spec §identifiers, §function-names), so none needs listing among
 * the reserved runtime names.
 */

/** The run-time representation of a `T@dyn` value (spec §dyn-val, §type-projection). */
export const DYN_VALUE_TYPE = "__DynVal";

/** How a runtime function's argument is typed (spec §runtime-functions). */
export type ArgumentShape =
  /** A `T@dyn` value. */
  | "dyn"
  /** A value at a concrete location. */
  | "concrete"
  /** A compiler-supplied `string@every` literal: a location, a kind or a tag. */
  | "constant"
  /** A literal at `every`: the payload of an unbound value. */
  | "payload";

/** The result: a `T@dyn` value, a value at the location named by the second argument, or none. */
export type ResultShape = "dyn" | "named" | "void";

export interface Signature {
  readonly args: readonly ArgumentShape[];
  readonly result: ResultShape;
}

const BINARY = { args: ["dyn", "dyn"], result: "dyn" } as const satisfies Signature;
const UNARY = { args: ["dyn"], result: "dyn" } as const satisfies Signature;

/**
 * The runtime functions the generated code calls, with their signatures in
 * the terms of the type system, in the order of the table in
 * spec §runtime-functions. Imports are listed in this order too
 * (spec §runtime-import).
 *
 * `verifyLowered` checks every call `lowerDyn` makes against these, and a test
 * checks the generated runtime's own declarations against them.
 */
export const DYN_RUNTIME = {
  __dynUnbound: { args: ["payload"], result: "dyn" },
  __inject: { args: ["concrete", "constant"], result: "dyn" },
  __cast: { args: ["dyn", "constant"], result: "named" },
  __dynIntegerToFloat: UNARY,
  __dynFloatToInteger: UNARY,
  __dynPlus: BINARY,
  __dynSub: BINARY,
  __dynMul: BINARY,
  __dynDiv: BINARY,
  __dynMod: BINARY,
  __dynAnd: BINARY,
  __dynOr: BINARY,
  __dynLt: BINARY,
  __dynLe: BINARY,
  __dynGt: BINARY,
  __dynGe: BINARY,
  __dynEq: BINARY,
  __dynNeq: BINARY,
  __dynNot: UNARY,
  __dynNeg: UNARY,
  __dynArrayGet: BINARY,
  __dynArraySet: { args: ["dyn", "dyn", "dyn"], result: "void" },
  __dynArrayPush: { args: ["dyn", "dyn"], result: "void" },
  __dynArrayLength: UNARY,
  __dynArrayNew: { args: [], result: "dyn" },
  __dynArrayAppend: BINARY,
  __dynTransfer: { args: ["constant", "constant", "constant", "dyn"], result: "dyn" },
  __dynPrint: { args: ["dyn"], result: "void" },
} as const satisfies Record<string, Signature>;

export type DynRuntimeFunction = keyof typeof DYN_RUNTIME;

const DYN_RUNTIME_FUNCTIONS = Object.keys(DYN_RUNTIME) as readonly DynRuntimeFunction[];

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

/**
 * A conversion of a `dyn` operand to the other numeric type, by its target
 * (spec §dyn-numeric-conversion). A conversion to the operand's own type is
 * dropped instead (spec §converting-a-dyn-operand).
 */
export const DYN_CONVERSION: Readonly<Record<NumericType, DynRuntimeFunction>> = {
  float: "__dynIntegerToFloat",
  integer: "__dynFloatToInteger",
};

/** The runtime function a dynamic transfer becomes (spec §dynamic-transfer). */
export const DYN_TRANSFER = "__dynTransfer" satisfies DynRuntimeFunction;

/** How the runtime names `every` (spec §location-functions). */
export const EVERY_LOCATION_NAME = "every";

/** How the runtime names a destination that is not bound to one location (spec §location-functions). */
export const DYN_LOCATION_NAME = "dyn";

/**
 * A location as a runtime call passes it (spec §runtime-functions): the
 * endpoint's name, or one of the two names no endpoint may take
 * (spec §using-every-as-an-endpoint).
 */
export function runtimeLocationName(location: Location): string {
  switch (location.kind) {
    case "individual":
      return location.name;
    case "every":
      return EVERY_LOCATION_NAME;
    case "dyn":
      return DYN_LOCATION_NAME;
  }
}

/** The runtime file for `endpoint`, imported without its extension: BlueScript appends `.bs`. */
export function runtimeModuleName(endpoint: string): string {
  return `__runtime_${endpoint}`;
}

import type { BinaryOperator, UnaryOperator } from "../ast/operators.js";
import type { NumericType } from "../ast/syntax-types.js";
import type { Location } from "../ast/location.js";
import type { CommKind } from "../ir/projected.js";
import { DYN, EVERY, formatLocation } from "../types/located.js";
import { ALL_COMM_KINDS } from "./names.js";

/**
 * The dynamic-location runtime (spec §dyn-runtime): the names the
 * generated code calls, what each of them takes and yields, the one type it
 * declares values with, and the constants it names locations and payload
 * kinds with (spec §location-and-kind-codes).
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
  /** A compiler-supplied `string@every` literal: a communication tag. */
  | "tag"
  /** A kind constant of the runtime file, `integer@every` (spec §location-and-kind-codes). */
  | "kind"
  /** A location constant of the runtime file, `integer@every` (spec §location-and-kind-codes). */
  | "location"
  /** A literal at `every`: the payload of an unbound value. */
  | "payload";

/**
 * The result: a `T@dyn` value, a value at the location the second argument's
 * constant names, or none.
 */
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
  __inject: { args: ["concrete", "location"], result: "dyn" },
  __cast: { args: ["dyn", "location"], result: "named" },
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
  __dynTransfer: { args: ["tag", "kind", "location", "dyn"], result: "dyn" },
  __dynPrint: { args: ["dyn"], result: "void" },
} as const satisfies Record<string, Signature>;

export type DynRuntimeFunction = keyof typeof DYN_RUNTIME;

const DYN_RUNTIME_FUNCTIONS = Object.keys(DYN_RUNTIME) as readonly DynRuntimeFunction[];

const RUNTIME_FUNCTION_SET: ReadonlySet<string> = new Set(DYN_RUNTIME_FUNCTIONS);

export function isDynRuntimeFunction(name: string): name is DynRuntimeFunction {
  return RUNTIME_FUNCTION_SET.has(name);
}

/**
 * Everything a generated file may import from the runtime, in import order,
 * apart from the location and kind constants, which depend on the endpoints
 * (spec §runtime-import).
 */
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

/**
 * The runtime file, imported without its extension: BlueScript appends `.bs`.
 * Each endpoint's sits in that endpoint's own project, next to its program, so
 * they all have this one name (spec §runtime-import).
 */
export const RUNTIME_MODULE = "__runtime";

// --- §location-and-kind-codes ----------------------------------------------

const LOCATION_CONSTANT_PREFIX = "__loc_";

const KIND_CONSTANT_PREFIX = "__kind_";

/** The constant for the location written `name` after `@`: `dyn`, `every` or an endpoint. */
function locationConstant(name: string): string {
  return `${LOCATION_CONSTANT_PREFIX}${name}`;
}

/** A constant of the runtime file: its name and its integer code. */
export interface RuntimeConstant {
  readonly name: string;
  readonly code: number;
}

/**
 * The constant the generated code names `location` with: `__loc_alice`,
 * `__loc_every` or `__loc_dyn`, the location as written after `@`.
 */
export function locationConstantName(location: Location): string {
  return locationConstant(formatLocation(location));
}

/** The constant for `dyn`, which also marks an unbound location variable. */
export const DYN_LOCATION_CONSTANT = locationConstantName(DYN);

/** The constant for `every`. */
export const EVERY_LOCATION_CONSTANT = locationConstantName(EVERY);

/**
 * The location constants of the runtime file for `endpoints`, in code order,
 * each with the location it names: `dyn` is 0, `every` is 1, and the
 * endpoints follow from 2 in the order `choreobs.json` lists them.
 */
export function locationConstants(
  endpoints: readonly string[],
): readonly (RuntimeConstant & { readonly location: string })[] {
  return [formatLocation(DYN), formatLocation(EVERY), ...endpoints].map((location, code) => ({
    name: locationConstant(location),
    code,
    location,
  }));
}

/** The constant the generated code names payload kind `kind` with: `__kind_integer`, … */
export function kindConstantName(kind: CommKind): string {
  return `${KIND_CONSTANT_PREFIX}${kind}`;
}

/**
 * The kind constants, in code order: the order the communication API lists
 * its payload kinds in (spec §communication-api).
 */
export const KIND_CONSTANTS: readonly (RuntimeConstant & { readonly kind: CommKind })[] =
  ALL_COMM_KINDS.map((kind, code) => ({ name: kindConstantName(kind), code, kind }));

/**
 * The location `name` names if it has the form of a location constant —
 * `dyn`, `every` or what may be an endpoint — or `undefined`. Only the form is
 * checked: which endpoints exist is known where the endpoint list is, and
 * `locationConstants` decodes exactly against it.
 */
export function locationOfConstant(name: string): string | undefined {
  if (!name.startsWith(LOCATION_CONSTANT_PREFIX)) {
    return undefined;
  }
  const location = name.slice(LOCATION_CONSTANT_PREFIX.length);
  return location.length > 0 ? location : undefined;
}

/** The payload kind a kind constant names, or `undefined` if `name` is not one. */
export function kindOfConstant(name: string): CommKind | undefined {
  return KIND_CONSTANTS.find((constant) => constant.name === name)?.kind;
}

/**
 * Whether `name` has the form of a location constant or is a kind constant
 * (see `locationOfConstant` for what the form leaves unchecked).
 */
export function isRuntimeConstant(name: string): boolean {
  return locationOfConstant(name) !== undefined || kindOfConstant(name) !== undefined;
}

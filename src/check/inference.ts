import type { Span } from "../ast/span.js";
import type { Location } from "../ast/location.js";
import type { BaseType } from "../ast/syntax-types.js";
import type { Block, Statement } from "../ast/statements.js";
import type { LocatedType } from "../ast/typed.js";
import type { SpecRefs } from "../spec/ref.js";
import {
  DYN,
  formatLocation,
  joinLocations,
  locatedType,
  locationsCompatible,
} from "../types/located.js";

export type InferOk<T> = { readonly ok: true; readonly value: T };
export type InferErr = {
  readonly ok: false;
  readonly message: string;
  readonly spec: SpecRefs;
};
export type InferResult<T> = InferOk<T> | InferErr;

export function inferenceOk<T>(value: T): InferOk<T> {
  return { ok: true, value };
}

export function inferenceError(message: string, spec: SpecRefs = []): InferErr {
  return { ok: false, message, spec };
}

/** Resolved type of a `return expr;` candidate (spec §function-return-type-inference). */
export type ValueReturnCandidate = {
  readonly kind: "value";
  readonly type: LocatedType;
  readonly span: Span;
};

/** Bare `return;` candidate (spec §function-return-type-inference). */
export type UnitReturnCandidate = {
  readonly kind: "void";
  readonly span: Span;
};

export type ReturnCandidate = ValueReturnCandidate | UnitReturnCandidate;

/** Least upper bound on base types for return inference (spec §function-return-type-inference). */
export function lubBase(a: BaseType, b: BaseType): InferResult<BaseType> {
  if (a === b) {
    return inferenceOk(a);
  }
  return inferenceError(
    `incompatible return types: cannot compute least upper bound of ${a} and ${b}`,
    ["function-return-type-inference"],
  );
}

/**
 * What return inference does with two different concrete locations
 * (spec-dyn.md, sections 4.2 and 4.3): make the result `dyn`, or report it.
 */
export type IncompatibleLocations = "dyn" | "error";

/**
 * Least upper bound on locations for return inference (spec §function-return-type-inference).
 *
 * This is `⊔` (spec-dyn.md, section 3.1): a location with itself, and `dyn`
 * with anything. Two different concrete locations have none; what happens
 * then is the caller's choice, because it depends on the mode.
 */
export function lubLocation(
  a: Location,
  b: Location,
  onIncompatible: IncompatibleLocations = "error",
): InferResult<Location> {
  if (locationsCompatible(a, b)) {
    return inferenceOk(joinLocations(a, b));
  }
  if (onIncompatible === "dyn") {
    return inferenceOk(DYN);
  }
  return inferenceError(
    `incompatible return locations: cannot compute least upper bound of ${formatLocation(a)} and ${formatLocation(b)}`,
    ["function-return-type-inference", "incompatible-inferred-return-locations"],
  );
}

/** Least upper bound on located types for return inference (spec §function-return-type-inference). */
export function lubLocatedType(
  a: LocatedType,
  b: LocatedType,
  onIncompatible: IncompatibleLocations = "error",
): InferResult<LocatedType> {
  if (a.isArray || b.isArray) {
    if (a.isArray !== true || b.isArray !== true || a.base !== b.base) {
      return inferenceError(
        `incompatible return types: cannot compute least upper bound of ${a.isArray ? `${a.base}[]` : a.base} and ${b.isArray ? `${b.base}[]` : b.base} (array invariance)`,
        ["array-typing"],
      );
    }
    const location = lubLocation(a.location, b.location, onIncompatible);
    if (!location.ok) {
      return location;
    }
    return inferenceOk(locatedType(a.base, location.value, true));
  }
  const base = lubBase(a.base, b.base);
  if (!base.ok) {
    return base;
  }
  const location = lubLocation(a.location, b.location, onIncompatible);
  if (!location.ok) {
    return location;
  }
  return inferenceOk(locatedType(base.value, location.value));
}

/**
 * Conservative syntactic check that all paths return a value (spec §return-coverage-for-non-void-functions).
 * Accepts a final `return expr;` and `if`/`else` with both branches returning.
 */
export function checkReturnCoverage(block: Block): boolean {
  return blockDefinitelyReturnsValue(block);
}

function blockDefinitelyReturnsValue(block: Block): boolean {
  const statements = block.statements;
  if (statements.length === 0) {
    return false;
  }
  return statementDefinitelyReturnsValue(statements[statements.length - 1]!);
}

function statementDefinitelyReturnsValue(stmt: Statement): boolean {
  if (stmt.kind === "ReturnStatement") {
    return stmt.value !== undefined;
  }
  if (stmt.kind === "IfStatement" && stmt.else !== undefined) {
    return (
      blockDefinitelyReturnsValue(stmt.then) &&
      blockDefinitelyReturnsValue(stmt.else)
    );
  }
  return false;
}

/**
 * Merges collected return candidates into a function return type (spec §function-return-type-inference–§return-coverage-for-non-void-functions).
 */
export function inferReturnTypeFromCandidates(
  body: Block,
  functionLocation: Location,
  candidates: readonly ReturnCandidate[],
  onIncompatible: IncompatibleLocations = "error",
): InferResult<LocatedType> {
  if (candidates.length === 0) {
    return inferenceOk(locatedType("void", functionLocation));
  }

  const hasUnit = candidates.some((c) => c.kind === "void");
  const valueCandidates = candidates.filter(
    (c): c is ValueReturnCandidate => c.kind === "value",
  );

  if (hasUnit && valueCandidates.length > 0) {
    return inferenceError(
      "cannot mix bare return and return with value when return type is omitted",
      ["mixing-return-and-return-expr"],
    );
  }

  if (hasUnit) {
    return inferenceOk(locatedType("void", functionLocation));
  }

  let merged = valueCandidates[0]!.type;
  for (let i = 1; i < valueCandidates.length; i++) {
    const lub = lubLocatedType(merged, valueCandidates[i]!.type, onIncompatible);
    if (!lub.ok) {
      return lub;
    }
    merged = lub.value;
  }

  if (!checkReturnCoverage(body)) {
    return inferenceError(
      "not all execution paths return a value for inferred non-void function",
      ["return-coverage-for-non-void-functions"],
    );
  }

  return inferenceOk(merged);
}

/**
 * The location of a return type whose base is written and whose location is
 * not — `function f(): integer { … }` (spec-dyn.md, section 4.3). The location
 * comes from the values returned, like a fully omitted return type's; the base
 * is the annotation's, and the ordinary return checks compare it later.
 *
 * With no value returned there is nothing to take a location from. The
 * function then fails its return checks anyway, so `fallback` only has to be
 * some location for that to happen against.
 */
export function inferReturnLocation(
  candidates: readonly ReturnCandidate[],
  fallback: Location,
  onIncompatible: IncompatibleLocations,
): InferResult<Location> {
  const locations = candidates.flatMap((c) =>
    c.kind === "value" ? [c.type.location] : [],
  );
  if (locations.length === 0) {
    return inferenceOk(fallback);
  }
  let merged = locations[0]!;
  for (let i = 1; i < locations.length; i++) {
    const lub = lubLocation(merged, locations[i]!, onIncompatible);
    if (!lub.ok) {
      return lub;
    }
    merged = lub.value;
  }
  return inferenceOk(merged);
}

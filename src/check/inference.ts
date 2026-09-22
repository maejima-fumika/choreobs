import type { Span } from "../ast/span.js";
import type { Location } from "../ast/location.js";
import type { BaseType } from "../ast/syntax-types.js";
import type { Block, Statement } from "../ast/statements.js";
import type { LocatedType } from "../ast/typed.js";
import type { SpecRefs } from "../spec/ref.js";
import { locationsEqual, locatedType } from "../types/located.js";

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
  if (
    (a === "integer" && b === "float") ||
    (a === "float" && b === "integer")
  ) {
    return inferenceOk("float");
  }
  return inferenceError(
    `incompatible return types: cannot compute least upper bound of ${a} and ${b}`,
    ["function-return-type-inference"],
  );
}

/** Least upper bound on locations for return inference (spec §function-return-type-inference). */
export function lubLocation(a: Location, b: Location): InferResult<Location> {
  if (locationsEqual(a, b)) {
    return inferenceOk(a);
  }
  const aName = a.kind === "every" ? "every" : a.name;
  const bName = b.kind === "every" ? "every" : b.name;
  return inferenceError(
    `incompatible return locations: cannot compute least upper bound of ${aName} and ${bName}`,
    ["function-return-type-inference"],
  );
}

/** Least upper bound on located types for return inference (spec §function-return-type-inference). */
export function lubLocatedType(
  a: LocatedType,
  b: LocatedType,
): InferResult<LocatedType> {
  if (a.isArray || b.isArray) {
    if (a.isArray !== true || b.isArray !== true || a.base !== b.base) {
      return inferenceError(
        `incompatible return types: cannot compute least upper bound of ${a.isArray ? `${a.base}[]` : a.base} and ${b.isArray ? `${b.base}[]` : b.base} (array invariance)`,
        ["array-typing"],
      );
    }
    const location = lubLocation(a.location, b.location);
    if (!location.ok) {
      return location;
    }
    return inferenceOk(locatedType(a.base, location.value, true));
  }
  const base = lubBase(a.base, b.base);
  if (!base.ok) {
    return base;
  }
  const location = lubLocation(a.location, b.location);
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
    const lub = lubLocatedType(merged, valueCandidates[i]!.type);
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

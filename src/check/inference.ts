import type { Span } from "../ast/span.js";
import type { Location } from "../ast/location.js";
import type { BaseType } from "../ast/syntax-types.js";
import type { Block, Statement } from "../ast/statements.js";
import type { Expression } from "../ast/expressions.js";
import type { LocatedType } from "../ast/typed.js";
import { locationsEqual, locatedType, locationLabel } from "../types/located.js";

export type InferOk<T> = { readonly ok: true; readonly value: T };
export type InferErr = { readonly ok: false; readonly message: string };
export type InferResult<T> = InferOk<T> | InferErr;

export function inferenceOk<T>(value: T): InferOk<T> {
  return { ok: true, value };
}

export function inferenceError(message: string): InferErr {
  return { ok: false, message };
}

/** Resolved type of a `return expr;` candidate (spec §7.14.4). */
export type ValueReturnCandidate = {
  readonly kind: "value";
  readonly type: LocatedType;
  readonly span: Span;
};

/** Bare `return;` candidate (spec §7.14.4). */
export type UnitReturnCandidate = {
  readonly kind: "unit";
  readonly span: Span;
};

export type ReturnCandidate = ValueReturnCandidate | UnitReturnCandidate;

/** Supplies located types for `return expr;` during return-type inference. */
export type ExprTypeResolver = (expr: Expression) => InferResult<LocatedType>;

/** Least upper bound on base types for return inference (spec §7.14.4). */
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
    `incompatible return types: cannot compute least upper bound of ${a} and ${b} (spec §7.14.4)`,
  );
}

/** Least upper bound on locations for return inference (spec §7.14.4). */
export function lubLocation(a: Location, b: Location): InferResult<Location> {
  if (locationsEqual(a, b)) {
    return inferenceOk(a);
  }
  const aName = locationLabel(a);
  const bName = locationLabel(b);
  return inferenceError(
    `incompatible return locations: cannot compute least upper bound of ${aName} and ${bName} (spec §7.14.4)`,
  );
}

/** Least upper bound on located types for return inference (spec §7.14.4). */
export function lubLocatedType(
  a: LocatedType,
  b: LocatedType,
): InferResult<LocatedType> {
  if (a.isArray || b.isArray) {
    if (a.isArray !== true || b.isArray !== true || a.base !== b.base) {
      return inferenceError(
        `incompatible return types: cannot compute least upper bound of ${a.isArray ? `${a.base}[]` : a.base} and ${b.isArray ? `${b.base}[]` : b.base} (array invariance, spec §7.11.1)`,
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

/** Collects all `return` statements in a block tree (spec §7.14.4). */
export function collectReturnCandidates(
  block: Block,
  resolveExprType: ExprTypeResolver,
): InferResult<readonly ReturnCandidate[]> {
  const candidates: ReturnCandidate[] = [];
  const err = collectFromStatements(block.statements, resolveExprType, candidates);
  if (err !== undefined) {
    return err;
  }
  return inferenceOk(candidates);
}

function collectFromStatements(
  statements: readonly Statement[],
  resolveExprType: ExprTypeResolver,
  out: ReturnCandidate[],
): InferErr | undefined {
  for (const stmt of statements) {
    const err = collectFromStatement(stmt, resolveExprType, out);
    if (err !== undefined) {
      return err;
    }
  }
  return undefined;
}

function collectFromStatement(
  stmt: Statement,
  resolveExprType: ExprTypeResolver,
  out: ReturnCandidate[],
): InferErr | undefined {
  switch (stmt.kind) {
    case "ReturnStatement":
      if (stmt.value === undefined) {
        out.push({ kind: "unit", span: stmt.span });
        return undefined;
      }
      {
        const resolved = resolveExprType(stmt.value);
        if (!resolved.ok) {
          return resolved;
        }
        out.push({
          kind: "value",
          type: resolved.value,
          span: stmt.span,
        });
        return undefined;
      }
    case "IfStatement": {
      let err = collectFromStatements(stmt.then.statements, resolveExprType, out);
      if (err !== undefined) {
        return err;
      }
      if (stmt.else !== undefined) {
        err = collectFromStatements(stmt.else.statements, resolveExprType, out);
      }
      return err;
    }
    case "WhileStatement":
      return collectFromStatements(stmt.body.statements, resolveExprType, out);
    case "ForStatement":
      return collectFromStatements(stmt.body.statements, resolveExprType, out);
    default:
      return undefined;
  }
}

/**
 * Conservative syntactic check that all paths return a value (spec §7.14.6).
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
 * Merges collected return candidates into a function return type (spec §7.14.4–§7.14.6).
 */
export function inferReturnTypeFromCandidates(
  body: Block,
  functionLocation: Location,
  candidates: readonly ReturnCandidate[],
): InferResult<LocatedType> {
  if (candidates.length === 0) {
    return inferenceOk(locatedType("unit", functionLocation));
  }

  const hasUnit = candidates.some((c) => c.kind === "unit");
  const valueCandidates = candidates.filter(
    (c): c is ValueReturnCandidate => c.kind === "value",
  );

  if (hasUnit && valueCandidates.length > 0) {
    return inferenceError(
      "cannot mix bare return and return with value when return type is omitted (spec §7.14.5)",
    );
  }

  if (hasUnit) {
    return inferenceOk(locatedType("unit", functionLocation));
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
      "not all execution paths return a value for inferred non-unit function (spec §7.14.6)",
    );
  }

  return inferenceOk(merged);
}

/**
 * Infers a function return type when the annotation is omitted (spec §7.14.4–§7.14.6).
 */
export function inferFunctionReturnType(
  body: Block,
  functionLocation: Location,
  resolveExprType: ExprTypeResolver,
): InferResult<LocatedType> {
  const collected = collectReturnCandidates(body, resolveExprType);
  if (!collected.ok) {
    return collected;
  }
  return inferReturnTypeFromCandidates(
    body,
    functionLocation,
    collected.value,
  );
}

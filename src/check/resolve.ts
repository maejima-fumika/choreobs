import type { Span } from "../ast/span.js";
import type { Location } from "../ast/location.js";
import type { TypeAnnotation } from "../ast/syntax-types.js";
import type { LocatedLiteral, RawLiteral } from "../ast/literals.js";
import type { LocatedType } from "../ast/typed.js";
import { locatedType } from "../types/located.js";

/**
 * Resolve a written type annotation (spec §8.1).
 *
 * The location is never inferred from the surrounding *context*. `inferred` is
 * supplied only where the location follows from the declaration itself — an
 * initialized `let` takes it from the initializer (spec §7.14.1). A written
 * `@L` always wins.
 *
 * `void` is the exception: it holds no value, so it has no location and must not
 * be written with one (spec §7.3). The checker still stores a location on it so
 * that it travels through the ordinary machinery; that location is internal and
 * is never shown or compared against a written one.
 */
export function resolveTypeAnnotation(
  ann: TypeAnnotation,
  inferred?: Location,
): LocatedType {
  if (ann.base === "void") {
    if (ann.location !== undefined) {
      throw new TypeResolveError(
        "`void` has no location (spec §7.3, §16.40)",
        ann.span,
      );
    }
    return locatedType("void", inferred ?? { kind: "every" });
  }
  const location = ann.location?.location ?? inferred;
  if (location === undefined) {
    throw new TypeResolveError(
      "location annotation required on type (spec §8.1, §16.3)",
      ann.span,
    );
  }
  return locatedType(ann.base, location);
}

/** Resolve a written literal (spec §8.1); the location is never inferred. */
export function resolveLiteralType(lit: LocatedLiteral): LocatedType {
  const base = rawLiteralBaseType(lit.literal);
  if (lit.location === undefined) {
    throw new TypeResolveError(
      "location annotation required on literal (spec §8.1, §16.3)",
      lit.span,
    );
  }
  return locatedType(base, lit.location.location);
}

/** Array element base types are restricted (spec §16.29). Unrelated to locations. */
export function validateArrayTypeAnnotation(ann: TypeAnnotation): void {
  if (!ann.isArray) {
    return;
  }
  if (ann.base !== "integer" && ann.base !== "float" && ann.base !== "boolean") {
    throw new TypeResolveError(
      `unsupported array element type '${ann.base}' (spec §16.29)`,
      ann.span,
    );
  }
}

export function rawLiteralBaseType(raw: RawLiteral): LocatedType["base"] {
  switch (raw.kind) {
    case "IntegerLiteral":
      return "integer";
    case "FloatLiteral":
      return "float";
    case "StringLiteral":
      return "string";
    case "BooleanLiteral":
      return "boolean";
    case "NullLiteral":
      return "null";
  }
}

export class TypeResolveError extends Error {
  constructor(
    message: string,
    readonly span: Span,
  ) {
    super(message);
    this.name = "TypeResolveError";
  }
}

import type { Span } from "../ast/span.js";
import type { SpecRefs } from "../spec/ref.js";
import type { Location } from "../ast/location.js";
import type { TypeAnnotation } from "../ast/syntax-types.js";
import type { LocatedLiteral, RawLiteral } from "../ast/literals.js";
import type { LocatedType } from "../ast/typed.js";
import { locatedType } from "../types/located.js";

/**
 * Resolve a written type annotation (spec §explicit-location-annotations).
 *
 * The location is never inferred from the surrounding *context*. `inferred` is
 * supplied only where the location follows from the declaration itself — an
 * initialized `let` takes it from the initializer (spec §let-type-inference). A written
 * `@L` always wins.
 *
 * `fallback` is what an omission that nothing infers means: `dyn` where the
 * program may leave locations to run time (spec §omitted-locations), and
 * nothing — an error — in strict mode and inside a local function (spec §strict-mode).
 *
 * `void` is the exception: it holds no value, so it has no location and must not
 * be written with one (spec §void). The checker still stores a location on it so
 * that it travels through the ordinary machinery; that location is internal and
 * is never shown or compared against a written one.
 */
export function resolveTypeAnnotation(
  ann: TypeAnnotation,
  inferred?: Location,
  fallback?: Location,
): LocatedType {
  if (ann.base === "void") {
    if (ann.location !== undefined) {
      throw new TypeResolveError(
        "`void` has no location",
        ann.span,
        ["void", "invalid-use-of-void"],
      );
    }
    return locatedType("void", inferred ?? { kind: "every" });
  }
  const location = ann.location?.location ?? inferred ?? fallback;
  if (location === undefined) {
    throw new TypeResolveError(
      "location annotation required on type",
      ann.span,
      ["explicit-location-annotations", "location-annotation-omission"],
    );
  }
  return locatedType(ann.base, location);
}

/**
 * Resolve a written literal (spec §explicit-location-annotations); the location is never inferred.
 * An omitted one means `fallback` when there is one (spec §omitted-locations).
 */
export function resolveLiteralType(
  lit: LocatedLiteral,
  fallback?: Location,
): LocatedType {
  const base = rawLiteralBaseType(lit.literal);
  const location = lit.location?.location ?? fallback;
  if (location === undefined) {
    throw new TypeResolveError(
      "location annotation required on literal",
      lit.span,
      ["explicit-location-annotations", "location-annotation-omission"],
    );
  }
  return locatedType(base, location);
}

/** Array element base types are restricted (spec §unsupported-array-element-type). Unrelated to locations. */
export function validateArrayTypeAnnotation(ann: TypeAnnotation): void {
  if (!ann.isArray) {
    return;
  }
  if (ann.base !== "integer" && ann.base !== "float" && ann.base !== "boolean") {
    throw new TypeResolveError(
      `unsupported array element type '${ann.base}'`,
      ann.span,
      ["unsupported-array-element-type"],
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
    readonly spec: SpecRefs = [],
  ) {
    super(message);
    this.name = "TypeResolveError";
  }
}

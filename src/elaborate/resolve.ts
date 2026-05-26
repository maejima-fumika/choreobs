import type { Span } from "../ast/span.js";
import type { TypeAnnotation } from "../ast/syntax-types.js";
import type { Location, LocationAnnotation } from "../ast/location.js";
import type { ExecutionContext } from "../ast/context.js";
import type { LocatedLiteral, RawLiteral } from "../ast/literals.js";
import type { LocatedType } from "../ast/typed.js";
import { contextAsLocation, locatedType } from "../types/located.js";

export function defaultLocationForContext(ctx: ExecutionContext): Location {
  return contextAsLocation(ctx);
}

export function resolveTypeAnnotation(
  ann: TypeAnnotation,
  ctx: ExecutionContext,
  allowOmit: boolean,
): LocatedType {
  let location: Location;
  if (ann.location !== undefined) {
    location = ann.location.location;
  } else if (allowOmit && ctx.kind === "local") {
    location = defaultLocationForContext(ctx);
  } else {
    throw new LocationOmitError(
      "location annotation required in @every context (spec §8.2, §8.3)",
      ann.span,
    );
  }
  return locatedType(ann.base, location);
}

export function resolveLiteralType(
  lit: LocatedLiteral,
  ctx: ExecutionContext,
  allowOmit: boolean,
): LocatedType {
  const base = rawLiteralBaseType(lit.literal);
  let location: Location;
  if (lit.location !== undefined) {
    location = lit.location.location;
  } else if (allowOmit && ctx.kind === "local") {
    location = defaultLocationForContext(ctx);
  } else {
    throw new LocationOmitError(
      "location annotation required on literal in @every context (spec §8.2, §8.3)",
      lit.span,
    );
  }
  return locatedType(base, location);
}

function rawLiteralBaseType(raw: RawLiteral): LocatedType["base"] {
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

export class LocationOmitError extends Error {
  constructor(
    message: string,
    readonly span: Span,
  ) {
    super(message);
    this.name = "LocationOmitError";
  }
}

export function cloneLocationAnnotation(
  loc: Location,
  span: Span,
): LocationAnnotation {
  return {
    kind: "LocationAnnotation",
    location: loc,
    span,
  };
}

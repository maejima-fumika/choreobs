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
  } else if (ctx.kind === "local") {
    location = defaultLocationForContext(ctx);
  } else {
    // Gradual ChoreoBS: omitted locations in global/@every contexts default
    // to @dynamic (spec §18.4).
    location = { kind: "dynamic" };
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
  } else if (ctx.kind === "local") {
    location = defaultLocationForContext(ctx);
  } else {
    // Gradual ChoreoBS: an unlocated literal in a global/@every context is a
    // dynamic value whose runtime location is `every` (spec §18.3, §18.5).
    location = { kind: "dynamic" };
  }
  return locatedType(base, location);
}

export function validateArrayTypeAnnotation(ann: TypeAnnotation): void {
  if (!ann.isArray) {
    return;
  }
  if (ann.base !== "integer" && ann.base !== "float" && ann.base !== "boolean") {
    throw new LocationOmitError(
      `unsupported array element type '${ann.base}' (spec §16.29)`,
      ann.span,
    );
  }
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

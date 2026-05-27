import type { BaseType } from "../ast/syntax-types.js";
import type { Location } from "../ast/location.js";
import type { ExecutionContext } from "../ast/context.js";
import type { LocatedType } from "../ast/typed.js";

/** Base type subtyping (spec §7.5). */
export function isSubtype(source: BaseType, target: BaseType): boolean {
  if (source === target) {
    return true;
  }
  return source === "integer" && target === "float";
}

export function locatedTypesCompatible(
  source: LocatedType,
  target: LocatedType,
): boolean {
  return isSubtype(source.base, target.base) && locationsEqual(source.location, target.location);
}

export function locationsEqual(a: Location, b: Location): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === "every") {
    return true;
  }
  return b.kind === "concrete" && a.name === b.name;
}

/**
 * `available(Lvalue, Luse)` (spec §7.6).
 *
 * `Luse` is the location of the current execution context.
 */
export function available(valueLoc: Location, useLoc: Location): boolean {
  if (locationsEqual(valueLoc, useLoc)) {
    return true;
  }
  if (valueLoc.kind === "every" && useLoc.kind === "concrete") {
    return true;
  }
  return false;
}

/** `localAvailable(L, P)` — values in `function@P` may only use location `P`. */
export function localAvailable(
  valueLoc: Location,
  participant: string,
): boolean {
  return valueLoc.kind === "concrete" && valueLoc.name === participant;
}

/** Execution context as the `Luse` location for availability checks. */
export function contextAsLocation(ctx: ExecutionContext): Location {
  if (ctx.kind === "every") {
    return { kind: "every" };
  }
  return { kind: "concrete", name: ctx.participant };
}

export function formatLocatedType(type: LocatedType): string {
  const loc =
    type.location.kind === "every" ? "every" : type.location.name;
  return `${type.base}@${loc}`;
}

export function locatedType(
  base: BaseType,
  location: Location,
): LocatedType {
  return { base, location };
}

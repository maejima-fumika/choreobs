import { SPEC_SECTIONS, type SpecId } from "./sections.js";

export type { SpecId };

/**
 * The spec sections a diagnostic rests on, in reading order: the semantic rule
 * first, then the entry in the error catalogue of chapter 16 where one exists.
 *
 * Nothing treats the first element as primary. Tests ask whether a citation is
 * present, and the CLI prints them all.
 */
export type SpecRefs = readonly SpecId[];

/** Carried by every shape that can cite the spec. */
export interface SpecCited {
  readonly spec: SpecRefs;
}

/** `§7.8` — the only place a section number is turned into text. */
export function specNumber(id: SpecId): string {
  return `§${SPEC_SECTIONS[id].number}`;
}

/**
 * `(spec §7.11, §16.42)`, for the few channels that carry a string and nothing
 * else — the internal-error throws that mark a compiler bug.
 */
export function specRef(...ids: SpecId[]): string {
  return `(spec ${ids.map(specNumber).join(", ")})`;
}

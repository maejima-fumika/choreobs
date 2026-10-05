import type { SpecCited, SpecRefs } from "../spec/ref.js";

/**
 * A command that cannot go on: a workspace that disagrees with `choreobs.json`,
 * a `bscript` that fails, a bad argument. Carries the rules it rests on, as a
 * diagnostic does.
 */
export class CommandError extends Error implements SpecCited {
  constructor(
    message: string,
    readonly spec: SpecRefs = [],
  ) {
    super(message);
    this.name = "CommandError";
  }
}

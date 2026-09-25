import type { CommTag } from "../ast/typed.js";

/** Assigns communication tags per scope (spec §communication-tags). */
export class CommTagGenerator {
  private readonly counters = new Map<string, number>();

  next(scope: string): CommTag {
    const serial = this.counters.get(scope) ?? 0;
    this.counters.set(scope, serial + 1);
    return `${scope}_${serial}`;
  }
}

/**
 * The scope name tags at the top level are numbered within
 * (spec §communication-tags).
 *
 * It carries the compiler-reserved `__` prefix (spec §function-names), so no
 * user function name can equal it and no function's tags can collide with the
 * top level's.
 */
export const TOP_SCOPE = "__top";

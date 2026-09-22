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

export const TOP_SCOPE = "top";

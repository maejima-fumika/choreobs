import type { AstNode } from "./span.js";
import type { ExecutionContext } from "./context.js";
import type { FunctionDeclaration } from "./declarations.js";
import type { Statement } from "./statements.js";

export type TopLevelItem = FunctionDeclaration | TopLevelStatement;

/**
 * A top-level statement executed in the implicit `@every` context (spec §top-level-statements).
 *
 * `context.kind` is always `"every"`; it is stored on the node so
 * statement checking and EPP can treat top-level and function bodies uniformly.
 */
export interface TopLevelStatement extends AstNode {
  readonly kind: "TopLevelStatement";
  readonly context: ExecutionContext;
  readonly statement: Statement;
}

/** Root node: `TopLevelItem*` (spec §program). */
export interface Program extends AstNode {
  readonly kind: "Program";
  readonly items: readonly TopLevelItem[];
}

import type { AstNode } from "./span.js";
import type { ExecutionContext } from "./context.js";
import type { FunctionDeclaration } from "./declarations.js";
import type { ImportDeclaration } from "./imports.js";
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

/**
 * Root node: `ImportDeclaration* TopLevelItem*` (spec §program).
 *
 * Imports are kept apart from `items`: they come first in the source
 * (spec §import-declarations), no pass but import resolution and EPP looks at
 * them, and every pass over `items` knows only functions and statements.
 */
export interface Program extends AstNode {
  readonly kind: "Program";
  readonly imports: readonly ImportDeclaration[];
  readonly items: readonly TopLevelItem[];
}

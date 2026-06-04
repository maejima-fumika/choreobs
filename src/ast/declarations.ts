import type { AstNode } from "./span.js";
import type { Location } from "./location.js";
import type { ExecutionContext } from "./context.js";
import type { TypeAnnotation } from "./syntax-types.js";
import type { Block } from "./statements.js";

/**
 * Function declaration (spec §5.3).
 * `returnType` is present for `function f@L(...): T { ... }`, omitted when inferred (§7.14.4).
 * Omitted `function f(...)` is elaborated as `function f@every(...)` (Gradual ChoreoBS).
 */
export interface FunctionDeclaration extends AstNode {
  readonly kind: "FunctionDeclaration";
  readonly name: string;
  /** Function location; defaults to `every` when `@Location` is omitted in the source. */
  readonly at: Location;
  /**
   * Execution context of the function body (derived from {@link at}).
   * Stored explicitly so consumers need not re-derive it for EPP and checking.
   */
  readonly context: ExecutionContext;
  readonly params: readonly Parameter[];
  readonly returnType?: TypeAnnotation;
  readonly body: Block;
}

/** Function parameter; type annotation is always required (spec §7.14.7). */
export interface Parameter extends AstNode {
  readonly kind: "Parameter";
  readonly name: string;
  readonly type: TypeAnnotation;
}

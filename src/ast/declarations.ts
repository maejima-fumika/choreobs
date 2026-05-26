import type { AstNode } from "./span.js";
import type { Location } from "./location.js";
import type { ExecutionContext } from "./context.js";
import type { TypeAnnotation } from "./syntax-types.js";
import type { Block } from "./statements.js";

/** `function name@location(…): Type { … }` (spec §5.3). */
export interface FunctionDeclaration extends AstNode {
  readonly kind: "FunctionDeclaration";
  readonly name: string;
  /** Location after `@` on the function name. */
  readonly at: Location;
  /**
   * Execution context of the function body (derived from {@link at}).
   * Stored explicitly so consumers need not re-derive it for EPP and checking.
   */
  readonly context: ExecutionContext;
  readonly params: readonly Parameter[];
  readonly returnType: TypeAnnotation;
  readonly body: Block;
}

export interface Parameter extends AstNode {
  readonly kind: "Parameter";
  readonly name: string;
  readonly type: TypeAnnotation;
}

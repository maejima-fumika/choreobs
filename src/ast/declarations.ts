import type { AstNode } from "./span.js";
import type { Location } from "./location.js";
import type { ExecutionContext } from "./context.js";
import type { TypeAnnotation } from "./syntax-types.js";
import type { Block } from "./statements.js";

/**
 * Function declaration (spec §function-declaration).
 * `returnType` is present for `function f@L(...): T { ... }`, omitted when inferred (§function-return-type-inference).
 */
export interface FunctionDeclaration extends AstNode {
  readonly kind: "FunctionDeclaration";
  readonly name: string;
  /**
   * Location written after `@` on the function name: the one endpoint that runs
   * the function, which makes it a local function. A choreography function runs
   * at every endpoint, so no single location names it and this is absent
   * (spec §function-kinds).
   *
   * `every` and `dyn` can be written here syntactically, but the checker
   * rejects them (spec §every-on-a-function-declaration, §dyn-on-a-function-declaration).
   */
  readonly at?: Location;
  /**
   * Execution context of the function body (derived from {@link at}).
   * Stored explicitly so consumers need not re-derive it for EPP and checking.
   */
  readonly context: ExecutionContext;
  readonly params: readonly Parameter[];
  readonly returnType?: TypeAnnotation;
  readonly body: Block;
}

/** Function parameter; type annotation is always required (spec §parameter-types-are-not-inferred). */
export interface Parameter extends AstNode {
  readonly kind: "Parameter";
  readonly name: string;
  readonly type: TypeAnnotation;
}

import type { AstNode } from "./span.js";
import type { LocationAnnotation } from "./location.js";

/**
 * `import@P { a, b as c } from "./file";` (spec §import-declarations).
 *
 * The parser accepts any location after `@`; `every`, `dyn` and endpoints
 * that `choreobs.json` does not list are rejected when the import is resolved
 * (spec §invalid-import-location, §unknown-endpoint).
 */
export interface ImportDeclaration extends AstNode {
  readonly kind: "ImportDeclaration";
  readonly at: LocationAnnotation;
  /** At least one, in source order. */
  readonly specifiers: readonly ImportSpecifier[];
  readonly module: ModuleSpecifier;
}

/**
 * `imported` or `imported as local`. Without `as`, `local` is `imported`.
 * `imported` may be a ChoreoBS reserved word only when `as` follows it.
 */
export interface ImportSpecifier extends AstNode {
  readonly kind: "ImportSpecifier";
  readonly imported: string;
  readonly local: string;
}

/** The string after `from`, decoded, with the span of the literal. */
export interface ModuleSpecifier extends AstNode {
  readonly kind: "ModuleSpecifier";
  readonly value: string;
}

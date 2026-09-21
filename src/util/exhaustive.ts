/**
 * Compile-time exhaustiveness guard for discriminated unions.
 *
 * Used as the `default` arm of a `switch` over a node kind. Every variant must
 * be handled for `value` to narrow to `never`, so adding a new kind to the AST
 * turns every switch that forgot it into a type error instead of a silent
 * fallthrough. Reaching it at run time means the compiler has an internal bug.
 */
export function assertNever(value: never, what: string): never {
  const kind = (value as { readonly kind?: unknown }).kind;
  throw new Error(`internal error: unhandled ${what} '${String(kind)}'`);
}

export interface ChoreoBSConfig {
  readonly endpoints: readonly string[];
  /**
   * Whether an omitted location that nothing infers becomes `@dyn`
   * (spec-dyn.md, sections 4.1 and 4.2). Absent means `true`; `false` is the
   * strict mode, where such an omission is an error and only a written `@dyn`
   * is dynamic.
   */
  readonly implicitDyn?: boolean;
}

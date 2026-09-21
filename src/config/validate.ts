/**
 * Validation of the endpoint set itself (spec §2.2).
 *
 * This is about `choreobs.json`, not about the program: neither rule can point
 * at a span in the source. It lives here rather than in the type checker, which
 * validates *locations against* the set (`@foo` must name a declared endpoint)
 * and has no business judging the set.
 *
 * Returns the reason a set is rejected, or `undefined` when it is well formed,
 * so that each caller can frame it: {@link loadConfig} prefixes the config
 * path, the driver reports it as a spanless diagnostic.
 */
export function validateEndpoints(
  endpoints: readonly string[],
): string | undefined {
  if (endpoints.includes("every")) {
    return "'every' must not appear in endpoints (spec §2.2)";
  }
  // A repeated endpoint would give two output files the same name and make one
  // endpoint both sender and receiver of the same tag (spec §2.2).
  const seen = new Set<string>();
  for (const name of endpoints) {
    if (seen.has(name)) {
      return `duplicate endpoint '${name}' in endpoints (spec §2.2)`;
    }
    seen.add(name);
  }
  return undefined;
}

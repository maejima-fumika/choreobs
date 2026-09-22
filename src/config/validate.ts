import { isIdentifierName } from "../lexer/index.js";
import { COMPILER_NAME_PREFIX } from "../runtime/names.js";

/**
 * Validation of the endpoint set itself (spec §choreobs-json).
 *
 * This is about `choreobs.json`, not about the program: no rule here can point
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
  // An endpoint name is written after `@` in the source (spec §types) and is
  // pasted into the output file name (spec §output-files). A name that is not an
  // identifier can therefore never be referred to by any program, and still
  // names a file — `../x` would put that file outside the output directory.
  for (const name of endpoints) {
    if (!isIdentifierName(name)) {
      return `endpoint ${JSON.stringify(name)} is not a valid identifier (spec §2.2, §4.3, §16.47)`;
    }
    // The `__` prefix belongs to the compiler (spec §identifiers, §function-names), and a
    // location is written as an identifier like any other name. Reserving it
    // here keeps endpoints consistent with variables, parameters and
    // functions, which the checker already rejects.
    if (name.startsWith(COMPILER_NAME_PREFIX)) {
      return `endpoint '${name}' must not begin with '${COMPILER_NAME_PREFIX}', which is reserved for the compiler (spec §2.2, §6.2, §16.47)`;
    }
  }
  // A repeated endpoint would give two output files the same name and make one
  // endpoint both sender and receiver of the same tag (spec §choreobs-json).
  const seen = new Set<string>();
  for (const name of endpoints) {
    if (seen.has(name)) {
      return `duplicate endpoint '${name}' in endpoints (spec §2.2)`;
    }
    seen.add(name);
  }
  return undefined;
}

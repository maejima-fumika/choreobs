import { isIdentifierName } from "../lexer/index.js";
import { COMPILER_NAME_PREFIX } from "../runtime/names.js";
import type { SpecCited } from "../spec/ref.js";

/** Why an endpoint set is rejected, and the rules it breaks. */
export interface EndpointsProblem extends SpecCited {
  readonly message: string;
}

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
 * path, the driver reports it as a spanless diagnostic. The citation rides
 * alongside the message rather than inside it, so neither framing can flatten
 * it away.
 */
export function validateEndpoints(
  endpoints: readonly string[],
): EndpointsProblem | undefined {
  // `every` and `dyn` are locations of their own, not endpoint names
  // (spec §every, §dyn). Both are keywords, so the identifier
  // check below would reject them too, but only with a message about syntax.
  for (const reserved of ["every", "dyn"]) {
    if (endpoints.includes(reserved)) {
      return {
        message: `'${reserved}' must not appear in endpoints`,
        spec: ["choreobs-json", "using-every-as-an-endpoint"],
      };
    }
  }
  // An endpoint name is written after `@` in the source (spec §types) and is
  // pasted into the output file name (spec §output-files). A name that is not an
  // identifier can therefore never be referred to by any program, and still
  // names a file — `../x` would put that file outside the output directory.
  for (const name of endpoints) {
    if (!isIdentifierName(name)) {
      return {
        message: `endpoint ${JSON.stringify(name)} is not a valid identifier`,
        spec: ["choreobs-json", "identifiers", "invalid-endpoint-name"],
      };
    }
    // The `__` prefix belongs to the compiler (spec §identifiers, §function-names), and a
    // location is written as an identifier like any other name. Reserving it
    // here keeps endpoints consistent with variables, parameters and
    // functions, which the checker already rejects.
    if (name.startsWith(COMPILER_NAME_PREFIX)) {
      return {
        message: `endpoint '${name}' must not begin with '${COMPILER_NAME_PREFIX}', which is reserved for the compiler`,
        spec: ["choreobs-json", "function-names", "invalid-endpoint-name"],
      };
    }
  }
  // A repeated endpoint would give two output files the same name and make one
  // endpoint both sender and receiver of the same tag (spec §choreobs-json).
  const seen = new Set<string>();
  for (const name of endpoints) {
    if (seen.has(name)) {
      return {
        message: `duplicate endpoint '${name}' in endpoints`,
        spec: ["choreobs-json"],
      };
    }
    seen.add(name);
  }
  return undefined;
}

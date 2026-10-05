import { isIdentifierName } from "../lexer/index.js";
import { COMPILER_NAME_PREFIX } from "../runtime/names.js";
import type { SpecCited } from "../spec/ref.js";
import { effectiveDeviceName, type EndpointConfig, type ProjectConfig } from "./types.js";

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
  // An endpoint name is written after `@` in the source (spec §types) and
  // names the endpoint's directory in the workspace (spec §output-files). A name
  // that is not an identifier can therefore never be referred to by any
  // program, and still names a directory — `../x` would put it outside the
  // workspace.
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
  // A repeated endpoint would give two endpoints the same directory and make
  // one endpoint both sender and receiver of the same tag (spec §choreobs-json).
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
  // Names that differ only in case are distinct identifiers, but a file system
  // that ignores case — macOS's default — gives them one directory.
  const byFolded = new Map<string, string>();
  for (const name of endpoints) {
    const other = byFolded.get(name.toLowerCase());
    if (other !== undefined) {
      return {
        message: `endpoints '${other}' and '${name}' differ only in case`,
        spec: ["choreobs-json"],
      };
    }
    byFolded.set(name.toLowerCase(), name);
  }
  return undefined;
}

/**
 * No two `esp32` endpoints may go by the same device name, a missing one
 * counting as BlueScript's default: nothing would decide which board runs
 * which endpoint's program (spec §choreobs-json).
 */
export function validateDeviceNames(
  endpoints: readonly EndpointConfig[],
): EndpointsProblem | undefined {
  const owners = new Map<string, string>();
  for (const endpoint of endpoints) {
    const deviceName = effectiveDeviceName(endpoint);
    if (deviceName === undefined) {
      continue;
    }
    const owner = owners.get(deviceName);
    if (owner !== undefined) {
      return {
        message: `endpoints '${owner}' and '${endpoint.name}' have the same device name '${deviceName}'; give each esp32 endpoint a "deviceName" of its own`,
        spec: ["choreobs-json"],
      };
    }
    owners.set(deviceName, endpoint.name);
  }
  return undefined;
}

/**
 * Every rule of spec §choreobs-json that relates entries to one another, for a
 * configuration whose entries are each well formed: the one `loadConfig` reads,
 * and the one `choreobs add-endpoint` is about to write.
 */
export function validateProject(config: ProjectConfig): EndpointsProblem | undefined {
  return (
    validateEndpoints(config.endpoints.map((endpoint) => endpoint.name)) ??
    validateDeviceNames(config.endpoints)
  );
}

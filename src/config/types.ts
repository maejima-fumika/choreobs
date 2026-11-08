/**
 * What the compiler itself needs to know about a program's endpoints: their
 * names, and the strict-mode switch. Everything from type checking to emission
 * takes this, and nothing more, so a caller that has no `choreobs.json` — the
 * fuzz scripts, the tests — can still make one.
 */
export interface ChoreoBSConfig {
  readonly endpoints: readonly string[];
  /**
   * Whether an omitted location that nothing infers becomes `@dyn`
   * (spec §omitted-locations, §strict-mode). Absent means `true`; `false` is the
   * strict mode, where such an omission is an error and only a written `@dyn`
   * is dynamic.
   */
  readonly implicitDyn?: boolean;
}

/** The BlueScript boards an endpoint can run on (spec §choreobs-json). */
export const BOARD_NAMES = ["esp32", "host"] as const;

export type BoardName = (typeof BOARD_NAMES)[number];

export function isBoardName(name: string): name is BoardName {
  return (BOARD_NAMES as readonly string[]).includes(name);
}

/**
 * The device name an `esp32` endpoint has when `choreobs.json` gives none —
 * BlueScript's own default (spec §choreobs-json).
 */
export const DEFAULT_DEVICE_NAME = "BLUESCRIPT";

/** One entry of `endpoints` in `choreobs.json` (spec §choreobs-json). */
export interface EndpointConfig {
  readonly name: string;
  readonly board: BoardName;
  /** Only ever set for an `esp32` endpoint. */
  readonly deviceName?: string;
  /**
   * The BlueScript packages the endpoint's project depends on: each package's
   * name to where it comes from, `<git-url>` or `<git-url>#<tag>`, as
   * `bsconfig.json` writes them (spec §choreobs-json, §bluescript-packages).
   * Absent when the endpoint lists none.
   */
  readonly dependencies?: Readonly<Record<string, string>>;
}

/** The endpoint's dependencies, empty when it lists none (spec §bluescript-packages). */
export function endpointDependencies(endpoint: EndpointConfig): Readonly<Record<string, string>> {
  return endpoint.dependencies ?? {};
}

/** Where a package comes from: a git URL, and the tag or branch to check out. */
export interface PackageSource {
  readonly url: string;
  readonly tag?: string;
}

/**
 * A dependency's value split as `bscript` splits it: the URL, and what follows
 * `#` as the tag (spec §choreobs-json).
 */
export function splitPackageSource(source: string): PackageSource {
  const hash = source.indexOf("#");
  return hash < 0 ? { url: source } : { url: source.slice(0, hash), tag: source.slice(hash + 1) };
}

/** `choreobs.json` (spec §choreobs-json). */
export interface ProjectConfig {
  /** Names the project. Nothing in compilation depends on it. */
  readonly name: string;
  readonly endpoints: readonly EndpointConfig[];
  readonly implicitDyn?: boolean;
}

/** The part of a project's configuration the compiler reads. */
export function compilerConfig(project: ProjectConfig): ChoreoBSConfig {
  const endpoints = project.endpoints.map((endpoint) => endpoint.name);
  return project.implicitDyn === undefined
    ? { endpoints }
    : { endpoints, implicitDyn: project.implicitDyn };
}

/**
 * The device name `bscript` connects to for `endpoint`, or `undefined` for a
 * board that is not reached over Bluetooth (spec §choreobs-json).
 */
export function effectiveDeviceName(endpoint: EndpointConfig): string | undefined {
  return endpoint.board === "esp32" ? endpoint.deviceName ?? DEFAULT_DEVICE_NAME : undefined;
}

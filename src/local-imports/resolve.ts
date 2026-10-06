import type { Span } from "../ast/span.js";
import type { ImportDeclaration } from "../ast/imports.js";
import type { LocatedType } from "../ast/typed.js";
import type { IndividualLocation } from "../ast/location.js";
import type { SpecRefs } from "../spec/ref.js";
import { locatedType } from "../types/located.js";
import { readBsModule, type BsModule, type BsModuleResult, type FilePosition } from "./bs-module.js";
import type { ImportDiagnostic } from "./errors.js";
import {
  SOURCE_FILE_EXTENSION,
  shownSourcePath,
  sourceFileOwner,
  type SourceFiles,
} from "./source-files.js";

/** What every imported name has: where it comes from and where it was imported (spec §imported-names). */
interface ImportedBase {
  /** The name the program uses. */
  readonly name: string;
  /** The name the file exports it under. */
  readonly exportedName: string;
  /** The endpoint it is imported at. */
  readonly endpoint: string;
  /** The file, as a path below `src/` (a key of {@link SourceFiles}). */
  readonly file: string;
  /** The specifier that imports it. */
  readonly span: Span;
}

/** A local function at `endpoint` whose body is BlueScript (spec §imported-names). */
export interface ImportedFunction extends ImportedBase {
  readonly kind: "ImportedFunction";
  readonly context: { readonly kind: "local"; readonly endpoint: string };
  readonly params: readonly LocatedType[];
  readonly returnType: LocatedType;
}

/** A top-level constant at `endpoint` (spec §imported-names). */
export interface ImportedConstant extends ImportedBase {
  readonly kind: "ImportedConstant";
  readonly type: LocatedType;
}

export type ImportedBinding = ImportedFunction | ImportedConstant;

/** One binding per import specifier, in source order. */
export interface ResolvedImports {
  readonly bindings: readonly ImportedBinding[];
}

export const NO_IMPORTS: ResolvedImports = { bindings: [] };

export interface ResolveImportsResult {
  readonly imports: ResolvedImports | null;
  readonly errors: readonly ImportDiagnostic[];
}

/**
 * Finds the file each import names and the type of each name it imports
 * (spec §import-declarations, §imported-signatures). Stops at the first
 * problem, as the checker does. Whether the names may be bound — reserved
 * names, clashes — is the checker's question (spec §imported-names).
 */
export function resolveImports(
  imports: readonly ImportDeclaration[],
  files: SourceFiles,
  endpoints: readonly string[],
): ResolveImportsResult {
  const resolver = new ImportResolver(files, endpoints);
  try {
    return { imports: { bindings: imports.flatMap((decl) => resolver.resolve(decl)) }, errors: [] };
  } catch (e) {
    if (e instanceof ImportFailure) {
      return { imports: null, errors: [e.diagnostic] };
    }
    throw e;
  }
}

class ImportFailure extends Error {
  constructor(readonly diagnostic: ImportDiagnostic) {
    super(diagnostic.message);
  }
}

class ImportResolver {
  private readonly modules = new Map<string, BsModuleResult>();

  constructor(
    private readonly files: SourceFiles,
    private readonly endpoints: readonly string[],
  ) {}

  resolve(decl: ImportDeclaration): ImportedBinding[] {
    const endpoint = this.importLocation(decl);
    const file = this.importedFile(decl, endpoint.name);
    const module = this.module(decl, file);
    return decl.specifiers.map((spec): ImportedBinding => {
      const base = { name: spec.local, exportedName: spec.imported, endpoint: endpoint.name, file, span: spec.span };
      const entry = module.exports.get(spec.imported);
      const shown = shownSourcePath(file);
      if (entry === undefined) {
        const why = module.unexported.get(spec.imported);
        fail(
          why === undefined
            ? `'${spec.imported}' is not declared in ${shown}`
            : `'${spec.imported}' ${why} in ${shown}`,
          spec.span,
          ["imported-signatures", "name-not-exported"],
        );
      }
      switch (entry.kind) {
        case "unsupported":
          fail(
            `${at(file, entry.at)}: '${spec.imported}' cannot be imported: ${entry.reason}`,
            spec.span,
            ["imported-signatures", "unsupported-export"],
          );
        case "function":
          return {
            ...base,
            kind: "ImportedFunction",
            context: { kind: "local", endpoint: endpoint.name },
            params: entry.params.map((type) => locatedType(type, endpoint)),
            returnType: locatedType(entry.returnType, endpoint),
          };
        case "constant":
          return { ...base, kind: "ImportedConstant", type: locatedType(entry.type, endpoint) };
      }
    });
  }

  /** The endpoint an import is at (spec §import-declarations). */
  private importLocation(decl: ImportDeclaration): IndividualLocation {
    const location = decl.at.location;
    if (location.kind !== "individual") {
      fail(
        `cannot import at '${location.kind}': an import declaration names one endpoint, with an individual location`,
        decl.at.span,
        ["import-declarations", "invalid-import-location"],
      );
    }
    if (!this.endpoints.includes(location.name)) {
      fail(`unknown endpoint '${location.name}'`, decl.at.span, ["import-declarations", "unknown-endpoint"]);
    }
    return location;
  }

  /** The source file an import names, as a key of {@link SourceFiles} (spec §import-declarations). */
  private importedFile(decl: ImportDeclaration, endpoint: string): string {
    const written = decl.module.value;
    const span = decl.module.span;
    const pathSpec: SpecRefs = ["import-declarations", "invalid-module-path"];
    if (!written.startsWith("./")) {
      fail(`the file to import from is written from 'src/index.cbs', beginning with './': write "./${written}"`, span, pathSpec);
    }
    const names = written.slice(2).split("/");
    if (names.some((name) => name === "" || name === "." || name === "..")) {
      fail(`'${written}' has an empty, '.' or '..' name; a module path names the directories and the file below 'src/'`, span, pathSpec);
    }
    if (written.endsWith(SOURCE_FILE_EXTENSION)) {
      fail(
        `write the module path without '${SOURCE_FILE_EXTENSION}': BlueScript adds it itself, so "${written}" would name '${written.slice(2)}${SOURCE_FILE_EXTENSION}'`,
        span,
        pathSpec,
      );
    }
    const file = names.join("/") + SOURCE_FILE_EXTENSION;
    if (!this.files.has(file)) {
      const folded = file.toLowerCase();
      const near = [...this.files.keys()].find((path) => path.toLowerCase() === folded);
      fail(
        near === undefined
          ? `there is no source file '${shownSourcePath(file)}'`
          : `there is no source file '${shownSourcePath(file)}' (did you mean "./${near.slice(0, -SOURCE_FILE_EXTENSION.length)}"? the case must match)`,
        span,
        ["import-declarations", "imported-file-not-found"],
      );
    }
    const owner = sourceFileOwner(file);
    if (owner.kind === "endpoint" && owner.endpoint !== endpoint) {
      fail(
        `'${shownSourcePath(file)}' goes to ${owner.endpoint} alone, so only an import at ${owner.endpoint} may import from it, not one at ${endpoint}`,
        span,
        ["import-declarations", "importing-another-endpoints-file"],
      );
    }
    return file;
  }

  private module(decl: ImportDeclaration, file: string): BsModule {
    let result = this.modules.get(file);
    if (result === undefined) {
      result = readBsModule(this.files.get(file)!);
      this.modules.set(file, result);
    }
    if (!result.ok) {
      fail(
        `${at(file, result.error.at)}: ${shownSourcePath(file)} cannot be imported from: ${result.error.message}`,
        decl.module.span,
        ["imported-signatures", "unsupported-imported-file"],
      );
    }
    return result.module;
  }
}

function at(file: string, position: FilePosition): string {
  return `${shownSourcePath(file)}:${position.line}:${position.column}`;
}

function fail(message: string, span: Span, spec: SpecRefs): never {
  throw new ImportFailure({ message, span, spec });
}

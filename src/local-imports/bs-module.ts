import { parse, type ParserOptions } from "@babel/parser";
import type * as B from "@babel/types";
import { COMM_API_NAMES } from "../runtime/names.js";

/**
 * Reads what a BlueScript source file exports, as far as an import needs it
 * (spec §imported-signatures). The file is parsed as BlueScript parses it — a
 * TypeScript module, with the same parser and options — but only its
 * top-level declarations are looked at, and only the signatures of exported
 * functions and constants are read. Function bodies are BlueScript's business.
 */

/** A value type an imported signature may have (spec §imported-types). */
export type BsValueType = "integer" | "float" | "boolean" | "string" | "null";

/** A place in a source file: 1-based line and column, as messages show them. */
export interface FilePosition {
  readonly line: number;
  readonly column: number;
}

/**
 * One exported name (spec §imported-exports). A declaration that cannot be
 * imported is kept with the reason, which is reported only if an import
 * names it.
 */
export type BsExport =
  | {
      readonly kind: "function";
      readonly params: readonly BsValueType[];
      readonly returnType: BsValueType | "void";
    }
  | { readonly kind: "constant"; readonly type: BsValueType }
  | { readonly kind: "unsupported"; readonly reason: string; readonly at: FilePosition };

export interface BsModule {
  /** Every name exported on its declaration. */
  readonly exports: ReadonlyMap<string, BsExport>;
  /** Names the file declares at top level but does not export, each with why. */
  readonly unexported: ReadonlyMap<string, string>;
}

/** A whole file that may not be imported from (spec §imported-file-restrictions). */
export interface BsModuleError {
  readonly message: string;
  readonly at: FilePosition;
}

export type BsModuleResult =
  | { readonly ok: true; readonly module: BsModule }
  | { readonly ok: false; readonly error: BsModuleError };

/** The options BlueScript parses a source file with (`runBabelParser` in its transpiler). */
const PARSER_OPTIONS: ParserOptions = { sourceType: "module", plugins: ["typescript"] };

export function readBsModule(text: string): BsModuleResult {
  let file: B.File;
  try {
    file = parse(text, PARSER_OPTIONS);
  } catch (e) {
    const error = e as Error & { loc?: { line: number; column: number } };
    if (error.name !== "SyntaxError" || error.loc === undefined) {
      throw e;
    }
    // Babel ends its message with the position, which ours already shows.
    const message = error.message.replace(/ \(\d+:\d+\)$/, "");
    return failure(`syntax error: ${message}`, { line: error.loc.line, column: error.loc.column + 1 });
  }
  const problem = fileProblem(file.program);
  if (problem !== undefined) {
    return { ok: false, error: problem };
  }
  return { ok: true, module: readExports(file.program, text) };
}

function failure(message: string, at: FilePosition): BsModuleResult {
  return { ok: false, error: { message, at } };
}

function positionOf(node: B.Node): FilePosition {
  const start = node.loc?.start;
  return start === undefined ? { line: 1, column: 1 } : { line: start.line, column: start.column + 1 };
}

// ---------------------------------------------------------------------------
// What the file may not do (spec §imported-file-restrictions)
// ---------------------------------------------------------------------------

function fileProblem(program: B.Program): BsModuleError | undefined {
  for (const stmt of program.body) {
    switch (stmt.type) {
      case "ImportDeclaration":
        // BlueScript ignores `import type`, and imports anything else.
        if (stmt.importKind !== "type") {
          return {
            message: `it imports from '${stmt.source.value}'; an imported file may import types only`,
            at: positionOf(stmt),
          };
        }
        break;
      case "TSImportEqualsDeclaration":
        return { message: "it imports with 'import ... ='; an imported file may import types only", at: positionOf(stmt) };
      case "ExportAllDeclaration":
        return { message: `it re-exports from '${stmt.source.value}'; an imported file may import types only`, at: positionOf(stmt) };
      case "ExportNamedDeclaration":
        if (stmt.source !== null && stmt.source !== undefined) {
          return { message: `it re-exports from '${stmt.source.value}'; an imported file may import types only`, at: positionOf(stmt) };
        }
        break;
      default:
        break;
    }
  }
  const comm = communicationIn(program);
  if (comm !== undefined) {
    return {
      message: `it names the communication function '${comm.name}'; an imported file may not communicate, since only the choreography's transfers have a partner at another endpoint`,
      at: positionOf(comm),
    };
  }
  return undefined;
}

/** Keys of a Babel node that hold no child node. */
const NOT_CHILDREN = new Set([
  "type", "start", "end", "loc", "range", "extra",
  "leadingComments", "trailingComments", "innerComments",
]);

/**
 * The first identifier that names a communication API function, in source
 * order. A property name after `.` and a non-computed key name nothing.
 */
function communicationIn(root: B.Node): B.Identifier | undefined {
  let found: B.Identifier | undefined;
  const visit = (node: B.Node, parent: B.Node | undefined, key: string | undefined): void => {
    if (found !== undefined) {
      return;
    }
    if (node.type === "Identifier" && COMM_API_NAMES.has(node.name) && !isPropertyName(parent, key)) {
      found = node;
      return;
    }
    const fields = node as unknown as Record<string, unknown>;
    for (const field of Object.keys(fields)) {
      if (NOT_CHILDREN.has(field)) {
        continue;
      }
      const value = fields[field];
      const children = Array.isArray(value) ? value : [value];
      for (const child of children) {
        if (isNode(child)) {
          visit(child, node, field);
        }
      }
    }
  };
  visit(root, undefined, undefined);
  return found;
}

function isNode(value: unknown): value is B.Node {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function isPropertyName(parent: B.Node | undefined, key: string | undefined): boolean {
  if (parent === undefined) {
    return false;
  }
  const computed = (parent as { computed?: boolean }).computed === true;
  if ((parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") && key === "property") {
    return !computed;
  }
  return key === "key" && !computed;
}

// ---------------------------------------------------------------------------
// Exports (spec §imported-exports)
// ---------------------------------------------------------------------------

function readExports(program: B.Program, text: string): BsModule {
  const exports = new Map<string, BsExport>();
  const unexported = new Map<string, string>();
  const declared = (name: string, why: string): void => {
    if (!unexported.has(name)) {
      unexported.set(name, why);
    }
  };
  const NOT_EXPORTED = "is declared but not exported";
  for (const stmt of program.body) {
    if (stmt.type === "ExportNamedDeclaration") {
      if (stmt.declaration !== null && stmt.declaration !== undefined) {
        for (const [name, entry] of declarationExports(stmt.declaration, text)) {
          exports.set(name, entry);
        }
      }
      for (const spec of stmt.specifiers) {
        if (spec.type === "ExportSpecifier") {
          const name = spec.exported.type === "Identifier" ? spec.exported.name : spec.exported.value;
          // Says more than "declared but not exported", whichever came first.
          unexported.set(name, "is only listed in 'export { ... }', which BlueScript ignores: write 'export' on its declaration");
        }
      }
      continue;
    }
    for (const name of declaredNames(stmt)) {
      declared(name, NOT_EXPORTED);
    }
  }
  for (const name of exports.keys()) {
    unexported.delete(name);
  }
  return { exports, unexported };
}

/** The names a top-level statement declares without `export`. */
function declaredNames(stmt: B.Statement): string[] {
  switch (stmt.type) {
    case "FunctionDeclaration":
    case "ClassDeclaration":
      return stmt.id === null || stmt.id === undefined ? [] : [stmt.id.name];
    case "VariableDeclaration":
      return stmt.declarations.flatMap((d) => (d.id.type === "Identifier" ? [d.id.name] : []));
    default:
      return [];
  }
}

function declarationExports(decl: B.Declaration, text: string): [string, BsExport][] {
  const unsupported = (reason: string, node: B.Node = decl): BsExport => ({
    kind: "unsupported",
    reason,
    at: positionOf(node),
  });
  switch (decl.type) {
    case "FunctionDeclaration":
      return decl.id === null || decl.id === undefined ? [] : [[decl.id.name, functionExport(decl, text)]];
    case "TSDeclareFunction":
      return decl.id === null || decl.id === undefined
        ? []
        : [[decl.id.name, unsupported("it is a function declared without a body")]];
    case "VariableDeclaration":
      return decl.declarations.flatMap((d): [string, BsExport][] => {
        if (d.id.type !== "Identifier") {
          return [];
        }
        if (decl.kind !== "const") {
          return [[d.id.name, unsupported(`it is declared with '${decl.kind}', and only a 'const' is a constant`, d)]];
        }
        return [[d.id.name, constantExport(d, d.id, text)]];
      });
    case "ClassDeclaration":
      return decl.id === null || decl.id === undefined ? [] : [[decl.id.name, unsupported("it is a class")]];
    case "TSEnumDeclaration":
      return [[decl.id.name, unsupported("it is an enum")]];
    case "TSTypeAliasDeclaration":
    case "TSInterfaceDeclaration":
      return [[decl.id.name, unsupported("it is a type")]];
    default:
      return [];
  }
}

function functionExport(decl: B.FunctionDeclaration, text: string): BsExport {
  const unsupported = (reason: string, node: B.Node = decl): BsExport => ({
    kind: "unsupported",
    reason,
    at: positionOf(node),
  });
  if (decl.async) {
    return unsupported("it is an async function");
  }
  if (decl.generator) {
    return unsupported("it is a generator");
  }
  if (decl.typeParameters !== null && decl.typeParameters !== undefined) {
    return unsupported("it takes type parameters");
  }
  const params: BsValueType[] = [];
  for (const param of decl.params) {
    switch (param.type) {
      case "Identifier": {
        if (param.optional === true) {
          return unsupported(`its parameter '${param.name}' is optional`, param);
        }
        const annotation = param.typeAnnotation;
        if (annotation === null || annotation === undefined || annotation.type !== "TSTypeAnnotation") {
          return unsupported(`its parameter '${param.name}' has no type`, param);
        }
        const type = valueType(annotation.typeAnnotation, text);
        if (typeof type !== "string") {
          return unsupported(`its parameter '${param.name}' has ${type.problem}`, param);
        }
        params.push(type);
        break;
      }
      case "AssignmentPattern":
        return unsupported("a parameter has a default value", param);
      case "RestElement":
        return unsupported("it has a rest parameter", param);
      default:
        return unsupported("a parameter is not a plain name", param);
    }
  }
  const annotation = decl.returnType;
  if (annotation === null || annotation === undefined || annotation.type !== "TSTypeAnnotation") {
    return unsupported("it has no return type");
  }
  if (annotation.typeAnnotation.type === "TSVoidKeyword") {
    return { kind: "function", params, returnType: "void" };
  }
  const returnType = valueType(annotation.typeAnnotation, text);
  if (typeof returnType !== "string") {
    return unsupported(`its return type is ${returnType.problem}`, annotation);
  }
  return { kind: "function", params, returnType };
}

function constantExport(decl: B.VariableDeclarator, id: B.Identifier, text: string): BsExport {
  const unsupported = (reason: string, node: B.Node = decl): BsExport => ({
    kind: "unsupported",
    reason,
    at: positionOf(node),
  });
  const annotation = id.typeAnnotation;
  if (annotation !== null && annotation !== undefined && annotation.type === "TSTypeAnnotation") {
    const type = valueType(annotation.typeAnnotation, text);
    if (typeof type !== "string") {
      return unsupported(`its type is ${type.problem}`, annotation);
    }
    return { kind: "constant", type };
  }
  const init = decl.init;
  if (init === null || init === undefined) {
    return unsupported("it has neither a type nor an initializer");
  }
  if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression") {
    return unsupported("it holds a function; declare it with 'export function'", init);
  }
  const type = literalType(init);
  if (typeof type !== "string") {
    return unsupported(type.problem, init);
  }
  return { kind: "constant", type };
}

/**
 * The type of a literal initializer, as BlueScript gives it (spec §imported-types):
 * BlueScript's `numericLiteral` reads the raw text of a number.
 */
function literalType(init: B.Expression): BsValueType | { readonly problem: string } {
  const NEEDS_TYPE = "it has no type, and its initializer is not a literal: write its type";
  switch (init.type) {
    case "NumericLiteral": {
      const raw = String((init.extra as { raw?: unknown } | undefined)?.raw ?? init.value);
      if (/^[0-9A-Fa-fXx]+$/.test(raw)) {
        return "integer";
      }
      if (/^[0-9.e+\-]+$/.test(raw)) {
        return "float";
      }
      return { problem: `BlueScript does not read the number '${raw}'` };
    }
    case "UnaryExpression":
      return init.operator === "-" && init.argument.type === "NumericLiteral"
        ? literalType(init.argument)
        : { problem: NEEDS_TYPE };
    case "StringLiteral":
      return "string";
    case "BooleanLiteral":
      return "boolean";
    case "NullLiteral":
      return "null";
    default:
      return { problem: NEEDS_TYPE };
  }
}

/** A written type, as BlueScript reads it, if ChoreoBS has it (spec §imported-types). */
function valueType(type: B.TSType, text: string): BsValueType | { readonly problem: string } {
  const written = `'${text.slice(type.start ?? 0, type.end ?? 0)}'`;
  switch (type.type) {
    case "TSNumberKeyword":
      return "integer";
    case "TSBooleanKeyword":
      return "boolean";
    case "TSStringKeyword":
      return "string";
    case "TSNullKeyword":
    case "TSUndefinedKeyword":
      return "null";
    case "TSTypeReference":
      if (type.typeName.type === "Identifier" && (type.typeParameters === null || type.typeParameters === undefined)) {
        if (type.typeName.name === "integer") {
          return "integer";
        }
        if (type.typeName.name === "float") {
          return "float";
        }
      }
      if (type.typeName.type === "Identifier" && type.typeName.name === "Array") {
        return { problem: `the array type ${written}, and arrays cannot be imported` };
      }
      return { problem: `the type ${written}, which ChoreoBS does not have` };
    case "TSArrayType":
      return { problem: `the array type ${written}, and arrays cannot be imported` };
    case "TSVoidKeyword":
      return { problem: "'void', which only a return type may be" };
    default:
      return { problem: `the type ${written}, which ChoreoBS does not have` };
  }
}

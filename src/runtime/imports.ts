import type {
  ProjectedExpression,
  ProjectedProgram,
  ProjectedStatement,
  ProjectedType,
} from "../ir/projected.js";
import { childExpressions, mapStatementParts } from "../ir/traverse.js";
import {
  DYN_RUNTIME_EXPORTS,
  DYN_VALUE_TYPE,
  isDynRuntimeFunction,
  isRuntimeConstant,
} from "./dyn.js";
import {
  COPY_ARRAY_HELPER,
  CORE_RUNTIME_EXPORTS,
  LOGICAL_HELPERS,
  nestNothing,
} from "./core.js";

/**
 * Everything a generated file may import from the runtime file, in import
 * order, apart from the location and kind constants, which depend on the
 * endpoints and come last (spec §runtime-import).
 */
const RUNTIME_EXPORTS: readonly string[] = [...CORE_RUNTIME_EXPORTS, ...DYN_RUNTIME_EXPORTS];

const DYN_EXPORTS: ReadonlySet<string> = new Set(DYN_RUNTIME_EXPORTS);

/**
 * The runtime names one endpoint's program uses, in import order
 * (spec §runtime-import): each core helper it calls — the `nothing` helpers
 * its `nothing(...)` artifacts are emitted as, `__and`, `__or` and
 * `__copyArray` — then the `__DynVal` type if anything is declared with it,
 * each dynamic-location runtime function it calls, and last each location or
 * kind constant those calls name, in name order (spec §location-and-kind-codes).
 * Which constants exist depends on the endpoints, but their order here must
 * not: an endpoint's program does not depend on the order the endpoints are
 * declared in.
 *
 * Empty exactly when the program uses none of them, and then nothing is
 * imported, though the runtime file is written all the same
 * (spec §runtime-files).
 */
export function runtimeImports(program: ProjectedProgram): readonly string[] {
  const used = new Set<string>();

  const type = (t: ProjectedType): void => {
    if (t.kind === "PresentType" && t.base === DYN_VALUE_TYPE) {
      used.add(DYN_VALUE_TYPE);
    }
  };
  const expression = (expr: ProjectedExpression): ProjectedExpression => {
    if (
      expr.kind === "CallExpression" &&
      (isDynRuntimeFunction(expr.callee) || expr.callee === COPY_ARRAY_HELPER)
    ) {
      used.add(expr.callee);
    }
    if (expr.kind === "BinaryExpression" && (expr.operator === "&&" || expr.operator === "||")) {
      used.add(LOGICAL_HELPERS[expr.operator]);
    }
    if (expr.kind === "IdentifierExpression" && isRuntimeConstant(expr.name)) {
      used.add(expr.name);
    }
    if (expr.kind === "NothingExpression") {
      // The helpers the emitter will spell it as (spec §nothing-code-generation).
      nestNothing<unknown>(expr.parts, (helper) => used.add(helper));
    }
    for (const child of childExpressions(expr)) {
      expression(child);
    }
    return expr;
  };
  const statement = (stmt: ProjectedStatement): void => {
    if (stmt.kind === "LetStatement") {
      type(stmt.type);
    }
    if (stmt.kind === "ForStatement" && stmt.init?.kind === "ForLetInit") {
      type(stmt.init.type);
    }
    mapStatementParts(stmt, {
      expression,
      block: (block) => {
        block.statements.forEach(statement);
        return block;
      },
    });
  };

  for (const fn of program.functions) {
    fn.params.forEach((param) => type(param.type));
    type(fn.returnType);
    fn.body.statements.forEach(statement);
  }
  program.body.forEach(statement);

  const constants = [...used].filter(isRuntimeConstant).sort();
  return [...RUNTIME_EXPORTS.filter((name) => used.has(name)), ...constants];
}

/**
 * Whether `imports` takes anything from the dynamic-location runtime, which the
 * runtime file then has to hold after the core helpers (spec §runtime-files).
 */
export function importsDynRuntime(imports: readonly string[]): boolean {
  return imports.some((name) => DYN_EXPORTS.has(name) || isRuntimeConstant(name));
}

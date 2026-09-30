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
} from "./dyn.js";
import { CORE_RUNTIME_EXPORTS, LOGICAL_HELPERS, nestNothing } from "./core.js";

/** Everything a generated file may import from the runtime file, in import order (spec §runtime-import). */
const RUNTIME_EXPORTS: readonly string[] = [...CORE_RUNTIME_EXPORTS, ...DYN_RUNTIME_EXPORTS];

const DYN_EXPORTS: ReadonlySet<string> = new Set(DYN_RUNTIME_EXPORTS);

/**
 * The runtime names one endpoint's program uses, in import order
 * (spec §runtime-import): each core helper it calls — the `nothing` helpers
 * its `nothing(...)` artifacts are emitted as, `__and` and `__or` — then the
 * `__DynVal` type if anything is declared with it, and each dynamic-location
 * runtime function it calls.
 *
 * Empty exactly when the program calls none of them, and then nothing is
 * imported (spec §runtime-files).
 */
export function runtimeImports(program: ProjectedProgram): readonly string[] {
  const used = new Set<string>();

  const type = (t: ProjectedType): void => {
    if (t.kind === "PresentType" && t.base === DYN_VALUE_TYPE) {
      used.add(DYN_VALUE_TYPE);
    }
  };
  const expression = (expr: ProjectedExpression): ProjectedExpression => {
    if (expr.kind === "CallExpression" && isDynRuntimeFunction(expr.callee)) {
      used.add(expr.callee);
    }
    if (expr.kind === "BinaryExpression" && (expr.operator === "&&" || expr.operator === "||")) {
      used.add(LOGICAL_HELPERS[expr.operator]);
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

  return RUNTIME_EXPORTS.filter((name) => used.has(name));
}

/**
 * Whether `imports` takes anything from the dynamic-location runtime, which the
 * runtime file then has to hold after the core helpers (spec §runtime-files).
 */
export function importsDynRuntime(imports: readonly string[]): boolean {
  return imports.some((name) => DYN_EXPORTS.has(name));
}

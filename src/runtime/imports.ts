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

/**
 * The runtime names one endpoint's program uses, in import order
 * (spec §runtime-import): the `__DynVal` type if anything is declared with
 * it, and each runtime function it calls.
 *
 * Empty exactly when the program has no `dyn` in it, and then nothing is
 * imported and no runtime file is written (spec §runtime-files).
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

  return DYN_RUNTIME_EXPORTS.filter((name) => used.has(name));
}

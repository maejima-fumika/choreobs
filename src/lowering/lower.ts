import type {
  TypedProgram,
  TypedTopLevelItem,
  TypedStatement,
  TypedBlock,
  TypedExpression,
  TypedForInit,
  LocatedType,
} from "../ast/typed.js";
import { isDynamic } from "../types/located.js";
import type { LoweredProgram } from "./ir.js";

/**
 * Lowering pass entry point (spec §18.8–§18.14). Computes whether the program
 * uses any gradual feature and carries the typed AST through to EPP.
 */
export function lowerProgram(typed: TypedProgram): LoweredProgram {
  return {
    kind: "LoweredProgram",
    typed,
    usesGradual: programUsesGradual(typed),
  };
}

export function programUsesGradual(typed: TypedProgram): boolean {
  return typed.items.some(itemUsesGradual);
}

function itemUsesGradual(item: TypedTopLevelItem): boolean {
  if ("decl" in item) {
    if (typeIsDynamic(item.returnType)) {
      return true;
    }
    if (item.params.some((p) => typeIsDynamic(p.type))) {
      return true;
    }
    return blockUsesGradual(item.body);
  }
  return statementUsesGradual(item.statement);
}

function blockUsesGradual(block: TypedBlock): boolean {
  return block.statements.some(statementUsesGradual);
}

function statementUsesGradual(stmt: TypedStatement): boolean {
  switch (stmt.stmt.kind) {
    case "LetStatement": {
      const s = stmt as Extract<TypedStatement, { stmt: { kind: "LetStatement" } }>;
      return typeIsDynamic(s.choreoType) || exprUsesGradual(s.initializer);
    }
    case "LetReceiveStatement": {
      const s = stmt as Extract<TypedStatement, { stmt: { kind: "LetReceiveStatement" } }>;
      return typeIsDynamic(s.choreoType) || exprUsesGradual(s.source);
    }
    case "AssignmentStatement": {
      const s = stmt as Extract<TypedStatement, { stmt: { kind: "AssignmentStatement" } }>;
      const targetDynamic =
        s.target.target.kind === "IdentifierAssignmentTarget"
          ? typeIsDynamic((s.target as { targetType: LocatedType }).targetType)
          : typeIsDynamic((s.target as { arrayType: LocatedType }).arrayType);
      const indexDynamic =
        s.target.target.kind === "IndexAssignmentTarget"
          ? exprUsesGradual((s.target as { index: TypedExpression }).index)
          : false;
      return targetDynamic || indexDynamic || exprUsesGradual(s.value);
    }
    case "CommStatement": {
      const s = stmt as Extract<TypedStatement, { stmt: { kind: "CommStatement" } }>;
      return typeIsDynamic(s.targetType) || exprUsesGradual(s.source);
    }
    case "IfStatement": {
      const s = stmt as Extract<TypedStatement, { stmt: { kind: "IfStatement" } }>;
      return (
        exprUsesGradual(s.condition) ||
        blockUsesGradual(s.then) ||
        (s.else !== undefined && blockUsesGradual(s.else))
      );
    }
    case "WhileStatement": {
      const s = stmt as Extract<TypedStatement, { stmt: { kind: "WhileStatement" } }>;
      return exprUsesGradual(s.condition) || blockUsesGradual(s.body);
    }
    case "ForStatement": {
      const s = stmt as Extract<TypedStatement, { stmt: { kind: "ForStatement" } }>;
      return (
        (s.init !== undefined && forInitUsesGradual(s.init)) ||
        (s.condition !== undefined && exprUsesGradual(s.condition)) ||
        (s.update !== undefined && exprUsesGradual(s.update.value)) ||
        blockUsesGradual(s.body)
      );
    }
    case "ReturnStatement": {
      const s = stmt as Extract<TypedStatement, { stmt: { kind: "ReturnStatement" } }>;
      return s.value !== undefined && exprUsesGradual(s.value);
    }
    case "ExpressionStatement": {
      const s = stmt as Extract<TypedStatement, { stmt: { kind: "ExpressionStatement" } }>;
      return exprUsesGradual(s.expression);
    }
  }
}

function forInitUsesGradual(init: TypedForInit): boolean {
  if ("initializer" in init) {
    return typeIsDynamic(init.choreoType) || exprUsesGradual(init.initializer);
  }
  if ("source" in init) {
    return typeIsDynamic(init.choreoType) || exprUsesGradual(init.source);
  }
  return typeIsDynamic(init.targetType) || exprUsesGradual(init.value);
}

function exprUsesGradual(expr: TypedExpression): boolean {
  if (expr.gradual !== undefined || typeIsDynamic(expr.choreoType)) {
    return true;
  }
  switch (expr.expr.kind) {
    case "BinaryExpression": {
      const e = expr as Extract<TypedExpression, { expr: { kind: "BinaryExpression" } }>;
      return exprUsesGradual(e.left) || exprUsesGradual(e.right);
    }
    case "UnaryExpression": {
      const e = expr as Extract<TypedExpression, { expr: { kind: "UnaryExpression" } }>;
      return exprUsesGradual(e.operand);
    }
    case "ArrayLiteralExpression": {
      const e = expr as Extract<TypedExpression, { expr: { kind: "ArrayLiteralExpression" } }>;
      return e.elements.some(exprUsesGradual);
    }
    case "CallExpression": {
      const e = expr as Extract<TypedExpression, { expr: { kind: "CallExpression" } }>;
      return e.args.some(exprUsesGradual);
    }
    case "IndexExpression": {
      const e = expr as Extract<TypedExpression, { expr: { kind: "IndexExpression" } }>;
      return exprUsesGradual(e.target) || exprUsesGradual(e.index);
    }
    case "ParenthesizedExpression": {
      const e = expr as Extract<TypedExpression, { expr: { kind: "ParenthesizedExpression" } }>;
      return exprUsesGradual(e.expression);
    }
    default:
      return false;
  }
}

function typeIsDynamic(type: LocatedType): boolean {
  return isDynamic(type);
}

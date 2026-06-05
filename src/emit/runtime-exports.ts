import {
  DYN_VALUE_CLASS,
  EVERY_CONSTANT,
  GRADUAL_RUNTIME_CALLEES,
} from "../lowering/runtime.js";
import type {
  ProjectedBlock,
  ProjectedExpression,
  ProjectedForInit,
  ProjectedProgram,
  ProjectedStatement,
  ProjectedType,
} from "../ir/projected.js";

/** Top-level bindings defined in generated `runtime_<participant>.bs` modules. */
export const RUNTIME_RESERVED_NAMES: ReadonlySet<string> = new Set([
  DYN_VALUE_CLASS,
  EVERY_CONSTANT,
  "HERE",
  "DynamicLocationMismatch",
  "InvalidDynamicCommunication",
  "InvalidDynamicArrayAccess",
  "sendAny",
  "receiveAny",
  "broadcastAny",
  "clonePayload",
  ...GRADUAL_RUNTIME_CALLEES,
]);

export function isRuntimeReservedName(name: string): boolean {
  return RUNTIME_RESERVED_NAMES.has(name);
}

export function runtimeModuleName(participant: string): string {
  return `runtime_${participant}`;
}

/** Collect runtime symbols referenced by a projected endpoint program. */
export function collectRuntimeImports(program: ProjectedProgram): string[] {
  const used = new Set<string>();
  for (const fn of program.functions) {
    collectType(fn.returnType, used);
    for (const p of fn.params) {
      collectType(p.type, used);
    }
    collectBlock(fn.body, used);
  }
  collectStatements(program.body, used);
  return orderImportSymbols([...used]);
}

export function formatRuntimeImport(
  participant: string,
  symbols: readonly string[],
): string {
  if (symbols.length === 0) {
    return "";
  }
  const module = runtimeModuleName(participant);
  return `import { ${symbols.join(", ")} } from "${module}";\n`;
}

function orderImportSymbols(symbols: string[]): string[] {
  const set = new Set(symbols);
  const ordered: string[] = [];
  if (set.has(DYN_VALUE_CLASS)) {
    ordered.push(DYN_VALUE_CLASS);
    set.delete(DYN_VALUE_CLASS);
  }
  if (set.has(EVERY_CONSTANT)) {
    ordered.push(EVERY_CONSTANT);
    set.delete(EVERY_CONSTANT);
  }
  ordered.push(...[...set].sort());
  return ordered;
}

function collectBlock(block: ProjectedBlock, used: Set<string>): void {
  collectStatements(block.statements, used);
}

function collectStatements(
  statements: readonly ProjectedStatement[],
  used: Set<string>,
): void {
  for (const stmt of statements) {
    collectStatement(stmt, used);
  }
}

function collectStatement(stmt: ProjectedStatement, used: Set<string>): void {
  switch (stmt.kind) {
    case "LetStatement":
      collectType(stmt.type, used);
      collectExpression(stmt.initializer, used);
      break;
    case "AssignmentStatement":
      collectExpression(stmt.value, used);
      if (stmt.target.kind === "IndexAssignmentTarget") {
        collectExpression(stmt.target.index, used);
      }
      break;
    case "SendStatement":
    case "BroadcastStatement":
      collectExpression(stmt.value, used);
      break;
    case "IfStatement":
      collectExpression(stmt.condition, used);
      collectBlock(stmt.then, used);
      if (stmt.else !== undefined) {
        collectBlock(stmt.else, used);
      }
      break;
    case "WhileStatement":
      collectExpression(stmt.condition, used);
      collectBlock(stmt.body, used);
      break;
    case "ForStatement":
      if (stmt.init !== undefined) {
        collectForInit(stmt.init, used);
      }
      if (stmt.condition !== undefined) {
        collectExpression(stmt.condition, used);
      }
      if (stmt.update !== undefined) {
        collectExpression(stmt.update.value, used);
      }
      collectBlock(stmt.body, used);
      break;
    case "ReturnStatement":
      if (stmt.value !== undefined) {
        collectExpression(stmt.value, used);
      }
      break;
    case "ExpressionStatement":
      collectExpression(stmt.expression, used);
      break;
    case "AbsentStatement":
      break;
  }
}

function collectForInit(init: ProjectedForInit, used: Set<string>): void {
  if (init.kind === "ForLetInit") {
    collectType(init.type, used);
    collectExpression(init.initializer, used);
  } else {
    collectExpression(init.value, used);
  }
}

function collectType(type: ProjectedType, used: Set<string>): void {
  if (type.kind === "PresentType" && type.base === DYN_VALUE_CLASS) {
    used.add(DYN_VALUE_CLASS);
  }
}

function collectExpression(expr: ProjectedExpression, used: Set<string>): void {
  switch (expr.kind) {
    case "RuntimeCallExpression":
      if (isRuntimeReservedName(expr.callee)) {
        used.add(expr.callee);
      }
      for (const arg of expr.args) {
        collectExpression(arg, used);
      }
      break;
    case "DynValueExpression":
      used.add(DYN_VALUE_CLASS);
      collectExpression(expr.value, used);
      collectExpression(expr.location, used);
      break;
    case "MethodCallExpression":
      if (expr.method === "copyWrapper") {
        used.add(DYN_VALUE_CLASS);
      }
      collectExpression(expr.receiver, used);
      for (const arg of expr.args) {
        collectExpression(arg, used);
      }
      break;
    case "IdentifierExpression":
      if (expr.name === EVERY_CONSTANT) {
        used.add(EVERY_CONSTANT);
      }
      break;
    case "BinaryExpression":
      collectExpression(expr.left, used);
      collectExpression(expr.right, used);
      break;
    case "UnaryExpression":
      collectExpression(expr.operand, used);
      break;
    case "CallExpression":
      for (const arg of expr.args) {
        collectExpression(arg, used);
      }
      break;
    case "IndexExpression":
      collectExpression(expr.target, used);
      collectExpression(expr.index, used);
      break;
    case "PropertyLengthExpression":
      collectExpression(expr.target, used);
      break;
    case "PropertyAccessExpression":
      collectExpression(expr.receiver, used);
      break;
    case "NothingExpression":
      for (const part of expr.parts) {
        collectExpression(part, used);
      }
      break;
    case "ParenthesizedExpression":
      collectExpression(expr.expression, used);
      break;
    case "ReceiveExpression":
      break;
    case "IntegerLiteralExpression":
    case "FloatLiteralExpression":
    case "StringLiteralExpression":
    case "BooleanLiteralExpression":
    case "NullLiteralExpression":
    case "AbsentExpression":
      break;
  }
}

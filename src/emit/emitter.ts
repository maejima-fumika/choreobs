import { specRef } from "../spec/ref.js";
import type {
  ProjectedProgram,
  ProjectedFunction,
  ProjectedStatement,
  ProjectedBlock,
  ProjectedExpression,
  ProjectedForInit,
  ProjectedForUpdate,
} from "../ir/projected.js";
import { emitType } from "./types.js";
import { broadcastFunction, receiveFunction, sendFunction } from "./comm.js";
import {
  ARRAY_SENTINEL,
  LOGICAL_HELPERS,
  NOTHING_HELPER,
  PUSH_SENTINEL,
} from "../runtime/names.js";

export function emit(program: ProjectedProgram): string {
  return new BlueScriptEmitter().emitProgram(program);
}

class BlueScriptEmitter {
  private readonly lines: string[] = [];
  private indent = 0;

  emitProgram(program: ProjectedProgram): string {
    this.lines.length = 0;
    this.indent = 0;
    for (const fn of program.functions) {
      this.emitFunction(fn);
      this.lines.push("");
    }
    while (this.lines.length > 0 && this.lines[this.lines.length - 1] === "") {
      this.lines.pop();
    }
    for (const stmt of program.body) {
      this.emitStatement(stmt);
    }
    return this.lines.join("\n") + (this.lines.length > 0 ? "\n" : "");
  }

  private emitFunction(fn: ProjectedFunction): void {
    const params = fn.params
      .map((p) => `${p.name}: ${emitType(p.type)}`)
      .join(", ");
    this.line(`function ${fn.name}(${params}): ${emitType(fn.returnType)} {`);
    this.indent += 1;
    this.emitBlock(fn.body);
    this.indent -= 1;
    this.line("}");
  }

  private emitBlock(block: ProjectedBlock): void {
    for (const stmt of block.statements) {
      this.emitStatement(stmt);
    }
  }

  private emitStatement(stmt: ProjectedStatement): void {
    switch (stmt.kind) {
      case "LetStatement":
        this.line(
          `let ${stmt.name}: ${emitType(stmt.type)} = ${this.emitExpr(stmt.initializer)};`,
        );
        return;
      case "AssignmentStatement":
        this.line(`${this.emitAssignmentTarget(stmt.target)} = ${this.emitExpr(stmt.value)};`);
        return;
      case "SendStatement":
        this.line(
          `${sendFunction(stmt.comm)}("${stmt.destinationEndpoint}", "${stmt.tag}", ${this.emitExpr(stmt.value)});`,
        );
        return;
      case "BroadcastStatement":
        this.line(
          `${broadcastFunction(stmt.comm)}("${stmt.tag}", ${this.emitExpr(stmt.value)});`,
        );
        return;
      case "IfStatement":
        this.emitIf(stmt);
        return;
      case "WhileStatement":
        this.line(`while (${this.emitExpr(stmt.condition)}) {`);
        this.indent += 1;
        this.emitBlock(stmt.body);
        this.indent -= 1;
        this.line("}");
        return;
      case "ForStatement":
        this.emitFor(stmt);
        return;
      case "ReturnStatement":
        if (stmt.value === undefined) {
          this.line("return;");
        } else {
          this.line(`return ${this.emitExpr(stmt.value)};`);
        }
        return;
      case "ExpressionStatement":
        this.line(`${this.emitExpr(stmt.expression)};`);
        return;
    }
  }

  private emitIf(stmt: import("../ir/projected.js").IfStatement): void {
    this.line(`if (${this.emitExpr(stmt.condition)}) {`);
    this.indent += 1;
    this.emitBlock(stmt.then);
    this.indent -= 1;
    if (stmt.else !== undefined) {
      this.line("} else {");
      this.indent += 1;
      this.emitBlock(stmt.else);
      this.indent -= 1;
    }
    this.line("}");
  }

  private emitFor(stmt: import("../ir/projected.js").ForStatement): void {
    const init = stmt.init !== undefined ? this.emitForInit(stmt.init) : "";
    const cond =
      this.emitExpr(stmt.condition);
    const update =
      stmt.update !== undefined ? this.emitForUpdate(stmt.update) : "";
    this.line(`for (${init}; ${cond}; ${update}) {`);
    this.indent += 1;
    this.emitBlock(stmt.body);
    this.indent -= 1;
    this.line("}");
  }

  private emitForInit(init: ProjectedForInit): string {
    if (init.kind === "ForLetInit") {
      return `let ${init.name}: ${emitType(init.type)} = ${this.emitExpr(init.initializer)}`;
    }
    return this.emitForUpdate(init);
  }

  private emitForUpdate(update: ProjectedForUpdate): string {
    if (update.kind === "ForExpressionInit") {
      return this.emitExpr(update.expression);
    }
    return `${this.emitAssignmentTarget(update.target)} = ${this.emitExpr(update.value)}`;
  }

  private emitExpr(expr: ProjectedExpression): string {
    switch (expr.kind) {
      case "AbsentExpression":
        // Finalized to `null` before cleanup (spec §absent-finalization); reaching the
        // emitter means a projection slot was never traversed.
        throw new Error(
          `internal error: absent reached code generation ${specRef("absent-finalization")}`,
        );
      case "IntegerLiteralExpression":
        return String(expr.value);
      case "FloatLiteralExpression":
        return formatFloat(expr.value);
      case "StringLiteralExpression":
        return JSON.stringify(expr.value);
      case "BooleanLiteralExpression":
        return expr.value ? "true" : "false";
      case "NullLiteralExpression":
        return "null";
      case "IdentifierExpression":
        return expr.name;
      case "BinaryExpression":
        // BlueScript's `&&` and `||` short-circuit; ChoreoBS's do not (spec §logical-operator-code-generation).
        if (expr.operator === "&&" || expr.operator === "||") {
          const helper = LOGICAL_HELPERS[expr.operator];
          return `${helper}(${this.emitExpr(expr.left)}, ${this.emitExpr(expr.right)})`;
        }
        return `${this.emitExpr(expr.left)} ${expr.operator} ${this.emitExpr(expr.right)}`;
      case "UnaryExpression":
        return expr.operator === "!"
          ? `!${this.emitExpr(expr.operand)}`
          : `(-${this.emitExpr(expr.operand)})`;
      // BlueScript's own `as`, parenthesized so that it survives any enclosing
      // operator (spec §numeric-conversion-code-generation).
      case "ConversionExpression":
        return `(${this.emitExpr(expr.operand)} as ${expr.target})`;
      case "CallExpression": {
        if (expr.callee === ARRAY_SENTINEL) {
          return `[${expr.args.map((a) => this.emitExpr(a)).join(", ")}]`;
        }
        if (expr.callee === PUSH_SENTINEL) {
          const xs = expr.args[0] ? this.emitExpr(expr.args[0]) : "null";
          const v = expr.args[1] ? this.emitExpr(expr.args[1]) : "null";
          return `${xs}.push(${v})`;
        }
        const args = expr.args.map((a) => this.emitExpr(a)).join(", ");
        return `${expr.callee}(${args})`;
      }
      case "IndexExpression":
        return `${this.emitExpr(expr.target)}[${this.emitExpr(expr.index)}]`;
      case "PropertyLengthExpression":
        return `${this.emitExpr(expr.target)}.length`;
      case "NothingExpression":
        return `${NOTHING_HELPER}(${expr.parts.map((p) => this.emitExpr(p)).join(", ")})`;
      case "ParenthesizedExpression":
        // A conversion brings its own parentheses; the source's would double them.
        return expr.expression.kind === "ConversionExpression"
          ? this.emitExpr(expr.expression)
          : `(${this.emitExpr(expr.expression)})`;
      case "ReceiveExpression":
        return `${receiveFunction(expr.comm)}("${expr.sourceEndpoint}", "${expr.tag}")`;
    }
  }

  private emitAssignmentTarget(
    target: import("../ir/projected.js").ProjectedAssignmentTarget,
  ): string {
    if (target.kind === "IdentifierAssignmentTarget") {
      return target.name;
    }
    return `${target.name}[${this.emitExpr(target.index)}]`;
  }

  private line(text: string): void {
    this.lines.push("  ".repeat(this.indent) + text);
  }
}

function formatFloat(value: number): string {
  if (Number.isInteger(value)) {
    return `${value}.0`;
  }
  return String(value);
}

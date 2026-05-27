import type { Span } from "../ast/span.js";
import type { Program, TopLevelItem, TopLevelStatement } from "../ast/program.js";
import type { FunctionDeclaration } from "../ast/declarations.js";
import type {
  Statement,
  Block,
  LetStatement,
  LetReceiveStatement,
  AssignmentStatement,
  CommStatement,
  IfStatement,
  WhileStatement,
  ForStatement,
  ReturnStatement,
  ExpressionStatement,
  ForInit,
  ForLetInit,
  ForLetReceiveInit,
  ForAssignmentInit,
} from "../ast/statements.js";
import type {
  Expression,
  BinaryExpression,
  UnaryExpression,
  LiteralExpression,
  IdentifierExpression,
  CallExpression,
  ParenthesizedExpression,
} from "../ast/expressions.js";
import type { ExecutionContext } from "../ast/context.js";
import type { Location } from "../ast/location.js";
import type {
  TypedProgram,
  TypedTopLevelItem,
  TypedTopLevelStatement,
  TypedFunctionDeclaration,
  TypedParameter,
  TypedStatement,
  TypedBlock,
  TypedExpression,
  TypedLetStatement,
  TypedLetReceiveStatement,
  TypedAssignmentStatement,
  TypedCommStatement,
  TypedIfStatement,
  TypedWhileStatement,
  TypedForStatement,
  TypedForInit,
  TypedForLetInit,
  TypedForLetReceiveInit,
  TypedForAssignmentInit,
  TypedReturnStatement,
  TypedExpressionStatement,
  TypedBinaryExpression,
  TypedUnaryExpression,
  TypedLiteralExpression,
  TypedIdentifierExpression,
  TypedCallExpression,
  TypedParenthesizedExpression,
  LocatedType,
  FunctionSymbol,
} from "../ast/typed.js";
import type { ChoreoBSConfig } from "../config/types.js";
import { EVERY_CONTEXT } from "../ast/context.js";
import {
  available,
  contextAsLocation,
  formatLocatedType,
  isSubtype,
  localAvailable,
  locatedType,
  locatedTypesCompatible,
  locationsEqual,
} from "../types/located.js";
import {
  LocationOmitError,
  resolveLiteralType,
  resolveTypeAnnotation,
} from "../elaborate/resolve.js";
import { CommTagGenerator, TOP_SCOPE } from "../comm/tags.js";
import { typeCheckError, type TypeCheckError } from "./errors.js";
import {
  inferReturnTypeFromCandidates,
  inferenceOk,
  type InferErr,
  type ReturnCandidate,
} from "./inference.js";
import {
  isRecursiveComponent,
  stronglyConnectedComponents,
} from "./recursion.js";

export interface TypeCheckResult {
  readonly typed: TypedProgram | null;
  readonly errors: readonly TypeCheckError[];
}

export function typeCheck(
  program: Program,
  config: ChoreoBSConfig,
): TypeCheckResult {
  const checker = new TypeChecker(program, config);
  return checker.check();
}

class TypeChecker {
  private readonly errors: TypeCheckError[] = [];
  private readonly functions = new Map<string, FunctionDeclaration>();
  private readonly resolvedReturnTypes = new Map<string, LocatedType>();
  private readonly participants: Set<string>;
  private readonly commTags = new CommTagGenerator();
  private commScope = TOP_SCOPE;
  private currentFunction: FunctionDeclaration | undefined;
  /** Resolved return type for the function currently being type-checked. */
  private currentFunctionReturnType: LocatedType | undefined;
  private inTopLevel = false;
  private readonly topLevelEnv = new Map<string, LocatedType>();
  private envStack: Map<string, LocatedType>[] = [];

  constructor(
    private readonly program: Program,
    config: ChoreoBSConfig,
  ) {
    this.participants = new Set(config.participants);
    if (this.participants.has("every")) {
      this.error(
        "'every' must not appear in participants (spec §2.2)",
        program.span,
      );
    }
  }

  check(): TypeCheckResult {
    this.collectFunctions();
    this.checkRecursiveOmittedReturnTypes();
    this.resolveExplicitFunctionSignatures();
    this.inferOmittedReturnTypes();
    const items: TypedTopLevelItem[] = [];
    for (const item of this.program.items) {
      items.push(this.checkTopLevelItem(item));
    }
    const typed: TypedProgram = {
      kind: "TypedProgram",
      program: this.program,
      items,
    };
    return {
      typed: this.errors.length === 0 ? typed : null,
      errors: this.errors,
    };
  }

  private collectFunctions(): void {
    for (const item of this.program.items) {
      if (item.kind !== "FunctionDeclaration") {
        continue;
      }
      const existing = this.functions.get(item.name);
      if (existing !== undefined) {
        this.error(
          `duplicate function '${item.name}' (spec §6.2)`,
          item.span,
        );
        continue;
      }
      this.functions.set(item.name, item);
      this.validateLocation(item.at, item.span);
    }
  }

  private checkRecursiveOmittedReturnTypes(): void {
    const names = [...this.functions.keys()];
    const callGraph = new Map<string, readonly string[]>();
    for (const name of names) {
      const decl = this.functions.get(name)!;
      const callees = [...this.collectCalleeNames(decl.body)].filter((callee) =>
        this.functions.has(callee),
      );
      callGraph.set(name, callees);
    }
    const successors = (name: string): readonly string[] =>
      callGraph.get(name) ?? [];
    const components = stronglyConnectedComponents(names, successors);
    for (const component of components) {
      if (!isRecursiveComponent(component, successors)) {
        continue;
      }
      for (const name of component) {
        const decl = this.functions.get(name);
        if (decl === undefined) {
          continue;
        }
        if (decl.at.kind === "every") {
          continue;
        }
        if (decl.returnType !== undefined) {
          continue;
        }
        this.error(
          `function '${name}' with omitted return type cannot be recursive (spec §7.14.8)`,
          decl.span,
        );
      }
    }
  }

  private resolveExplicitFunctionSignatures(): void {
    for (const decl of this.functions.values()) {
      if (decl.returnType === undefined) {
        continue;
      }
      const allowOmit = decl.context.kind === "local";
      const returnType = this.resolveType(decl.returnType, decl.context, allowOmit);
      this.validateLocalFunctionLocatedType(
        decl,
        returnType,
        decl.returnType.span,
        "return type",
      );
      this.resolvedReturnTypes.set(decl.name, returnType);
    }
  }

  private inferOmittedReturnTypes(): void {
    const pending = [...this.functions.values()].filter(
      (decl) => !this.resolvedReturnTypes.has(decl.name),
    );
    let progress = true;
    while (pending.length > 0 && progress) {
      progress = false;
      for (let i = pending.length - 1; i >= 0; i--) {
        const decl = pending[i]!;
        if (!this.calleesReadyForInference(decl)) {
          continue;
        }
        if (this.inferReturnTypeFor(decl)) {
          pending.splice(i, 1);
          progress = true;
        }
      }
    }
    for (const decl of pending) {
      this.error(
        `cannot infer return type for '${decl.name}': depends on other functions with omitted return types that are not yet resolved (spec §7.14.4)`,
        decl.span,
      );
    }
  }

  private calleesReadyForInference(decl: FunctionDeclaration): boolean {
    const callees = this.collectCalleeNames(decl.body);
    for (const name of callees) {
      if (name === decl.name) {
        continue;
      }
      if (this.functions.has(name) && !this.resolvedReturnTypes.has(name)) {
        return false;
      }
    }
    return true;
  }

  private inferReturnTypeFor(decl: FunctionDeclaration): boolean {
    const allowOmit = decl.context.kind === "local";
    const env = new Map<string, LocatedType>();
    for (const param of decl.params) {
      const paramType = this.resolveType(param.type, decl.context, allowOmit);
      this.validateLocalFunctionLocatedType(
        decl,
        paramType,
        param.span,
        "parameter",
      );
      env.set(param.name, paramType);
    }
    this.currentFunction = decl;
    this.pushEnv(env);
    this.pushEnv(new Map());
    const collected = this.collectReturnCandidatesWithEnv(
      decl.body,
      decl.context,
      allowOmit,
    );
    this.popEnv();
    this.popEnv();
    this.currentFunction = undefined;
    this.currentFunctionReturnType = undefined;
    if (!collected.ok) {
      this.error(collected.message, decl.span);
      return false;
    }
    const inferred = inferReturnTypeFromCandidates(
      decl.body,
      decl.at,
      collected.value,
    );
    if (!inferred.ok) {
      this.error(inferred.message, decl.span);
      return false;
    }
    this.validateLocalFunctionLocatedType(
      decl,
      inferred.value,
      decl.span,
      "return type",
    );
    this.resolvedReturnTypes.set(decl.name, inferred.value);
    return true;
  }

  /**
   * Collects return candidates while binding `let` names in execution order,
   * matching function-body scoping during the full type check (spec §7.14.4).
   */
  private collectReturnCandidatesWithEnv(
    block: Block,
    ctx: ExecutionContext,
    allowOmit: boolean,
  ): import("./inference.js").InferResult<readonly ReturnCandidate[]> {
    const candidates: ReturnCandidate[] = [];
    const err = this.walkStatementsForReturnInference(
      block.statements,
      ctx,
      allowOmit,
      candidates,
    );
    if (err !== undefined) {
      return err;
    }
    return inferenceOk(candidates);
  }

  private walkStatementsForReturnInference(
    statements: readonly Statement[],
    ctx: ExecutionContext,
    allowOmit: boolean,
    out: ReturnCandidate[],
  ): InferErr | undefined {
    for (const stmt of statements) {
      const err = this.walkStatementForReturnInference(
        stmt,
        ctx,
        allowOmit,
        out,
      );
      if (err !== undefined) {
        return err;
      }
    }
    return undefined;
  }

  private walkStatementForReturnInference(
    stmt: Statement,
    ctx: ExecutionContext,
    allowOmit: boolean,
    out: ReturnCandidate[],
  ): InferErr | undefined {
    switch (stmt.kind) {
      case "LetStatement": {
        const initializer = this.typeReturnValueExpression(
          stmt.initializer,
          ctx,
          allowOmit,
        );
        const choreoType =
          stmt.type !== undefined
            ? this.resolveLetType(
                stmt.type,
                initializer,
                ctx,
                allowOmit,
                stmt.span,
              )
            : initializer.choreoType;
        this.defineLocal(stmt.name, choreoType, stmt.span);
        return undefined;
      }
      case "ReturnStatement":
        if (stmt.value === undefined) {
          out.push({ kind: "unit", span: stmt.span });
          return undefined;
        }
        {
          const value = this.typeReturnValueExpression(
            stmt.value,
            ctx,
            allowOmit,
          );
          out.push({
            kind: "value",
            type: value.choreoType,
            span: stmt.span,
          });
          return undefined;
        }
      case "IfStatement": {
        this.pushEnv(new Map());
        let err = this.walkStatementsForReturnInference(
          stmt.then.statements,
          ctx,
          allowOmit,
          out,
        );
        this.popEnv();
        if (err !== undefined) {
          return err;
        }
        if (stmt.else !== undefined) {
          this.pushEnv(new Map());
          err = this.walkStatementsForReturnInference(
            stmt.else.statements,
            ctx,
            allowOmit,
            out,
          );
          this.popEnv();
        }
        return err;
      }
      case "WhileStatement":
        this.pushEnv(new Map());
        {
          const err = this.walkStatementsForReturnInference(
            stmt.body.statements,
            ctx,
            allowOmit,
            out,
          );
          this.popEnv();
          return err;
        }
      case "ForStatement": {
        this.pushEnv(new Map());
        if (stmt.init !== undefined) {
          const initErr = this.walkForInitForReturnInference(
            stmt.init,
            ctx,
            allowOmit,
          );
          if (initErr !== undefined) {
            this.popEnv();
            return initErr;
          }
        }
        this.pushEnv(new Map());
        const err = this.walkStatementsForReturnInference(
          stmt.body.statements,
          ctx,
          allowOmit,
          out,
        );
        this.popEnv();
        this.popEnv();
        return err;
      }
      default:
        return undefined;
    }
  }

  private walkForInitForReturnInference(
    init: ForInit,
    ctx: ExecutionContext,
    allowOmit: boolean,
  ): InferErr | undefined {
    if (init.kind !== "ForLetInit") {
      return undefined;
    }
    const initializer = this.typeReturnValueExpression(
      init.initializer,
      ctx,
      allowOmit,
    );
    const choreoType =
      init.type !== undefined
        ? this.resolveLetType(
            init.type,
            initializer,
            ctx,
            allowOmit,
            init.span,
          )
        : initializer.choreoType;
    this.defineLocal(init.name, choreoType, init.span);
    return undefined;
  }

  /** Return type after elaboration or inference; does not read raw AST annotations. */
  private getResolvedReturnType(decl: FunctionDeclaration): LocatedType {
    const resolved = this.resolvedReturnTypes.get(decl.name);
    if (resolved !== undefined) {
      return resolved;
    }
    if (decl.returnType !== undefined) {
      const allowOmit = decl.context.kind === "local";
      const returnType = this.resolveType(
        decl.returnType,
        decl.context,
        allowOmit,
      );
      this.resolvedReturnTypes.set(decl.name, returnType);
      return returnType;
    }
    this.error(
      `function '${decl.name}' has no resolved return type`,
      decl.span,
    );
    return locatedType("unit", decl.at);
  }

  private collectCalleeNames(block: Block): Set<string> {
    const names = new Set<string>();
    const visitExpr = (expr: Expression): void => {
      switch (expr.kind) {
        case "CallExpression":
          names.add(expr.callee);
          for (const arg of expr.args) {
            visitExpr(arg);
          }
          break;
        case "BinaryExpression":
          visitExpr(expr.left);
          visitExpr(expr.right);
          break;
        case "UnaryExpression":
          visitExpr(expr.operand);
          break;
        case "ParenthesizedExpression":
          visitExpr(expr.expression);
          break;
        case "LiteralExpression":
        case "IdentifierExpression":
          break;
      }
    };
    const visitStmt = (stmt: Statement): void => {
      switch (stmt.kind) {
        case "ReturnStatement":
          if (stmt.value !== undefined) {
            visitExpr(stmt.value);
          }
          break;
        case "LetStatement":
          visitExpr(stmt.initializer);
          break;
        case "LetReceiveStatement":
          visitExpr(stmt.source);
          break;
        case "AssignmentStatement":
          visitExpr(stmt.value);
          break;
        case "CommStatement":
          visitExpr(stmt.source);
          break;
        case "IfStatement":
          for (const s of stmt.then.statements) {
            visitStmt(s);
          }
          if (stmt.else !== undefined) {
            for (const s of stmt.else.statements) {
              visitStmt(s);
            }
          }
          break;
        case "WhileStatement":
          visitExpr(stmt.condition);
          for (const s of stmt.body.statements) {
            visitStmt(s);
          }
          break;
        case "ForStatement":
          if (stmt.init?.kind === "ForLetInit") {
            visitExpr(stmt.init.initializer);
          } else if (stmt.init?.kind === "ForLetReceiveInit") {
            visitExpr(stmt.init.source);
          } else if (stmt.init?.kind === "ForAssignmentInit") {
            visitExpr(stmt.init.value);
          }
          if (stmt.condition !== undefined) {
            visitExpr(stmt.condition);
          }
          if (stmt.update !== undefined) {
            visitExpr(stmt.update.value);
          }
          for (const s of stmt.body.statements) {
            visitStmt(s);
          }
          break;
        case "ExpressionStatement":
          visitExpr(stmt.expression);
          break;
      }
    };
    for (const stmt of block.statements) {
      visitStmt(stmt);
    }
    return names;
  }

  private checkTopLevelItem(item: TopLevelItem): TypedTopLevelItem {
    if (item.kind === "FunctionDeclaration") {
      return this.checkFunction(item, false);
    }
    return this.checkTopLevelStatement(item);
  }

  private checkTopLevelStatement(item: TopLevelStatement): TypedTopLevelStatement {
    this.commScope = TOP_SCOPE;
    this.currentFunction = undefined;
    this.currentFunctionReturnType = undefined;
    this.inTopLevel = true;
    const statement = this.checkStatement(item.statement, EVERY_CONTEXT, false, false);
    this.inTopLevel = false;
    return {
      item,
      context: EVERY_CONTEXT,
      statement,
    };
  }

  private checkFunction(
    decl: FunctionDeclaration,
    nested: boolean,
  ): TypedFunctionDeclaration {
    if (!nested) {
      this.commScope = decl.name;
    }
    this.currentFunction = decl;
    const allowOmit = decl.context.kind === "local";
    const returnType = this.getResolvedReturnType(decl);
    this.currentFunctionReturnType = returnType;
    const params: TypedParameter[] = [];
    const env = new Map<string, LocatedType>();
    for (const param of decl.params) {
      const type = this.resolveType(param.type, decl.context, allowOmit);
      this.validateLocalFunctionLocatedType(
        decl,
        type,
        param.span,
        "parameter",
      );
      if (env.has(param.name)) {
        this.error(
          `duplicate parameter '${param.name}' in the same scope`,
          param.span,
        );
      } else {
        env.set(param.name, type);
      }
      params.push({ param, type });
    }
    this.pushEnv(env);
    const body = this.checkBlock(decl.body, decl.context, allowOmit, true);
    this.popEnv();
    this.currentFunction = undefined;
    this.currentFunctionReturnType = undefined;
    return {
      decl,
      context: decl.context,
      returnType,
      params,
      body,
    };
  }

  private checkBlock(
    block: Block,
    ctx: ExecutionContext,
    allowOmit: boolean,
    inFunction: boolean,
  ): TypedBlock {
    this.pushEnv(new Map());
    const statements: TypedStatement[] = [];
    for (const stmt of block.statements) {
      statements.push(this.checkStatement(stmt, ctx, allowOmit, inFunction));
    }
    this.popEnv();
    return { context: ctx, block, statements };
  }

  private checkStatement(
    stmt: Statement,
    ctx: ExecutionContext,
    allowOmit: boolean,
    inFunction: boolean,
  ): TypedStatement {
    switch (stmt.kind) {
      case "LetStatement":
        return this.checkLet(stmt, ctx, allowOmit);
      case "LetReceiveStatement":
        this.assertCommAllowed(ctx, stmt.span);
        return this.checkLetReceive(stmt, ctx, allowOmit);
      case "AssignmentStatement":
        return this.checkAssignment(stmt, ctx, allowOmit);
      case "CommStatement":
        this.assertCommAllowed(ctx, stmt.span);
        return this.checkComm(stmt, ctx, allowOmit);
      case "IfStatement":
        return this.checkIf(stmt, ctx, allowOmit, inFunction);
      case "WhileStatement":
        return this.checkWhile(stmt, ctx, allowOmit, inFunction);
      case "ForStatement":
        return this.checkFor(stmt, ctx, allowOmit, inFunction);
      case "ReturnStatement":
        return this.checkReturn(stmt, ctx, allowOmit, inFunction);
      case "ExpressionStatement":
        return this.checkExpressionStatement(stmt, ctx, allowOmit);
    }
  }

  private checkLet(
    stmt: LetStatement,
    ctx: ExecutionContext,
    allowOmit: boolean,
  ): TypedLetStatement {
    const initializer = this.checkExpression(stmt.initializer, ctx, allowOmit);
    const choreoType =
      stmt.type !== undefined
        ? this.resolveLetType(stmt.type, initializer, ctx, allowOmit, stmt.span)
        : initializer.choreoType;
    this.requireExpressionAvailable(choreoType.location, ctx, stmt.span);
    this.defineLocal(stmt.name, choreoType, stmt.span);
    return { stmt, choreoType, initializer };
  }

  private resolveLetType(
    ann: import("../ast/syntax-types.js").TypeAnnotation,
    initializer: TypedExpression,
    ctx: ExecutionContext,
    allowOmit: boolean,
    span: Span,
  ): LocatedType {
    const choreoType = this.resolveType(ann, ctx, allowOmit);
    this.validateLocalFunctionLocatedType(
      this.currentFunction,
      choreoType,
      span,
      "variable type",
    );
    this.validateAssignmentLike(choreoType, initializer.choreoType, span);
    return choreoType;
  }

  private checkLetReceive(
    stmt: LetReceiveStatement,
    ctx: ExecutionContext,
    allowOmit: boolean,
  ): TypedLetReceiveStatement {
    const choreoType = this.resolveType(stmt.type, ctx, allowOmit);
    const source = this.checkExpression(stmt.source, ctx, allowOmit);
    this.validateCommunication(choreoType, source.choreoType, stmt.span);
    const commTag = this.commTags.next(this.commScope);
    this.defineLocal(stmt.name, choreoType, stmt.span);
    return { stmt, choreoType, source, commTag };
  }

  private checkAssignment(
    stmt: AssignmentStatement,
    ctx: ExecutionContext,
    allowOmit: boolean,
  ): TypedAssignmentStatement {
    const targetType = this.lookupVariable(stmt.name, stmt.span);
    const value = this.checkExpression(stmt.value, ctx, allowOmit);
    this.validateAssignmentLike(targetType, value.choreoType, stmt.span);
    return { stmt, targetType, value };
  }

  private checkComm(
    stmt: CommStatement,
    ctx: ExecutionContext,
    allowOmit: boolean,
  ): TypedCommStatement {
    const targetType = this.lookupVariable(stmt.name, stmt.span);
    const source = this.checkExpression(stmt.source, ctx, allowOmit);
    this.validateCommunication(targetType, source.choreoType, stmt.span);
    const commTag = this.commTags.next(this.commScope);
    return { stmt, targetType, source, commTag };
  }

  private checkIf(
    stmt: IfStatement,
    ctx: ExecutionContext,
    allowOmit: boolean,
    inFunction: boolean,
  ): TypedIfStatement {
    const condition = this.checkCondition(stmt.condition, ctx, allowOmit);
    const then = this.checkBlock(stmt.then, ctx, allowOmit, inFunction);
    const elseBlock = stmt.else
      ? this.checkBlock(stmt.else, ctx, allowOmit, inFunction)
      : undefined;
    return { stmt, condition, then, else: elseBlock };
  }

  private checkWhile(
    stmt: WhileStatement,
    ctx: ExecutionContext,
    allowOmit: boolean,
    inFunction: boolean,
  ): TypedWhileStatement {
    const condition = this.checkCondition(stmt.condition, ctx, allowOmit);
    const body = this.checkBlock(stmt.body, ctx, allowOmit, inFunction);
    return { stmt, condition, body };
  }

  private checkFor(
    stmt: ForStatement,
    ctx: ExecutionContext,
    allowOmit: boolean,
    inFunction: boolean,
  ): TypedForStatement {
    this.pushEnv(new Map());
    let init: TypedForInit | undefined;
    if (stmt.init !== undefined) {
      init = this.checkForInit(stmt.init, ctx, allowOmit);
    }
    const condition = stmt.condition
      ? this.checkCondition(stmt.condition, ctx, allowOmit)
      : undefined;
    const update = stmt.update
      ? this.checkForUpdate(stmt.update, ctx, allowOmit)
      : undefined;
    const body = this.checkBlock(stmt.body, ctx, allowOmit, inFunction);
    this.popEnv();
    return { stmt, init, condition, update, body };
  }

  private checkForInit(
    init: ForInit,
    ctx: ExecutionContext,
    allowOmit: boolean,
  ): TypedForInit {
    switch (init.kind) {
      case "ForLetInit":
        return this.checkForLetInit(init, ctx, allowOmit);
      case "ForLetReceiveInit":
        return this.checkForLetReceiveInit(init, ctx, allowOmit);
      case "ForAssignmentInit":
        return this.checkForAssignmentInit(init, ctx, allowOmit);
    }
  }

  private checkForLetInit(
    init: ForLetInit,
    ctx: ExecutionContext,
    allowOmit: boolean,
  ): TypedForLetInit {
    const initializer = this.checkExpression(init.initializer, ctx, allowOmit);
    const choreoType =
      init.type !== undefined
        ? this.resolveLetType(init.type, initializer, ctx, allowOmit, init.span)
        : initializer.choreoType;
    this.requireExpressionAvailable(choreoType.location, ctx, init.span);
    this.defineLocal(init.name, choreoType, init.span);
    return { init, choreoType, initializer };
  }

  private checkForLetReceiveInit(
    init: ForLetReceiveInit,
    ctx: ExecutionContext,
    allowOmit: boolean,
  ): TypedForLetReceiveInit {
    this.assertCommAllowed(ctx, init.span);
    const choreoType = this.resolveType(init.type, ctx, allowOmit);
    const source = this.checkExpression(init.source, ctx, allowOmit);
    this.validateCommunication(choreoType, source.choreoType, init.span);
    const commTag = this.commTags.next(this.commScope);
    this.defineLocal(init.name, choreoType, init.span);
    return { init, choreoType, source, commTag };
  }

  private checkForAssignmentInit(
    init: ForAssignmentInit,
    ctx: ExecutionContext,
    allowOmit: boolean,
  ): TypedForAssignmentInit {
    const targetType = this.lookupVariable(init.name, init.span);
    const value = this.checkExpression(init.value, ctx, allowOmit);
    this.validateAssignmentLike(targetType, value.choreoType, init.span);
    return { init, targetType, value };
  }

  private checkForUpdate(
    init: ForAssignmentInit,
    ctx: ExecutionContext,
    allowOmit: boolean,
  ): TypedForAssignmentInit {
    return this.checkForAssignmentInit(init, ctx, allowOmit);
  }

  private checkReturn(
    stmt: ReturnStatement,
    ctx: ExecutionContext,
    allowOmit: boolean,
    inFunction: boolean,
  ): TypedReturnStatement {
    if (
      !inFunction ||
      this.currentFunction === undefined ||
      this.currentFunctionReturnType === undefined
    ) {
      this.error("'return' outside function", stmt.span);
      return { stmt };
    }
    return this.checkReturnAgainstResolvedType(
      stmt,
      this.currentFunctionReturnType,
      ctx,
      allowOmit,
    );
  }

  private typeReturnValueExpression(
    expr: Expression,
    ctx: ExecutionContext,
    allowOmit: boolean,
  ): TypedExpression {
    return this.checkExpression(expr, ctx, allowOmit);
  }

  private checkReturnAgainstResolvedType(
    stmt: ReturnStatement,
    returnType: LocatedType,
    ctx: ExecutionContext,
    allowOmit: boolean,
  ): TypedReturnStatement {
    if (stmt.value === undefined) {
      if (returnType.base !== "unit") {
        this.error(
          `expected return value of type ${formatLocatedType(returnType)}`,
          stmt.span,
        );
      }
      return { stmt };
    }
    if (returnType.base === "unit") {
      this.error(
        "return with value not allowed for unit return type (spec §7.13)",
        stmt.span,
      );
    }
    const value = this.typeReturnValueExpression(
      stmt.value,
      ctx,
      allowOmit,
    );
    if (!locatedTypesCompatible(value.choreoType, returnType)) {
      this.error(
        `return type ${formatLocatedType(value.choreoType)} is not compatible with ${formatLocatedType(returnType)}`,
        stmt.span,
      );
    }
    return { stmt, value };
  }

  private checkExpressionStatement(
    stmt: ExpressionStatement,
    ctx: ExecutionContext,
    allowOmit: boolean,
  ): TypedExpressionStatement {
    const expression = this.checkExpression(stmt.expression, ctx, allowOmit);
    return { stmt, expression };
  }

  private checkCondition(
    expr: Expression,
    ctx: ExecutionContext,
    allowOmit: boolean,
  ): TypedExpression {
    const typed = this.checkExpression(expr, ctx, allowOmit);
    if (typed.choreoType.base !== "boolean") {
      this.error("condition must have type boolean", expr.span);
      return typed;
    }
    const useLoc = contextAsLocation(ctx);
    if (ctx.kind === "every") {
      if (typed.choreoType.location.kind !== "every") {
        this.error(
          "condition must be boolean@every in @every context (spec §7.9)",
          expr.span,
        );
      }
    } else if (!available(typed.choreoType.location, useLoc)) {
      this.error(
        `condition boolean@${typed.choreoType.location.kind === "every" ? "every" : typed.choreoType.location.name} is not available in this context (spec §7.9)`,
        expr.span,
      );
    }
    return typed;
  }

  private checkExpression(
    expr: Expression,
    ctx: ExecutionContext,
    allowOmit: boolean,
  ): TypedExpression {
    switch (expr.kind) {
      case "BinaryExpression":
        return this.checkBinary(expr, ctx, allowOmit);
      case "UnaryExpression":
        return this.checkUnary(expr, ctx, allowOmit);
      case "LiteralExpression":
        return this.checkLiteral(expr, ctx, allowOmit);
      case "IdentifierExpression":
        return this.checkIdentifier(expr, ctx);
      case "CallExpression":
        return this.checkCall(expr, ctx, allowOmit);
      case "ParenthesizedExpression":
        return this.checkParen(expr, ctx, allowOmit);
    }
  }

  private checkBinary(
    expr: BinaryExpression,
    ctx: ExecutionContext,
    allowOmit: boolean,
  ): TypedBinaryExpression {
    const left = this.checkExpression(expr.left, ctx, allowOmit);
    const right = this.checkExpression(expr.right, ctx, allowOmit);
    const choreoType = this.binaryResultType(
      expr.operator,
      left.choreoType,
      right.choreoType,
      ctx,
      expr.span,
    );
    return { expr, choreoType, left, right };
  }

  private binaryResultType(
    operator: BinaryExpression["operator"],
    left: LocatedType,
    right: LocatedType,
    ctx: ExecutionContext,
    span: Span,
  ): LocatedType {
    const arith = ["+", "-", "*", "/", "%"] as const;
    const rel = ["<", "<=", ">", ">="] as const;
    const eq = ["===", "!=="] as const;
    const log = ["&&", "||"] as const;

    if ((arith as readonly string[]).includes(operator)) {
      if (operator === "+" && left.base === "string" && right.base === "string") {
        return this.locationAwareBinary(left, right, "string", ctx, span);
      }
      if (!this.isNumeric(left) || !this.isNumeric(right)) {
        this.error(
          `operator '${operator}' requires numeric operands`,
          span,
        );
        return left;
      }
      const base: LocatedType["base"] =
        left.base === "float" || right.base === "float" ? "float" : "integer";
      return this.locationAwareBinary(left, right, base, ctx, span);
    }
    if ((rel as readonly string[]).includes(operator)) {
      if (!this.isNumeric(left) || !this.isNumeric(right)) {
        this.error(`operator '${operator}' requires numeric operands`, span);
      }
      return this.locationAwareBinary(left, right, "boolean", ctx, span);
    }
    if ((eq as readonly string[]).includes(operator)) {
      if (left.base !== right.base) {
        this.error(
          `operator '${operator}' requires operands of the same base type`,
          span,
        );
      }
      return this.locationAwareBinary(left, right, "boolean", ctx, span);
    }
    if ((log as readonly string[]).includes(operator)) {
      if (left.base !== "boolean" || right.base !== "boolean") {
        this.error(`operator '${operator}' requires boolean operands`, span);
      }
      return this.locationAwareBinary(left, right, "boolean", ctx, span);
    }
    return left;
  }

  private checkUnary(
    expr: UnaryExpression,
    ctx: ExecutionContext,
    allowOmit: boolean,
  ): TypedUnaryExpression {
    const operand = this.checkExpression(expr.operand, ctx, allowOmit);
    if (expr.operator === "!") {
      if (operand.choreoType.base !== "boolean") {
        this.error("operator '!' requires boolean operand", expr.span);
      }
      this.requireExpressionAvailable(operand.choreoType.location, ctx, expr.span);
      return {
        expr,
        choreoType: locatedType("boolean", operand.choreoType.location),
        operand,
      };
    }
    if (!this.isNumeric(operand.choreoType)) {
      this.error("unary '-' requires numeric operand", expr.span);
    }
    this.requireExpressionAvailable(operand.choreoType.location, ctx, expr.span);
    return { expr, choreoType: operand.choreoType, operand };
  }

  private checkLiteral(
    expr: LiteralExpression,
    ctx: ExecutionContext,
    allowOmit: boolean,
  ): TypedLiteralExpression {
    const choreoType = this.resolveLiteral(expr.literal, ctx, allowOmit);
    this.requireExpressionAvailable(choreoType.location, ctx, expr.span);
    return { expr, choreoType, literal: expr.literal };
  }

  private checkIdentifier(
    expr: IdentifierExpression,
    ctx: ExecutionContext,
  ): TypedIdentifierExpression {
    const choreoType = this.lookupVariable(expr.name, expr.span);
    this.requireExpressionAvailable(choreoType.location, ctx, expr.span);
    return { expr, choreoType };
  }

  private checkCall(
    expr: CallExpression,
    ctx: ExecutionContext,
    allowOmit: boolean,
  ): TypedCallExpression {
    const decl = this.functions.get(expr.callee);
    if (decl === undefined) {
      this.error(`undefined function '${expr.callee}'`, expr.span);
      return {
        expr,
        choreoType: locatedType("integer", contextAsLocation(ctx)),
        callee: this.unknownFunction(expr.callee),
        args: [],
      };
    }
    this.validateCallTarget(decl, expr.span);
    if (
      decl.at.kind === "every" &&
      this.currentFunction?.name === decl.name &&
      this.currentFunction?.at.kind === "every"
    ) {
      this.error(
        `recursive call to @every function '${decl.name}' is not supported (spec §10.4)`,
        expr.span,
      );
    }
    const symbol = this.functionSymbol(decl);
    const calleeAllowOmit = decl.context.kind === "local";
    const params = symbol.params;
    if (expr.args.length !== params.length) {
      this.error(
        `function '${expr.callee}' expects ${params.length} argument(s), got ${expr.args.length}`,
        expr.span,
      );
    }
    const args: TypedExpression[] = [];
    for (let i = 0; i < expr.args.length; i++) {
      const arg = this.checkExpression(expr.args[i]!, ctx, calleeAllowOmit);
      const param = params[i];
      if (param !== undefined) {
        this.validateCallArgument(param, arg.choreoType, expr.args[i]!.span);
      }
      args.push(arg);
    }
    this.requireExpressionAvailable(symbol.returnType.location, ctx, expr.span);
    return {
      expr,
      choreoType: symbol.returnType,
      callee: symbol,
      args,
    };
  }

  private checkParen(
    expr: ParenthesizedExpression,
    ctx: ExecutionContext,
    allowOmit: boolean,
  ): TypedParenthesizedExpression {
    const expression = this.checkExpression(expr.expression, ctx, allowOmit);
    return {
      expr,
      choreoType: expression.choreoType,
      expression,
    };
  }

  private validateCallTarget(decl: FunctionDeclaration, span: Span): void {
    const ctx = this.currentContext();
    if (ctx === undefined) {
      return;
    }
    if (ctx.kind === "every") {
      return;
    }
    if (decl.at.kind === "every") {
      this.error(
        `cannot call @every function '${decl.name}' from local context (spec §7.12, §10.3)`,
        span,
      );
      return;
    }
    if (decl.at.name !== ctx.participant) {
      this.error(
        `cannot call function '${decl.name}' at '${decl.at.name}' from '${ctx.participant}' (spec §7.12, §10.3)`,
        span,
      );
    }
  }

  private validateCallArgument(
    param: LocatedType,
    arg: LocatedType,
    span: Span,
  ): void {
    if (!isSubtype(arg.base, param.base)) {
      this.error(
        `argument type ${formatLocatedType(arg)} is not assignable to parameter type ${formatLocatedType(param)}`,
        span,
      );
    }
    if (!available(arg.location, param.location)) {
      this.error(
        `argument location ${formatLocatedType(arg)} is not available at parameter location ${formatLocatedType(param)}`,
        span,
      );
    }
  }

  private validateAssignmentLike(
    target: LocatedType,
    source: LocatedType,
    span: Span,
  ): void {
    if (!isSubtype(source.base, target.base)) {
      this.error(
        `cannot assign ${formatLocatedType(source)} to ${formatLocatedType(target)}`,
        span,
      );
    }
    if (!available(source.location, target.location)) {
      this.error(
        `invalid assignment across locations: use communication instead (spec §7.7, §16.7)`,
        span,
      );
    }
  }

  private validateCommunication(
    target: LocatedType,
    source: LocatedType,
    span: Span,
  ): void {
    if (!isSubtype(source.base, target.base)) {
      this.error(
        `communication type mismatch: ${formatLocatedType(source)} to ${formatLocatedType(target)}`,
        span,
      );
    }
    if (source.location.kind === "every") {
      this.error(
        "cannot communicate from @every; use assignment instead (spec §11.4, §16.8)",
        span,
      );
    }
    if (locationsEqual(source.location, target.location)) {
      this.error(
        "communication source and destination must differ (spec §7.8)",
        span,
      );
    }
  }

  private assertCommAllowed(ctx: ExecutionContext, span: Span): void {
    if (ctx.kind === "local") {
      this.error(
        "communication is not allowed in local functions (spec §10.1)",
        span,
      );
    }
  }

  private locationAwareBinary(
    left: LocatedType,
    right: LocatedType,
    base: LocatedType["base"],
    ctx: ExecutionContext,
    span: Span,
  ): LocatedType {
    const evalLoc = this.resolveBinaryEvaluationLocation(
      left.location,
      right.location,
      ctx,
      span,
    );
    if (ctx.kind === "local") {
      this.requireExpressionAvailable(left.location, ctx, span);
      this.requireExpressionAvailable(right.location, ctx, span);
    }
    return locatedType(base, evalLoc);
  }

  private resolveBinaryEvaluationLocation(
    left: Location,
    right: Location,
    ctx: ExecutionContext,
    span: Span,
  ): Location {
    if (ctx.kind === "local") {
      const participant = ctx.participant;
      if (
        !localAvailable(left, participant) ||
        !localAvailable(right, participant) ||
        !locationsEqual(left, right)
      ) {
        this.error(
          `binary operands must be located at ${participant} in local function`,
          span,
        );
      }
      return left;
    }
    if (locationsEqual(left, right)) {
      return left;
    }
    if (left.kind === "every" && right.kind === "concrete") {
      return right;
    }
    if (left.kind === "concrete" && right.kind === "every") {
      return left;
    }
    this.error("binary operands must be at a compatible location", span);
    return left;
  }

  private requireAvailable(valueLoc: Location, useLoc: Location, span: Span): void {
    if (!available(valueLoc, useLoc)) {
      this.error(
        `value at ${valueLoc.kind === "every" ? "every" : valueLoc.name} is not available in this context (spec §7.6)`,
        span,
      );
    }
  }

  private requireExpressionAvailable(
    valueLoc: Location,
    ctx: ExecutionContext,
    span: Span,
  ): void {
    if (ctx.kind !== "local") {
      return;
    }
    if (!localAvailable(valueLoc, ctx.participant)) {
      this.error(
        `value at ${valueLoc.kind === "every" ? "every" : valueLoc.name} is not available in local function at ${ctx.participant}`,
        span,
      );
    }
  }

  private validateLocalFunctionLocatedType(
    decl: FunctionDeclaration | undefined,
    type: LocatedType,
    span: Span,
    role: "parameter" | "return type" | "variable type",
  ): void {
    if (decl === undefined || decl.context.kind !== "local") {
      return;
    }
    const participant = decl.context.participant;
    if (!localAvailable(type.location, participant)) {
      this.error(
        `function '${decl.name}' ${role} must be located at ${participant}, got ${formatLocatedType(type)}`,
        span,
      );
    }
  }

  private isNumeric(type: LocatedType): boolean {
    return type.base === "integer" || type.base === "float";
  }

  private resolveType(
    ann: import("../ast/syntax-types.js").TypeAnnotation,
    ctx: ExecutionContext,
    allowOmit: boolean,
  ): LocatedType {
    try {
      const resolved = resolveTypeAnnotation(ann, ctx, allowOmit);
      this.validateLocation(resolved.location, ann.span);
      return resolved;
    } catch (e) {
      if (e instanceof LocationOmitError) {
        this.error(e.message, e.span);
        return locatedType(ann.base, contextAsLocation(ctx));
      }
      throw e;
    }
  }

  private resolveLiteral(
    lit: import("../ast/literals.js").LocatedLiteral,
    ctx: ExecutionContext,
    allowOmit: boolean,
  ): LocatedType {
    try {
      const resolved = resolveLiteralType(lit, ctx, allowOmit);
      this.validateLocation(resolved.location, lit.span);
      return resolved;
    } catch (e) {
      if (e instanceof LocationOmitError) {
        this.error(e.message, e.span);
        return locatedType("integer", contextAsLocation(ctx));
      }
      throw e;
    }
  }

  private validateLocation(loc: Location, span: Span): void {
    if (loc.kind === "every") {
      return;
    }
    if (!this.participants.has(loc.name)) {
      this.error(
        `unknown participant '${loc.name}' (spec §16.1)`,
        span,
      );
    }
  }

  private defineLocal(name: string, type: LocatedType, span: Span): void {
    const env = this.currentEnv();
    if (env === undefined) {
      this.error(`cannot define '${name}' outside a scope`, span);
      return;
    }
    if (env.has(name)) {
      this.error(`variable '${name}' is already defined in this scope (spec §6.1)`, span);
      return;
    }
    env.set(name, type);
  }

  private lookupVariable(name: string, span: Span): LocatedType {
    for (let i = this.envStack.length - 1; i >= 0; i--) {
      const hit = this.envStack[i]!.get(name);
      if (hit !== undefined) {
        return hit;
      }
    }
    if (this.currentFunction === undefined) {
      const top = this.topLevelEnv.get(name);
      if (top !== undefined) {
        return top;
      }
    }
    this.error(`undefined variable '${name}'`, span);
    return locatedType("integer", { kind: "concrete", name: "_" });
  }

  private pushEnv(env: Map<string, LocatedType>): void {
    this.envStack.push(env);
  }

  private popEnv(): void {
    this.envStack.pop();
  }

  private currentEnv(): Map<string, LocatedType> | undefined {
    if (this.envStack.length > 0) {
      return this.envStack[this.envStack.length - 1];
    }
    if (this.currentFunction === undefined) {
      return this.topLevelEnv;
    }
    return undefined;
  }

  private currentContext(): ExecutionContext | undefined {
    if (this.currentFunction !== undefined) {
      return this.currentFunction.context;
    }
    if (this.inTopLevel) {
      return EVERY_CONTEXT;
    }
    return undefined;
  }

  private functionSymbol(decl: FunctionDeclaration): FunctionSymbol {
    const allowOmit = decl.context.kind === "local";
    const params = decl.params.map((p) =>
      this.resolveType(p.type, decl.context, allowOmit),
    );
    const returnType = this.getResolvedReturnType(decl);
    return {
      name: decl.name,
      at: decl.at,
      context: decl.context,
      params,
      returnType,
      decl,
      isLocal: decl.at.kind === "concrete",
      isEvery: decl.at.kind === "every",
    };
  }

  private unknownFunction(name: string): FunctionSymbol {
    const fallback = locatedType("integer", { kind: "concrete", name: "_" });
    const stub: FunctionDeclaration = {
      kind: "FunctionDeclaration",
      name,
      at: { kind: "concrete", name: "_" },
      context: { kind: "local", participant: "_" },
      params: [],
      returnType: {
        kind: "TypeAnnotation",
        base: "integer",
        span: { start: 0, end: 0 },
      },
      body: { kind: "Block", statements: [], span: { start: 0, end: 0 } },
      span: { start: 0, end: 0 },
    };
    return {
      name,
      at: stub.at,
      context: stub.context,
      params: [],
      returnType: fallback,
      decl: stub,
      isLocal: true,
      isEvery: false,
    };
  }

  private error(message: string, span: Span): void {
    this.errors.push(typeCheckError(message, span));
  }
}

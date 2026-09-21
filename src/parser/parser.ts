import type { Span } from "../ast/span.js";
import type { BaseType, TypeAnnotation } from "../ast/syntax-types.js";
import type { Location, LocationAnnotation } from "../ast/location.js";
import {
  CHOREOGRAPHY_CONTEXT,
  executionContextFromLocation,
} from "../ast/context.js";
import type {
  Program,
  TopLevelItem,
  TopLevelStatement,
} from "../ast/program.js";
import type { FunctionDeclaration, Parameter } from "../ast/declarations.js";
import type {
  Block,
  Statement,
  LetStatement,
  LetTransferStatement,
  AssignmentTarget,
  IdentifierAssignmentTarget,
  IndexAssignmentTarget,
  IfStatement,
  WhileStatement,
  ForStatement,
  ForInit,
  ForLetInit,
  ForAssignmentInit,
  ReturnStatement,
  ExpressionStatement,
} from "../ast/statements.js";
import type {
  Expression,
  BinaryExpression,
  UnaryExpression,
  LiteralExpression,
  ArrayLiteralExpression,
  IdentifierExpression,
  CallExpression,
  IndexExpression,
  ParenthesizedExpression,
} from "../ast/expressions.js";
import type {
  LocatedLiteral,
  RawLiteral,
  IntegerLiteral,
  FloatLiteral,
  StringLiteral,
  BooleanLiteral,
  NullLiteral,
} from "../ast/literals.js";
import type {
  BinaryOperator,
  UnaryOperator,
} from "../ast/operators.js";
import {
  TokenKind,
  tokenize,
  type Token,
} from "../lexer/index.js";
import { parseError, type ParseError } from "./errors.js";
import { spanBetween, spanFrom, spanMerge, spanOf, spanOfNode } from "./span-utils.js";

/**
 * The two array operation names, written after `.` (spec §5.14, §7.11.1).
 *
 * Grammar, not function names: they mean something only after a `.`, so a
 * program may still use `length` and `push` as ordinary identifiers
 * (spec §6.2) — which is why they are not among the reserved runtime names.
 */
const LENGTH_PROPERTY = "length";
const PUSH_METHOD = "push";

export interface ParseResult {
  readonly program: Program | null;
  readonly errors: readonly ParseError[];
}

export function parse(source: string): ParseResult {
  const lexed = tokenize(source);
  const lexicalAsParse: ParseError[] = lexed.errors.map((e) => ({
    message: e.message,
    span: { start: e.span.start.offset, end: e.span.end.offset },
  }));
  // The lexer substitutes a placeholder token when it recovers, so a token
  // stream that failed to lex cannot be parsed meaningfully. Report the
  // lexical errors — which are independent of each other — and stop.
  if (lexicalAsParse.length > 0) {
    return { program: null, errors: lexicalAsParse };
  }
  return parseTokens(lexed.tokens);
}

export function parseTokens(tokens: readonly Token[]): ParseResult {
  const parser = new Parser(tokens);
  return parser.parseProgram();
}

class Parser {
  private readonly errors: ParseError[] = [];
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parseProgram(): ParseResult {
    const start = this.current();
    const items: TopLevelItem[] = [];

    while (!this.check(TokenKind.EOF)) {
      try {
        if (this.check(TokenKind.Function)) {
          items.push(this.functionDeclaration());
        } else {
          items.push(this.topLevelStatement());
        }
      } catch {
        // Parsing stops at the first syntax error: once a construct has failed
        // to parse, any later diagnostic is a guess about where it ended.
        break;
      }
    }

    const end = this.previous();
    const span: Span =
      items.length > 0
        ? spanMerge(spanOf(start), spanOf(end))
        : spanOf(start);

    const program: Program = {
      kind: "Program",
      items,
      span,
    };

    return {
      program: this.errors.length === 0 ? program : null,
      errors: this.errors,
    };
  }

  // -------------------------------------------------------------------------
  // Top level (spec §5.1)
  // -------------------------------------------------------------------------

  private functionDeclaration(): FunctionDeclaration {
    const start = this.consume(TokenKind.Function, "expected 'function'");
    const nameTok = this.consumeIdentifierToken("expected function name");
    // A location names the one endpoint that runs the function, making it a
    // local function; a choreography function runs at every endpoint and has
    // none (spec §10.1).
    const at = this.match(TokenKind.At) ? this.parseLocation() : undefined;
    this.consume(TokenKind.LParen, "expected '(' after function name");
    const params = this.check(TokenKind.RParen) ? [] : this.parameterList();
    this.consume(TokenKind.RParen, "expected ')' after parameters");
    let returnType: TypeAnnotation | undefined;
    if (this.match(TokenKind.Colon)) {
      returnType = this.parseType();
    }
    const body = this.parseBlock();

    const decl: FunctionDeclaration = {
      kind: "FunctionDeclaration",
      name: nameTok.name,
      at,
      context: executionContextFromLocation(at),
      params,
      returnType,
      body,
      span: spanFrom(start, body),
    };
    return decl;
  }

  private topLevelStatement(): TopLevelStatement {
    const stmt = this.parseStatement();
    return {
      kind: "TopLevelStatement",
      context: CHOREOGRAPHY_CONTEXT,
      statement: stmt,
      span: spanOfNode(stmt),
    };
  }

  private parameterList(): Parameter[] {
    const params: Parameter[] = [];
    do {
      params.push(this.parameter());
    } while (this.match(TokenKind.Comma));
    return params;
  }

  private parameter(): Parameter {
    const start = this.current();
    const nameTok = this.consumeIdentifierToken("expected parameter name");
    this.consume(TokenKind.Colon, "expected ':' after parameter name");
    const type = this.parseType();
    return {
      kind: "Parameter",
      name: nameTok.name,
      type,
      span: spanFrom(start, type),
    };
  }

  // -------------------------------------------------------------------------
  // Types and locations (spec §5.2)
  // -------------------------------------------------------------------------

  private parseType(): TypeAnnotation {
    const start = this.current();
    const base = this.parseBaseType();
    let isArray = false;
    if (this.match(TokenKind.LBracket)) {
      this.consume(TokenKind.RBracket, "expected ']' after '[' in array type");
      isArray = true;
      if (this.match(TokenKind.LBracket)) {
        throw this.fail("nested array types are not supported (spec §5.2, §16.30)");
      }
    }
    let location: LocationAnnotation | undefined;
    if (this.match(TokenKind.At)) {
      location = this.locationAnnotationAfterAt();
    }
    return {
      kind: "TypeAnnotation",
      base: base.type,
      isArray: isArray ? true : undefined,
      location,
      span: location
        ? spanMerge(spanBetween(start, base.token), location.span)
        : spanBetween(start, base.token),
    };
  }

  private parseBaseType(): { type: BaseType; token: Token } {
    const token = this.current();
    const map: Partial<Record<TokenKind, BaseType>> = {
      [TokenKind.Integer]: "integer",
      [TokenKind.Float]: "float",
      [TokenKind.Boolean]: "boolean",
      [TokenKind.String]: "string",
      [TokenKind.Null]: "null",
      [TokenKind.Void]: "void",
    };
    const base = map[token.kind];
    if (base === undefined) {
      throw this.fail(`expected type name, found '${token.lexeme}'`);
    }
    this.advance();
    return { type: base, token };
  }

  private parseLocation(): Location {
    if (this.match(TokenKind.Every)) {
      return { kind: "every" };
    }
    const id = this.consumeIdentifierToken("expected location name or 'every'");
    return { kind: "individual", name: id.name };
  }

  /** Call only after `@` has been consumed with `match(TokenKind.At)`. */
  private locationAnnotationAfterAt(): LocationAnnotation {
    const start = this.previous();
    const location = this.parseLocation();
    const end = this.previous();
    return {
      kind: "LocationAnnotation",
      location,
      span: spanFrom(start, end),
    };
  }

  // -------------------------------------------------------------------------
  // Statements (spec §5.5)
  // -------------------------------------------------------------------------

  private parseBlock(): Block {
    const start = this.consume(TokenKind.LBrace, "expected '{'");
    const statements: Statement[] = [];
    while (!this.check(TokenKind.RBrace) && !this.check(TokenKind.EOF)) {
      statements.push(this.parseStatement());
    }
    const end = this.consume(TokenKind.RBrace, "expected '}'");
    return {
      kind: "Block",
      statements,
      span: spanFrom(start, end),
    };
  }

  private parseStatement(): Statement {
    if (this.match(TokenKind.Let)) {
      return this.parseLetStatement(true);
    }
    if (this.match(TokenKind.If)) {
      return this.parseIfStatement();
    }
    if (this.match(TokenKind.While)) {
      return this.parseWhileStatement();
    }
    if (this.match(TokenKind.For)) {
      return this.parseForStatement();
    }
    if (this.match(TokenKind.Return)) {
      return this.parseReturnStatement();
    }
    if (this.check(TokenKind.Identifier)) {
      return this.parseIdentifierLeadingStatement();
    }
    if (this.isUnsupportedStatementKeyword(this.current().kind)) {
      throw this.fail(
        `'${this.current().lexeme}' is not supported in ChoreoBS Core v0`,
      );
    }
    return this.parseExpressionStatement();
  }

  private parseLetStatement(requireSemicolon: boolean): LetStatement | LetTransferStatement {
    const start = this.previous();
    const nameTok = this.consumeIdentifierToken("expected variable name after 'let'");

    if (this.match(TokenKind.Transfer)) {
      throw this.fail(
        "type annotation required for transfer let (spec §5.6, §7.14.3)",
      );
    }

    if (this.match(TokenKind.Assign)) {
      const initializer = this.parseExpression();
      if (requireSemicolon) {
        this.consume(TokenKind.Semicolon, "expected ';' after let statement");
      }
      const stmt: LetStatement = {
        kind: "LetStatement",
        name: nameTok.name,
        initializer,
        span: spanFrom(start, requireSemicolon ? this.previous() : initializer),
      };
      return stmt;
    }

    if (this.match(TokenKind.Colon)) {
      const type = this.parseType();

      if (this.match(TokenKind.Assign)) {
        const initializer = this.parseExpression();
        if (requireSemicolon) {
          this.consume(TokenKind.Semicolon, "expected ';' after let statement");
        }
        const stmt: LetStatement = {
          kind: "LetStatement",
          name: nameTok.name,
          type,
          initializer,
          span: spanFrom(start, requireSemicolon ? this.previous() : initializer),
        };
        return stmt;
      }

      if (this.match(TokenKind.Transfer)) {
        const source = this.parseExpression();
        if (requireSemicolon) {
          this.consume(TokenKind.Semicolon, "expected ';' after let statement");
        }
        const stmt: LetTransferStatement = {
          kind: "LetTransferStatement",
          name: nameTok.name,
          type,
          source,
          span: spanFrom(start, requireSemicolon ? this.previous() : source),
        };
        return stmt;
      }

      throw this.fail(
        "expected '=' or '<-' after type in let statement; uninitialized let is not allowed (spec §5.6)",
      );
    }

    throw this.fail(
      "expected ':', '=', or '<-' after variable name in let; uninitialized let is not allowed (spec §5.6)",
    );
  }

  private parseIdentifierLeadingStatement(): Statement {
    const start = this.index;
    const nameTok = this.consumeIdentifierToken("expected identifier");
    if (this.match(TokenKind.LBracket)) {
      const index = this.parseExpression();
      this.consume(TokenKind.RBracket, "expected ']' after index expression");
      if (this.match(TokenKind.Assign)) {
        const value = this.parseExpression();
        this.consume(TokenKind.Semicolon, "expected ';' after assignment");
        const target: IndexAssignmentTarget = {
          kind: "IndexAssignmentTarget",
          name: nameTok.name,
          index,
          span: spanFrom(nameTok, index),
        };
        return {
          kind: "AssignmentStatement",
          target,
          value,
          span: spanFrom(nameTok, value),
        };
      }
      this.index = start;
      return this.parseExpressionStatement();
    }
    if (this.match(TokenKind.Assign)) {
      const value = this.parseExpression();
      this.consume(TokenKind.Semicolon, "expected ';' after assignment");
      const target: IdentifierAssignmentTarget = {
        kind: "IdentifierAssignmentTarget",
        name: nameTok.name,
        span: spanOf(nameTok),
      };
      return {
        kind: "AssignmentStatement",
        target,
        value,
        span: spanFrom(nameTok, value),
      };
    }
    if (this.match(TokenKind.Transfer)) {
      const source = this.parseExpression();
      this.consume(TokenKind.Semicolon, "expected ';' after transfer statement");
      return {
        kind: "TransferStatement",
        name: nameTok.name,
        source,
        span: spanFrom(nameTok, source),
      };
    }

    // Rewind to the start of the statement rather than by one token: the
    // branches above may consume more than the leading identifier.
    this.index = start;
    return this.parseExpressionStatement();
  }

  private parseIfStatement(): IfStatement {
    const start = this.previous();
    this.consume(TokenKind.LParen, "expected '(' after 'if'");
    const condition = this.parseExpression();
    this.consume(TokenKind.RParen, "expected ')' after if condition");
    const then = this.parseBlock();
    let elseBlock: Block | undefined;
    if (this.match(TokenKind.Else)) {
      elseBlock = this.parseBlock();
    }
    const end = elseBlock ?? then;
    return {
      kind: "IfStatement",
      condition,
      then,
      else: elseBlock,
      span: spanFrom(start, end),
    };
  }

  private parseWhileStatement(): WhileStatement {
    const start = this.previous();
    this.consume(TokenKind.LParen, "expected '(' after 'while'");
    const condition = this.parseExpression();
    this.consume(TokenKind.RParen, "expected ')' after while condition");
    const body = this.parseBlock();
    return {
      kind: "WhileStatement",
      condition,
      body,
      span: spanFrom(start, body),
    };
  }

  private parseForStatement(): ForStatement {
    const start = this.previous();
    this.consume(TokenKind.LParen, "expected '(' after 'for'");
    let init: ForInit | undefined;
    if (!this.check(TokenKind.Semicolon)) {
      init = this.parseForInit();
    }
    this.consume(TokenKind.Semicolon, "expected ';' after for initializer");
    // The condition is required (spec §5.11). An omitted one would have to mean
    // an implicit `true`, and a literal has no location to take from context
    // (spec §8.1); `while (true@every)` says the same thing explicitly.
    const condition = this.parseExpression();
    this.consume(TokenKind.Semicolon, "expected ';' after for condition");
    let update: ForAssignmentInit | undefined;
    if (!this.check(TokenKind.RParen)) {
      update = this.parseForUpdate();
    }
    this.consume(TokenKind.RParen, "expected ')' after for clauses");
    const body = this.parseBlock();
    return {
      kind: "ForStatement",
      init,
      condition,
      update,
      body,
      span: spanFrom(start, body),
    };
  }

  /** spec §5.11 — for-init: let-with-`=` or assignment only */
  private parseForInit(): ForInit {
    if (this.match(TokenKind.Let)) {
      const start = this.previous();
      const nameTok = this.consumeIdentifierToken("expected variable name after 'let'");
      let type: TypeAnnotation | undefined;
      if (this.match(TokenKind.Colon)) {
        type = this.parseType();
      }
      this.consume(TokenKind.Assign, "expected '=' in for-loop let initializer");
      const initializer = this.parseExpression();
      const init: ForLetInit = {
        kind: "ForLetInit",
        name: nameTok.name,
        type,
        initializer,
        span: spanFrom(start, initializer),
      };
      return init;
    }
    return this.parseForAssignmentInit();
  }

  private parseForUpdate(): ForAssignmentInit {
    return this.parseForAssignmentInit();
  }

  /**
   * `i = e` or `xs[i] = e`. The target is the same shape an assignment
   * statement takes (spec §5.7, §5.11).
   */
  private parseForAssignmentInit(): ForAssignmentInit {
    const start = this.current();
    const nameTok = this.consumeIdentifierToken("expected identifier in for clause");
    let target: AssignmentTarget;
    if (this.match(TokenKind.LBracket)) {
      const index = this.parseExpression();
      this.consume(TokenKind.RBracket, "expected ']' after index expression");
      target = {
        kind: "IndexAssignmentTarget",
        name: nameTok.name,
        index,
        span: spanFrom(nameTok, index),
      };
    } else {
      target = {
        kind: "IdentifierAssignmentTarget",
        name: nameTok.name,
        span: spanOf(nameTok),
      };
    }
    this.consume(TokenKind.Assign, "expected '=' in for clause");
    const value = this.parseExpression();
    return {
      kind: "ForAssignmentInit",
      target,
      value,
      span: spanFrom(start, value),
    };
  }

  private parseReturnStatement(): ReturnStatement {
    const start = this.previous();
    let value: Expression | undefined;
    if (!this.check(TokenKind.Semicolon)) {
      value = this.parseExpression();
    }
    this.consume(TokenKind.Semicolon, "expected ';' after return");
    return {
      kind: "ReturnStatement",
      value,
      span: value ? spanFrom(start, value) : spanOf(start),
    };
  }

  private parseExpressionStatement(): ExpressionStatement {
    const start = this.current();
    const expression = this.parseExpression();
    this.consume(TokenKind.Semicolon, "expected ';' after expression");
    return {
      kind: "ExpressionStatement",
      expression,
      span: spanBetween(start, this.previous()),
    };
  }

  // -------------------------------------------------------------------------
  // Expressions (spec §5.14) — precedence climbing via recursive descent
  // -------------------------------------------------------------------------

  private parseExpression(): Expression {
    return this.parseLogicalOr();
  }

  private parseLogicalOr(): Expression {
    return this.parseBinaryLeft(
      () => this.parseLogicalAnd(),
      (left, operator, right, opToken) =>
        this.makeBinary(left, operator, right, opToken),
      TokenKind.BarBar,
      "||",
    );
  }

  private parseLogicalAnd(): Expression {
    return this.parseBinaryLeft(
      () => this.parseEquality(),
      (left, operator, right, opToken) =>
        this.makeBinary(left, operator, right, opToken),
      TokenKind.AmpAmp,
      "&&",
    );
  }

  private parseEquality(): Expression {
    return this.parseBinaryLeft(
      () => this.parseRelational(),
      (left, operator, right, opToken) =>
        this.makeBinary(left, operator, right, opToken),
      [TokenKind.StrictEqual, TokenKind.StrictNotEqual],
      ["===", "!=="],
    );
  }

  private parseRelational(): Expression {
    return this.parseBinaryLeft(
      () => this.parseAdditive(),
      (left, operator, right, opToken) =>
        this.makeBinary(left, operator, right, opToken),
      [
        TokenKind.Less,
        TokenKind.LessEqual,
        TokenKind.Greater,
        TokenKind.GreaterEqual,
      ],
      ["<", "<=", ">", ">="],
    );
  }

  private parseAdditive(): Expression {
    return this.parseBinaryLeft(
      () => this.parseMultiplicative(),
      (left, operator, right, opToken) =>
        this.makeBinary(left, operator, right, opToken),
      [TokenKind.Plus, TokenKind.Minus],
      ["+", "-"],
    );
  }

  private parseMultiplicative(): Expression {
    return this.parseBinaryLeft(
      () => this.parseUnary(),
      (left, operator, right, opToken) =>
        this.makeBinary(left, operator, right, opToken),
      [TokenKind.Star, TokenKind.Slash, TokenKind.Percent],
      ["*", "/", "%"],
    );
  }

  private parseUnary(): Expression {
    if (this.match(TokenKind.Bang, TokenKind.Minus)) {
      const opToken = this.previous();
      const operator: UnaryOperator = opToken.kind === TokenKind.Bang ? "!" : "-";
      const operand = this.parseUnary();
      const expr: UnaryExpression = {
        kind: "UnaryExpression",
        operator,
        operand,
        span: spanMerge(spanOf(opToken), spanOfNode(operand)),
      };
      return expr;
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expression {
    let expr = this.parsePrimary();
    for (;;) {
      if (this.match(TokenKind.LBracket)) {
        const start = spanOfNode(expr);
        const index = this.parseExpression();
        const end = this.consume(TokenKind.RBracket, "expected ']' after index expression");
        expr = {
          kind: "IndexExpression",
          target: expr,
          index,
          span: spanMerge(start, spanOf(end)),
        } satisfies IndexExpression;
        continue;
      }
      if (this.check(TokenKind.Dot)) {
        expr = this.finishMember(expr);
        continue;
      }
      return expr;
    }
  }

  /**
   * `xs.length` and `xs.push(v)` — the two array member operations
   * (spec §5.14, §7.11.1).
   *
   * Both take a variable as their receiver. The member token is checked before
   * being consumed, because `fail` reports at the current token.
   */
  private finishMember(target: Expression): Expression {
    this.advance(); // '.'
    const member = this.current();
    if (member.kind !== TokenKind.Identifier) {
      throw this.fail("expected a property name after '.'");
    }
    if (
      member.lexeme !== LENGTH_PROPERTY &&
      member.lexeme !== PUSH_METHOD
    ) {
      throw this.fail(
        `unknown array operation '.${member.lexeme}': v0 supports '.length' and '.push' (spec §5.14, §7.11.1)`,
      );
    }
    if (target.kind !== "IdentifierExpression") {
      throw this.fail(
        `the receiver of '.${member.lexeme}' must be a variable (spec §5.14)`,
      );
    }
    this.advance();
    if (member.lexeme === LENGTH_PROPERTY) {
      return {
        kind: "LengthExpression",
        target,
        span: spanMerge(spanOfNode(target), spanOf(member)),
      };
    }
    this.consume(TokenKind.LParen, "expected '(' after '.push'");
    const value = this.parseExpression();
    const end = this.consume(
      TokenKind.RParen,
      "expected ')' after the argument of '.push'",
    );
    return {
      kind: "PushExpression",
      target,
      value,
      span: spanMerge(spanOfNode(target), spanOf(end)),
    };
  }

  private parsePrimary(): Expression {
    if (this.match(TokenKind.LBracket)) {
      return this.parseArrayLiteral();
    }
    if (this.match(TokenKind.LParen)) {
      const start = this.previous();
      const expression = this.parseExpression();
      const end = this.consume(TokenKind.RParen, "expected ')' after expression");
      const expr: ParenthesizedExpression = {
        kind: "ParenthesizedExpression",
        expression,
        span: spanBetween(start, end),
      };
      return expr;
    }

    if (this.isLiteralToken(this.current())) {
      return this.parseLiteralExpression();
    }

    if (this.check(TokenKind.Identifier)) {
      const idToken = this.consumeIdentifierToken("expected expression");
      if (this.match(TokenKind.LParen)) {
        return this.finishCall(idToken);
      }
      const expr: IdentifierExpression = {
        kind: "IdentifierExpression",
        name: idToken.name,
        span: spanOf(idToken),
      };
      return expr;
    }

    throw this.fail(`expected expression, found '${this.current().lexeme}'`);
  }

  private parseArrayLiteral(): ArrayLiteralExpression {
    const start = this.previous();
    const elements: Expression[] = [];
    if (!this.check(TokenKind.RBracket)) {
      do {
        elements.push(this.parseExpression());
      } while (this.match(TokenKind.Comma));
    }
    const close = this.consume(TokenKind.RBracket, "expected ']' after array literal");
    let location: LocationAnnotation | undefined;
    if (this.match(TokenKind.At)) {
      location = this.locationAnnotationAfterAt();
    }
    return {
      kind: "ArrayLiteralExpression",
      elements,
      location,
      span: location ? spanMerge(spanOf(start), location.span) : spanBetween(start, close),
    };
  }

  private finishCall(calleeToken: { name: string; span: Token["span"] } & Token): CallExpression {
    const args: Expression[] = [];
    if (!this.check(TokenKind.RParen)) {
      do {
        args.push(this.parseExpression());
      } while (this.match(TokenKind.Comma));
    }
    const end = this.consume(TokenKind.RParen, "expected ')' after arguments");
    return {
      kind: "CallExpression",
      callee: calleeToken.name,
      args,
      span: spanBetween(calleeToken, end),
    };
  }

  private parseLiteralExpression(): LiteralExpression {
    const literal = this.parseLocatedLiteral();
    return {
      kind: "LiteralExpression",
      literal,
      span: literal.span,
    };
  }

  private parseLocatedLiteral(): LocatedLiteral {
    const raw = this.parseRawLiteral();
    let location: LocationAnnotation | undefined;
    if (this.match(TokenKind.At)) {
      location = this.locationAnnotationAfterAt();
    }
    return {
      kind: "LocatedLiteral",
      literal: raw,
      location,
      span: location ? spanMerge(spanOfNode(raw), location.span) : spanOfNode(raw),
    };
  }

  private parseRawLiteral(): RawLiteral {
    const token = this.current();
    switch (token.kind) {
      case TokenKind.IntegerLiteral: {
        this.advance();
        const node: IntegerLiteral = {
          kind: "IntegerLiteral",
          value: token.value,
          span: spanOf(token),
        };
        return node;
      }
      case TokenKind.FloatLiteral: {
        this.advance();
        const node: FloatLiteral = {
          kind: "FloatLiteral",
          value: token.value,
          span: spanOf(token),
        };
        return node;
      }
      case TokenKind.StringLiteral: {
        this.advance();
        const node: StringLiteral = {
          kind: "StringLiteral",
          value: token.value,
          span: spanOf(token),
        };
        return node;
      }
      case TokenKind.True: {
        this.advance();
        const node: BooleanLiteral = {
          kind: "BooleanLiteral",
          value: true,
          span: spanOf(token),
        };
        return node;
      }
      case TokenKind.False: {
        this.advance();
        const node: BooleanLiteral = {
          kind: "BooleanLiteral",
          value: false,
          span: spanOf(token),
        };
        return node;
      }
      case TokenKind.Null: {
        this.advance();
        const node: NullLiteral = {
          kind: "NullLiteral",
          span: spanOf(token),
        };
        return node;
      }
      default:
        throw this.fail(`expected literal, found '${token.lexeme}'`);
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private makeBinary(
    left: Expression,
    operator: BinaryOperator,
    right: Expression,
    opToken: Token,
  ): BinaryExpression {
    return {
      kind: "BinaryExpression",
      operator,
      left,
      right,
      span: spanMerge(spanOfNode(left), spanMerge(spanOf(opToken), spanOfNode(right))),
    };
  }

  private parseBinaryLeft(
    parseOperand: () => Expression,
    makeNode: (
      left: Expression,
      operator: BinaryOperator,
      right: Expression,
      opToken: Token,
    ) => BinaryExpression,
    kinds: TokenKind | TokenKind[],
    operators: BinaryOperator | BinaryOperator[],
  ): Expression {
    let left = parseOperand();
    const kindList = Array.isArray(kinds) ? kinds : [kinds];
    const opList = Array.isArray(operators) ? operators : [operators];

    while (true) {
      const index = kindList.indexOf(this.current().kind);
      if (index === -1) {
        break;
      }
      const opToken = this.advance();
      const operator = opList[index]!;
      const right = parseOperand();
      left = makeNode(left, operator, right, opToken);
    }
    return left;
  }

  private isLiteralToken(token: Token): boolean {
    return (
      token.kind === TokenKind.IntegerLiteral ||
      token.kind === TokenKind.FloatLiteral ||
      token.kind === TokenKind.StringLiteral ||
      token.kind === TokenKind.True ||
      token.kind === TokenKind.False ||
      token.kind === TokenKind.Null
    );
  }

  private isUnsupportedStatementKeyword(kind: TokenKind): boolean {
    return (
      kind === TokenKind.Break ||
      kind === TokenKind.Continue ||
      kind === TokenKind.Const ||
      kind === TokenKind.Any ||
      kind === TokenKind.Undefined ||
      kind === TokenKind.Async ||
      kind === TokenKind.Await ||
      kind === TokenKind.Class ||
      kind === TokenKind.Import ||
      kind === TokenKind.Export
    );
  }



  private consumeIdentifierToken(message: string): Token & { name: string } {
    const token = this.current();
    if (token.kind !== TokenKind.Identifier) {
      throw this.fail(message);
    }
    this.advance();
    return token;
  }

  private match(...kinds: TokenKind[]): boolean {
    for (const kind of kinds) {
      if (this.check(kind)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private check(kind: TokenKind): boolean {
    return this.current().kind === kind;
  }

  private advance(): Token {
    if (!this.check(TokenKind.EOF)) {
      this.index += 1;
    }
    return this.previous();
  }

  private current(): Token {
    return this.tokens[this.index]!;
  }

  private previous(): Token {
    return this.tokens[this.index - 1]!;
  }

  private consume(kind: TokenKind, message: string): Token {
    if (this.check(kind)) {
      return this.advance();
    }
    throw this.fail(message);
  }

  private fail(message: string): Error {
    const token = this.current();
    this.errors.push(parseError(message, spanOf(token)));
    return new Error(message);
  }
}

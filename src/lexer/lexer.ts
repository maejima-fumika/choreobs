import { positionAt, type Position, type SourceSpan } from "./position.js";
import { lexicalError, type LexicalError } from "./errors.js";
import {
  TokenKind,
  type EOFToken,
  type FloatLiteralToken,
  type IdentifierToken,
  type IntegerLiteralToken,
  type KeywordToken,
  type PunctuationToken,
  type StringLiteralToken,
  type Token,
} from "./tokens.js";

export interface TokenizeResult {
  readonly tokens: readonly Token[];
  readonly errors: readonly LexicalError[];
}

const KEYWORDS: Readonly<Record<string, TokenKind>> = {
  function: TokenKind.Function,
  let: TokenKind.Let,
  if: TokenKind.If,
  else: TokenKind.Else,
  while: TokenKind.While,
  for: TokenKind.For,
  return: TokenKind.Return,
  true: TokenKind.True,
  false: TokenKind.False,
  null: TokenKind.Null,
  every: TokenKind.Every,
  integer: TokenKind.Integer,
  float: TokenKind.Float,
  boolean: TokenKind.Boolean,
  string: TokenKind.String,
  void: TokenKind.Void,
  break: TokenKind.Break,
  continue: TokenKind.Continue,
  const: TokenKind.Const,
  any: TokenKind.Any,
  undefined: TokenKind.Undefined,
  async: TokenKind.Async,
  await: TokenKind.Await,
  class: TokenKind.Class,
  import: TokenKind.Import,
  export: TokenKind.Export,
};

export function tokenize(source: string): TokenizeResult {
  return new Lexer(source).tokenize();
}

/**
 * Whether `name` is something the source could write as an identifier
 * (spec §4.3): the right shape, and not a reserved word (spec §4.4).
 *
 * Answered by running the real lexer rather than by a second copy of the rule,
 * so that a change to identifier syntax or to {@link KEYWORDS} cannot leave
 * this behind. Endpoint names are checked with it (spec §2.2): a name the
 * source cannot write after `@` names an endpoint no program can reach.
 */
export function isIdentifierName(name: string): boolean {
  const { tokens, errors } = tokenize(name);
  return (
    errors.length === 0 &&
    tokens.length === 2 &&
    tokens[0]!.kind === TokenKind.Identifier &&
    tokens[1]!.kind === TokenKind.EOF
  );
}

class Lexer {
  private readonly tokens: Token[] = [];
  private readonly errors: LexicalError[] = [];
  private pos = 0;
  private line = 1;
  private column = 1;

  constructor(private readonly source: string) {}

  tokenize(): TokenizeResult {
    while (!this.isAtEnd()) {
      this.scanToken();
    }

    const eofStart = this.currentPosition();
    this.tokens.push(this.makeToken(TokenKind.EOF, "", eofStart, eofStart));

    return { tokens: this.tokens, errors: this.errors };
  }

  private scanToken(): void {
    const start = this.currentPosition();
    const char = this.advance();

    switch (char) {
      case " ":
      case "\t":
      case "\r":
        return;
      case "\n":
        // `advance()` already moved to the next line.
        return;

      case "(":
        this.pushPunctuation(TokenKind.LParen, char, start);
        return;
      case ")":
        this.pushPunctuation(TokenKind.RParen, char, start);
        return;
      case "{":
        this.pushPunctuation(TokenKind.LBrace, char, start);
        return;
      case "}":
        this.pushPunctuation(TokenKind.RBrace, char, start);
        return;
      case "[":
        this.pushPunctuation(TokenKind.LBracket, char, start);
        return;
      case "]":
        this.pushPunctuation(TokenKind.RBracket, char, start);
        return;
      case ",":
        this.pushPunctuation(TokenKind.Comma, char, start);
        return;
      case ";":
        this.pushPunctuation(TokenKind.Semicolon, char, start);
        return;
      case ":":
        this.pushPunctuation(TokenKind.Colon, char, start);
        return;
      case "@":
        this.pushPunctuation(TokenKind.At, char, start);
        return;
      case "+":
        this.pushPunctuation(TokenKind.Plus, char, start);
        return;
      case "-":
        this.pushPunctuation(TokenKind.Minus, char, start);
        return;
      case "*":
        this.pushPunctuation(TokenKind.Star, char, start);
        return;
      case "/":
        if (this.match("/")) {
          while (!this.isAtEnd() && this.peek() !== "\n") {
            this.advance();
          }
          return;
        }
        if (this.match("*")) {
          this.blockComment();
          return;
        }
        this.pushPunctuation(TokenKind.Slash, char, start);
        return;
      case "%":
        this.pushPunctuation(TokenKind.Percent, char, start);
        return;
      case ".":
        this.pushPunctuation(TokenKind.Dot, char, start);
        return;
      case "!":
        if (this.match("=")) {
          if (this.match("=")) {
            this.pushPunctuation(TokenKind.StrictNotEqual, "!==", start);
            return;
          }
          this.pos -= 1;
          this.column -= 1;
          this.error(
            "unsupported operator '!='; use '!==' (spec §4.6)",
            start,
            this.currentPosition(),
          );
          this.pushPunctuation(TokenKind.Bang, "!", start);
          return;
        }
        this.pushPunctuation(TokenKind.Bang, char, start);
        return;
      case "=":
        if (this.match("=")) {
          if (this.match("=")) {
            this.pushPunctuation(TokenKind.StrictEqual, "===", start);
            return;
          }
          this.pos -= 1;
          this.column -= 1;
          this.error(
            "unsupported operator '=='; use '===' (spec §4.6)",
            start,
            this.currentPosition(),
          );
          this.pushPunctuation(TokenKind.Assign, "=", start);
          return;
        }
        this.pushPunctuation(TokenKind.Assign, char, start);
        return;
      case "<":
        // Maximal munch on the raw character stream: `a<-b` is a transfer,
        // while `a < -b` (with a space) stays a comparison against `-b`.
        if (this.match("-")) {
          this.pushPunctuation(TokenKind.Transfer, "<-", start);
          return;
        }
        if (this.match("=")) {
          this.pushPunctuation(TokenKind.LessEqual, "<=", start);
          return;
        }
        this.pushPunctuation(TokenKind.Less, char, start);
        return;
      case ">":
        if (this.match("=")) {
          this.pushPunctuation(TokenKind.GreaterEqual, ">=", start);
          return;
        }
        this.pushPunctuation(TokenKind.Greater, char, start);
        return;
      case "&":
        if (this.match("&")) {
          this.pushPunctuation(TokenKind.AmpAmp, "&&", start);
          return;
        }
        break;
      case "|":
        if (this.match("|")) {
          this.pushPunctuation(TokenKind.BarBar, "||", start);
          return;
        }
        break;
      case '"':
        this.stringLiteral(start);
        return;
      default:
        if (this.isDigit(char)) {
          this.numberLiteral(char, start);
          return;
        }
        if (this.isIdentifierStart(char)) {
          this.identifier(char, start);
          return;
        }
        break;
    }

    this.error(`unexpected character '${char}'`, start, this.currentPosition());
  }

  private numberLiteral(firstDigit: string, start: Position): void {
    let lexeme = firstDigit;
    while (this.isDigit(this.peek())) {
      lexeme += this.advance();
    }

    if (this.peek() === "." && this.isDigit(this.peekNext())) {
      lexeme += this.advance();
      while (this.isDigit(this.peek())) {
        lexeme += this.advance();
      }
      const end = this.currentPosition();
      const value = Number.parseFloat(lexeme);
      const token: FloatLiteralToken = {
        kind: TokenKind.FloatLiteral,
        lexeme,
        value,
        span: this.spanFrom(start, end),
      };
      this.tokens.push(token);
      return;
    }

    const end = this.currentPosition();
    const value = Number.parseInt(lexeme, 10);
    const token: IntegerLiteralToken = {
      kind: TokenKind.IntegerLiteral,
      lexeme,
      value,
      span: this.spanFrom(start, end),
    };
    this.tokens.push(token);
  }

  private identifier(first: string, start: Position): void {
    let lexeme = first;
    while (this.isIdentifierPart(this.peek())) {
      lexeme += this.advance();
    }

    const end = this.currentPosition();
    const span = this.spanFrom(start, end);
    const keywordKind = KEYWORDS[lexeme];
    if (keywordKind !== undefined) {
      const token: KeywordToken = {
        kind: keywordKind,
        lexeme,
        span,
      } as KeywordToken;
      this.tokens.push(token);
      return;
    }

    const token: IdentifierToken = {
      kind: TokenKind.Identifier,
      lexeme,
      name: lexeme,
      span,
    };
    this.tokens.push(token);
  }

  private stringLiteral(start: Position): void {
    let value = "";
    let lexeme = '"';
    while (!this.isAtEnd() && this.peek() !== '"') {
      if (this.peek() === "\n") {
        this.error("unterminated string literal", start, this.currentPosition());
        return;
      }
      const ch = this.advance();
      lexeme += ch;
      if (ch === "\\") {
        if (this.isAtEnd()) {
          this.error("unterminated string literal", start, this.currentPosition());
          return;
        }
        const escaped = this.advance();
        lexeme += escaped;
        switch (escaped) {
          case '"':
            value += '"';
            break;
          case "\\":
            value += "\\";
            break;
          case "n":
            value += "\n";
            break;
          case "r":
            value += "\r";
            break;
          case "t":
            value += "\t";
            break;
          default:
            this.error(
              `invalid escape sequence '\\${escaped}'`,
              start,
              this.currentPosition(),
            );
            value += escaped;
            break;
        }
        continue;
      }
      value += ch;
    }

    if (this.isAtEnd()) {
      this.error("unterminated string literal", start, this.currentPosition());
      return;
    }

    lexeme += this.advance();
    const end = this.currentPosition();
    const token: StringLiteralToken = {
      kind: TokenKind.StringLiteral,
      lexeme,
      value,
      span: this.spanFrom(start, end),
    };
    this.tokens.push(token);
  }

  private blockComment(): void {
    while (!this.isAtEnd()) {
      if (this.peek() === "*" && this.peekNext() === "/") {
        this.advance();
        this.advance();
        return;
      }
      this.advance();
    }
    this.error("unterminated block comment", this.currentPosition(), this.currentPosition());
  }

  private pushPunctuation(
    kind: PunctuationToken["kind"],
    lexeme: string,
    start: Position,
  ): void {
    const end = this.currentPosition();
    const token: PunctuationToken = {
      kind,
      lexeme,
      span: this.spanFrom(start, end),
    };
    this.tokens.push(token);
  }

  private makeToken(
    kind: TokenKind,
    lexeme: string,
    start: Position,
    end: Position,
  ): EOFToken {
    return {
      kind: kind as typeof TokenKind.EOF,
      lexeme,
      span: this.spanFrom(start, end),
    };
  }

  private spanFrom(start: Position, end: Position): SourceSpan {
    return { start, end };
  }

  private error(message: string, start: Position, end: Position): void {
    this.errors.push(lexicalError(message, this.spanFrom(start, end)));
  }

  private currentPosition(): Position {
    return positionAt(this.pos, this.line, this.column);
  }

  private isAtEnd(): boolean {
    return this.pos >= this.source.length;
  }

  private peek(): string {
    if (this.isAtEnd()) {
      return "\0";
    }
    return this.source[this.pos]!;
  }

  private peekNext(): string {
    if (this.pos + 1 >= this.source.length) {
      return "\0";
    }
    return this.source[this.pos + 1]!;
  }

  private match(expected: string): boolean {
    if (this.isAtEnd() || this.source[this.pos] !== expected) {
      return false;
    }
    this.advance();
    return true;
  }

  private advance(): string {
    const char = this.source[this.pos]!;
    this.pos += 1;
    if (char === "\n") {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
    return char;
  }

  private isDigit(char: string): boolean {
    return char >= "0" && char <= "9";
  }

  private isIdentifierStart(char: string): boolean {
    return (
      (char >= "a" && char <= "z") ||
      (char >= "A" && char <= "Z") ||
      char === "_"
    );
  }

  private isIdentifierPart(char: string): boolean {
    return this.isIdentifierStart(char) || this.isDigit(char);
  }
}

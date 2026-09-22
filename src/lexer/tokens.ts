import type { SourceSpan } from "./position.js";

/**
 * Token kinds recognized by the ChoreoBS lexer (spec §lexical-specification).
 *
 * Keywords are distinct kinds (not generic `identifier`) so the parser
 * can match them without a separate keyword table.
 */
export const TokenKind = {
  // Literals (spec §literals)
  IntegerLiteral: "IntegerLiteral",
  FloatLiteral: "FloatLiteral",
  StringLiteral: "StringLiteral",

  // Identifiers (non-reserved words)
  Identifier: "Identifier",

  // Keywords — language (spec §keywords)
  Function: "Function",
  Let: "Let",
  If: "If",
  Else: "Else",
  While: "While",
  For: "For",
  Return: "Return",
  True: "True",
  False: "False",
  Null: "Null",
  Every: "Every",
  Integer: "Integer",
  Float: "Float",
  Boolean: "Boolean",
  String: "String",
  Void: "Void",

  // Keywords — reserved but unsupported in v0 (spec §keywords)
  Break: "Break",
  Continue: "Continue",
  Const: "Const",
  Any: "Any",
  Undefined: "Undefined",
  Async: "Async",
  Await: "Await",
  Class: "Class",
  Import: "Import",
  Export: "Export",

  // Operators and punctuation (spec §operators-and-punctuation)
  Plus: "Plus",
  Minus: "Minus",
  Star: "Star",
  Slash: "Slash",
  Percent: "Percent",
  Less: "Less",
  LessEqual: "LessEqual",
  Greater: "Greater",
  GreaterEqual: "GreaterEqual",
  StrictEqual: "StrictEqual",
  StrictNotEqual: "StrictNotEqual",
  AmpAmp: "AmpAmp",
  BarBar: "BarBar",
  Bang: "Bang",
  Assign: "Assign",
  Transfer: "Transfer",
  At: "At",
  Colon: "Colon",
  Semicolon: "Semicolon",
  Comma: "Comma",
  Dot: "Dot",
  LParen: "LParen",
  RParen: "RParen",
  LBrace: "LBrace",
  RBrace: "RBrace",
  LBracket: "LBracket",
  RBracket: "RBracket",

  EOF: "EOF",
} as const;

export type TokenKind = (typeof TokenKind)[keyof typeof TokenKind];

interface TokenBase {
  readonly kind: TokenKind;
  /** Exact source text for this token. */
  readonly lexeme: string;
  readonly span: SourceSpan;
}

export interface IntegerLiteralToken extends TokenBase {
  readonly kind: typeof TokenKind.IntegerLiteral;
  readonly value: number;
}

export interface FloatLiteralToken extends TokenBase {
  readonly kind: typeof TokenKind.FloatLiteral;
  readonly value: number;
}

export interface StringLiteralToken extends TokenBase {
  readonly kind: typeof TokenKind.StringLiteral;
  readonly value: string;
}

export interface IdentifierToken extends TokenBase {
  readonly kind: typeof TokenKind.Identifier;
  readonly name: string;
}

export type KeywordToken = TokenBase & {
  readonly kind: Exclude<
    TokenKind,
    | typeof TokenKind.IntegerLiteral
    | typeof TokenKind.FloatLiteral
    | typeof TokenKind.StringLiteral
    | typeof TokenKind.Identifier
    | typeof TokenKind.EOF
  >;
};

export type PunctuationToken = TokenBase & {
  readonly kind: Extract<
    TokenKind,
    | typeof TokenKind.Plus
    | typeof TokenKind.Minus
    | typeof TokenKind.Star
    | typeof TokenKind.Slash
    | typeof TokenKind.Percent
    | typeof TokenKind.Less
    | typeof TokenKind.LessEqual
    | typeof TokenKind.Greater
    | typeof TokenKind.GreaterEqual
    | typeof TokenKind.StrictEqual
    | typeof TokenKind.StrictNotEqual
    | typeof TokenKind.AmpAmp
    | typeof TokenKind.BarBar
    | typeof TokenKind.Bang
    | typeof TokenKind.Assign
    | typeof TokenKind.Transfer
    | typeof TokenKind.At
    | typeof TokenKind.Colon
    | typeof TokenKind.Semicolon
    | typeof TokenKind.Comma
    | typeof TokenKind.Dot
    | typeof TokenKind.LParen
    | typeof TokenKind.RParen
    | typeof TokenKind.LBrace
    | typeof TokenKind.RBrace
    | typeof TokenKind.LBracket
    | typeof TokenKind.RBracket
  >;
};

export interface EOFToken extends TokenBase {
  readonly kind: typeof TokenKind.EOF;
}

export type Token =
  | IntegerLiteralToken
  | FloatLiteralToken
  | StringLiteralToken
  | IdentifierToken
  | KeywordToken
  | PunctuationToken
  | EOFToken;

export function isKeywordToken(token: Token): token is KeywordToken {
  return (
    token.kind !== TokenKind.IntegerLiteral &&
    token.kind !== TokenKind.FloatLiteral &&
    token.kind !== TokenKind.StringLiteral &&
    token.kind !== TokenKind.Identifier &&
    token.kind !== TokenKind.EOF
  );
}

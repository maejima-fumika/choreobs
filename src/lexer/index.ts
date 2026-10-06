export type { Position, SourceSpan } from "./position.js";
export { positionAt } from "./position.js";

export type { LexicalError } from "./errors.js";
export { lexicalError } from "./errors.js";

export {
  TokenKind,
  isKeywordToken,
  type Token,
  type TokenKind as TokenKindType,
  type IntegerLiteralToken,
  type FloatLiteralToken,
  type StringLiteralToken,
  type IdentifierToken,
  type KeywordToken,
  type PunctuationToken,
  type EOFToken,
} from "./tokens.js";

export { KEYWORDS, tokenize, isIdentifierName, type TokenizeResult } from "./lexer.js";

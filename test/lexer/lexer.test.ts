import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TokenKind, tokenize } from "../../src/lexer/index.js";

function kinds(source: string): string[] {
  return tokenize(source).tokens.map((t) => t.kind);
}

function lexemes(source: string): string[] {
  return tokenize(source).tokens.map((t) => t.lexeme);
}

describe("ChoreoBS lexer", () => {
  it("tokenizes a minimal communication snippet", () => {
    const source = `let x: integer@alice = 1@alice;
let y: integer@bob <- x;`;
    const { tokens, errors } = tokenize(source);
    assert.equal(errors.length, 0);
    assert.ok(tokens.some((t) => t.kind === TokenKind.Transfer && t.lexeme === "<-"));
    assert.ok(tokens.some((t) => t.kind === TokenKind.At));
    assert.equal(tokens.at(-1)?.kind, TokenKind.EOF);
  });

  it("distinguishes `<-` from `<` followed by unary minus (spec §operators-and-punctuation)", () => {
    // Maximal munch on the raw character stream, as in Go: the character
    // immediately after `<` decides, so whitespace disambiguates.
    assert.deepEqual(
      kinds("a<-b").slice(0, 3),
      [TokenKind.Identifier, TokenKind.Transfer, TokenKind.Identifier],
    );
    assert.deepEqual(
      kinds("a < -b").slice(0, 4),
      [
        TokenKind.Identifier,
        TokenKind.Less,
        TokenKind.Minus,
        TokenKind.Identifier,
      ],
    );
    assert.deepEqual(lexemes("a <- b").slice(0, 3), ["a", "<-", "b"]);
    assert.deepEqual(lexemes("a <= -1").slice(0, 4), ["a", "<=", "-", "1"]);
  });

  it("assigns 1-based line/column spans", () => {
    const { tokens } = tokenize("let\nx");
    const letTok = tokens[0]!;
    assert.equal(letTok.span.start.line, 1);
    assert.equal(letTok.span.start.column, 1);
    const xTok = tokens[1]!;
    assert.equal(xTok.span.start.line, 2);
    assert.equal(xTok.span.start.column, 1);
  });

  it("skips line and block comments", () => {
    const source = `// comment
let x /* inner */ : integer = 1;`;
    const result = kinds(source);
    assert.deepEqual(
      result.filter((k) => k !== TokenKind.EOF),
      [
        TokenKind.Let,
        TokenKind.Identifier,
        TokenKind.Colon,
        TokenKind.Integer,
        TokenKind.Assign,
        TokenKind.IntegerLiteral,
        TokenKind.Semicolon,
      ],
    );
  });

  it("distinguishes float and integer literals", () => {
    const { tokens } = tokenize("1 1.0 .5");
    const nums = tokens.filter(
      (t) =>
        t.kind === TokenKind.IntegerLiteral ||
        t.kind === TokenKind.FloatLiteral,
    );
    assert.equal(nums.length, 3);
    assert.equal(nums[0]?.kind, TokenKind.IntegerLiteral);
    assert.equal(nums[1]?.kind, TokenKind.FloatLiteral);
    assert.equal(nums[2]?.kind, TokenKind.IntegerLiteral);
    assert.equal(nums[2]?.lexeme, "5");
    assert.equal(tokens.find((t) => t.lexeme === ".")?.kind, TokenKind.Dot);
  });

  it("recognizes strict equality operators", () => {
    assert.deepEqual(lexemes("a===b!==c"), ["a", "===", "b", "!==", "c", ""]);
  });

  it("errors on == and !=", () => {
    const eq = tokenize("a==b");
    assert.equal(eq.errors.length, 1);
    assert.match(eq.errors[0]!.message, /===/);

    const ne = tokenize("a!=b");
    assert.equal(ne.errors.length, 1);
    assert.match(ne.errors[0]!.message, /!==/);
  });

  it("maps reserved words to keyword tokens", () => {
    const { tokens } = tokenize("function let every true");
    assert.equal(tokens[0]?.kind, TokenKind.Function);
    assert.equal(tokens[1]?.kind, TokenKind.Let);
    assert.equal(tokens[2]?.kind, TokenKind.Every);
    assert.equal(tokens[3]?.kind, TokenKind.True);
  });

  it("maps unsupported v0 words to keyword tokens", () => {
    assert.equal(tokenize("break").tokens[0]?.kind, TokenKind.Break);
    assert.equal(tokenize("async").tokens[0]?.kind, TokenKind.Async);
  });

  it("decodes string literals", () => {
    const { tokens } = tokenize('"a\\nb"');
    const str = tokens[0];
    assert.equal(str?.kind, TokenKind.StringLiteral);
    if (str?.kind === TokenKind.StringLiteral) {
      assert.equal(str.value, "a\nb");
    }
  });
});

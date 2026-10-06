import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { KEYWORDS, tokenize } from "../../src/lexer/index.js";
import { parse } from "../../src/parser/index.js";
import { PRINT_FUNCTION } from "../../src/runtime/names.js";

// The VS Code grammar (editors/vscode) restates part of the lexical
// specification as regular expressions. These tests hold it to the lexer and
// parser, so a change to either fails here rather than leaving the editor to
// highlight a language that no longer exists. How the grammar scopes real
// programs is tested in editors/vscode itself (`npm test` there).

const GRAMMAR_PATH = join(
  import.meta.dirname, "..", "..", "editors", "vscode", "syntaxes", "choreobs.tmLanguage.json",
);

interface Rule {
  readonly name?: string;
  readonly match?: string;
  readonly patterns?: readonly Rule[];
}

const grammar = JSON.parse(readFileSync(GRAMMAR_PATH, "utf8")) as {
  readonly repository: Readonly<Record<string, Rule>>;
};

function rule(key: string): Rule {
  const found = grammar.repository[key];
  assert.ok(found !== undefined, `the grammar has no repository rule '${key}'`);
  return found;
}

/** The words of a `\b(?:a|b)\b` or `\bword\b` pattern. */
function wordsOf(match: string | undefined): string[] {
  const found = /^\\b(?:\(\?:)?([A-Za-z_|]+)\)?\\b$/.exec(match ?? "");
  assert.ok(found !== null, `not a word-list pattern: ${match}`);
  return found[1]!.split("|");
}

const supported = rule("keywords").patterns!.flatMap((r) => wordsOf(r.match));
const unsupported = wordsOf(rule("reserved-keywords").match);

/** Whether the grammar marks `text`, written on its own, as invalid. */
function grammarRejects(text: string): boolean {
  const invalidRules = [
    rule("invalid-characters"),
    ...rule("operators").patterns!.filter((r) => r.name?.startsWith("invalid.")),
  ];
  return invalidRules.some((r) => new RegExp(`^(?:${r.match})$`).test(text));
}

describe("VS Code grammar (editors/vscode)", () => {
  it("highlights exactly the lexer's reserved words, each once (spec §keywords)", () => {
    const highlighted = [...supported, ...unsupported];
    assert.equal(new Set(highlighted).size, highlighted.length, "a word is listed twice");
    assert.deepEqual([...highlighted].sort(), Object.keys(KEYWORDS).sort());
  });

  it("marks as invalid exactly the keywords the parser reports as unsupported", () => {
    for (const word of Object.keys(KEYWORDS)) {
      const { errors } = parse(`${word};`);
      const reported = errors.some((e) => e.message.includes("is not supported in ChoreoBS v1"));
      assert.equal(unsupported.includes(word), reported, `'${word}'`);
    }
  });

  it("highlights the reserved print function (spec §print-typing)", () => {
    assert.deepEqual(wordsOf(rule("builtins").match), [PRINT_FUNCTION]);
  });

  it("marks as invalid exactly the characters the lexer rejects (spec §lexical-specification)", () => {
    const characters = ["\t", ...Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i))];
    for (const ch of characters) {
      // A lone `"` is an unterminated string: the grammar scopes it as a
      // string up to the end of the line rather than as an invalid character.
      if (ch === '"') continue;
      const lexerRejects = tokenize(ch).errors.length > 0;
      assert.equal(grammarRejects(ch), lexerRejects, `character ${JSON.stringify(ch)}`);
    }
  });

  it("marks `==` and `!=` as invalid, as the lexer does (spec §operators-and-punctuation)", () => {
    for (const op of ["==", "!="]) {
      assert.ok(tokenize(`a ${op} b`).errors.length > 0, `the lexer accepts ${op}`);
      assert.ok(grammarRejects(op), `the grammar accepts ${op}`);
    }
  });
});

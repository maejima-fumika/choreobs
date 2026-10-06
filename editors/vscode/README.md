# ChoreoBS for VS Code

Syntax highlighting for ChoreoBS source files (`.cbs`). It is a TextMate
grammar and a language configuration only: there is no language server, so it
does not type-check or report compile errors.

## Install

From this directory:

```bash
npm install
npm run package
code --install-extension choreobs-vscode-0.1.0.vsix
```

`npm run package` writes `choreobs-vscode-<version>.vsix`, which is not
committed. Reload VS Code after installing.

## What is highlighted

| Syntax | Scope |
|---|---|
| `@alice` (an endpoint name) | `constant.language.location.choreobs variable.other.constant.location.choreobs` |
| `@every`, `@dyn` | `constant.language.location.every.choreobs`, `…dyn.choreobs` |
| `<-` (transfer) | `keyword.control.transfer.choreobs` |
| `integer`, `float`, `boolean`, `string`, `void` | `support.type.primitive.choreobs` |
| `print`, `.push`, `.length` | `support.function.builtin.choreobs`, `support.function.array.choreobs`, `support.variable.property.array.choreobs` |

Whatever the lexer or parser always rejects is scoped `invalid.illegal.*`: the
keywords reserved but unsupported in v1 (`break`, `const`, `class`, …), `==`
and `!=`, a lone `&` or `|`, an unknown string escape, and any character the
lexer does not accept (spec §keywords, §operators-and-punctuation,
§lexical-specification).

An endpoint name carries two scopes because themes differ in what they color.
Dark+, Light+, One Dark, GitHub and Dracula color it apart from variables and
from `@every`; Monokai leaves it in the default foreground. To pick the color
yourself, add to your settings:

```json
"editor.tokenColorCustomizations": {
  "textMateRules": [
    { "scope": "variable.other.constant.location.choreobs", "settings": { "foreground": "#4FC1FF" } }
  ]
}
```

## Tests

Two sets of tests keep the grammar honest:

* `npm test` here runs the scope assertions in `test/*.test.cbs`
  ([vscode-tmgrammar-test](https://github.com/PanAeon/vscode-tmgrammar-test)), then
  tokenizes every `.cbs` program in `examples/` and `benchmarks/` and fails if
  any token is scoped `invalid.*` or a file ends inside a string or comment.
* `npm test` at the repository root includes `test/editors/vscode-grammar.test.ts`,
  which needs nothing installed here. It checks the grammar's keyword lists
  against the lexer's `KEYWORDS`, its unsupported keywords against the parser,
  its invalid characters against the lexer, and `print` against the runtime
  name. A change to the lexical specification fails there first.

When you change the lexer, update `syntaxes/choreobs.tmLanguage.json` until both
pass.

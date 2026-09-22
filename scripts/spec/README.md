# spec.md tooling

A section's identity is its **slug**, written into the heading line as an
anchor. Its **number** is where it happens to sit today, and is derived.

```markdown
### 7.8 Transfer Typing <a id="transfer-typing"></a>
```

Cite a section by slug and a renumber cannot reach the citation.

| where | how a reference is written |
|---|---|
| spec.md prose | `[§7.8](#transfer-typing)` — the text is filled in by `spec:fmt` |
| spec.md code fences | `§transfer-typing` — a link would not render there |
| TypeScript comments and test names | `§transfer-typing` |
| a diagnostic | `spec: ["transfer-typing"]`, printed by the CLI |

## Commands

```bash
npm run spec:sections   # spec.md -> src/spec/sections.ts (committed)
npm run spec:fmt        # renumber headings, refill link text, regenerate
npm run spec:check      # verify spec.md and the repo agree
```

`spec:check` also runs as part of `npm test`, via `test/spec/registry.test.ts`.

## Editing spec.md

- **Adding a section.** Write the heading with any digits in front of the
  title and an anchor, then run `npm run spec:fmt`. It works out the real
  number and updates every link that points at a section after it.
- **Moving or removing one.** Same: run `spec:fmt`. Nothing outside spec.md
  changes, because nothing outside spec.md names a number.
- **Renaming one.** Edit the title and leave the anchor alone. The slug is
  the identity, so no citation breaks.
- **Numbering rule.** `##` and `###` are always numbered. A `####` is numbered
  only if it already is — whether a sub-subsection is worth citing stays the
  author's call. Ordinals count numbered siblings only.

Adding a citation to a section that does not exist fails to compile:
`SpecId` is the union of the slugs that carry a number.

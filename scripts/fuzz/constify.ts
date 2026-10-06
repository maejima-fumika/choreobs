/**
 * Declares with `const` every variable that is never stored into.
 *
 * A `const` is a `let` whose variable is never stored into again
 * (spec §const-statement), so in a program that compiles, writing `const` for
 * such a `let` must change nothing but the keyword of its bindings in the
 * output. It is one of the rewrites in `metamorphic.ts`, which compares the
 * two compilations with {@link constifiedOutputProblem}. A `let` in a `for`
 * header stays, since a header declares with `let` only (spec §for-statement).
 *
 * The rewrite goes by name, not by scope: a name that some assignment or
 * transfer statement stores into keeps every one of its declarations a `let`.
 * That is conservative under shadowing, and it is what lets the comparison
 * look for a rewritten name by its text alone.
 */
import type { AssignmentTarget } from "../../src/ast/statements.js";
import { nestedStatements } from "../../src/ast/traverse.js";
import type { CompileResult } from "../../src/driver/index.js";
import { parse } from "../../src/parser/index.js";
import { outputsKey } from "./inspect.js";

export interface Constified {
  /** `source` with the rewritten declarations; `source` itself if there are none. */
  readonly source: string;
  /** The names whose declarations became `const`. */
  readonly names: ReadonlySet<string>;
}

/** `source` with every statement `let` of a never-stored-into name written as `const`. */
export function constifyLets(source: string): Constified {
  const { program, errors } = parse(source);
  if (program === null) {
    throw new Error(`cannot constify a source that does not parse: ${errors[0]?.message ?? "(no message)"}`);
  }
  const statements = program.items.flatMap((item) =>
    item.kind === "FunctionDeclaration" ? item.body.statements : [item.statement],
  );
  const declarations: { readonly name: string; readonly start: number }[] = [];
  const stored = new Set<string>();
  const store = (target: AssignmentTarget | undefined): void => {
    if (target?.kind === "IdentifierAssignmentTarget") {
      stored.add(target.name);
    }
  };
  for (const stmt of nestedStatements(statements)) {
    switch (stmt.kind) {
      case "LetStatement":
      case "LetTransferStatement":
        if (stmt.keyword === "let") {
          declarations.push({ name: stmt.name, start: stmt.span.start });
        }
        break;
      case "AssignmentStatement":
        store(stmt.target);
        break;
      case "TransferStatement":
        stored.add(stmt.name);
        break;
      case "ForStatement":
        store(stmt.init?.kind === "ForAssignmentInit" ? stmt.init.target : undefined);
        store(stmt.update?.target);
        break;
    }
  }

  const rewritten = declarations
    .filter((d) => !stored.has(d.name))
    .sort((a, b) => b.start - a.start);
  let out = source;
  for (const { start } of rewritten) {
    if (out.slice(start, start + 3) !== "let") {
      throw new Error(`internal error: no 'let' at offset ${start}`);
    }
    out = `${out.slice(0, start)}const${out.slice(start + 3)}`;
  }
  return { source: out, names: new Set(rewritten.map((d) => d.name)) };
}

/** A binding as the emitter writes it, at the start of a line. */
const CONST_BINDING = /^([ \t]*)const /gm;

/** `result` with every `const` binding of its endpoint programs read back as `let`. */
function readBack(result: CompileResult): CompileResult {
  return {
    ...result,
    outputs: result.outputs.map((o) => ({ ...o, source: o.source.replace(CONST_BINDING, "$1let ") })),
  };
}

/**
 * How the outputs of `original`, a program's compilation, and `constified`,
 * the successful compilation of {@link constifyLets} of it, differ beyond the
 * keyword of the rewritten bindings; `undefined` when they do not.
 *
 * Read back as `let`, the `const` bindings of both must give the same output
 * (the original may have some of its own), and no binding of a rewritten name
 * may still be a `let` — the read-back alone would hide a `const` the compiler
 * dropped. An endpoint program starts a line with `const` only for a binding
 * (spec §let-projection); the runtime's own constants are in the runtime files,
 * compared as they are.
 */
export function constifiedOutputProblem(
  original: CompileResult,
  constified: CompileResult,
  names: ReadonlySet<string>,
): string | undefined {
  if (outputsKey(readBack(constified)) !== outputsKey(readBack(original))) {
    return "changed the output";
  }
  for (const output of constified.outputs) {
    for (const name of names) {
      if (new RegExp(`^[ \\t]*let ${name}:`, "m").test(output.source)) {
        return `left '${name}' a let in the output for ${output.endpoint}`;
      }
    }
  }
  return undefined;
}

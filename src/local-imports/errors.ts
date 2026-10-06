import type { Span } from "../ast/span.js";
import type { SpecCited } from "../spec/ref.js";

/**
 * A problem with a BlueScript source file or with an import of one
 * (spec §bluescript-source-files, §import-declarations, §imported-signatures).
 *
 * A problem with a file's name has no span: it is not in `src/index.cbs`. A
 * problem with what a file holds is reported at the import that names it, and
 * names the file, line and column in the message.
 */
export interface ImportDiagnostic extends SpecCited {
  readonly message: string;
  readonly span?: Span;
}

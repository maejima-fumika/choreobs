/**
 * Whether a rejection is the one a violation was injected to provoke.
 *
 * Shared by `test/integration/violations.test.ts` and `violate.ts` so the
 * fixed corpus and the wider search cannot drift apart.
 *
 * Citation *or* prose, not both. Several of the diagnostics that catch these
 * violations cite nothing yet — the strict-location rule among them — and
 * their `expect` prose is all there is to match on. A violation whose
 * diagnostic does cite its section carries an empty `expect` and is matched by
 * the citation alone.
 */
import type { SpecCited } from "../../src/spec/ref.js";
import type { ViolationInfo } from "./generator.js";

type Diagnostic = SpecCited & { readonly message: string };

export function rejectedFor(
  violation: ViolationInfo,
  errors: readonly Diagnostic[],
): boolean {
  return errors.some(
    (e) =>
      e.spec.includes(violation.spec) ||
      violation.expect.some((want) => e.message.includes(want)),
  );
}

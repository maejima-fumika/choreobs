import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDiagnostic, buildLineStarts } from "../../src/cli/format.js";
import { specNumber } from "../../src/spec/ref.js";

describe("CLI diagnostic formatting", () => {
  const lineStarts = buildLineStarts("let x: integer@alice = 1@alice;\nlet y = !x;\n");

  it("prints the message and its location", () => {
    assert.equal(
      formatDiagnostic({ message: "boom", span: { start: 4, end: 5 }, spec: [] }, lineStarts),
      "boom [line 1:5-1:5] [4, 5)",
    );
  });

  it("prints one line per cited section, numbered from the registry", () => {
    const out = formatDiagnostic(
      {
        message: "operator '!' requires a boolean operand",
        span: { start: 39, end: 41 },
        spec: ["operators", "invalid-unary-operand"],
      },
      lineStarts,
    );
    // Built from the registry rather than written out: pinning the numbers
    // here would put back exactly the coupling this removes.
    assert.deepEqual(out.split("\n"), [
      "operator '!' requires a boolean operand [line 2:8-2:9] [39, 41)",
      `    spec ${specNumber("operators")} Operators`,
      `    spec ${specNumber("invalid-unary-operand")} Invalid Unary Operand`,
    ]);
  });

  it("prints nothing extra for a diagnostic that cites no section", () => {
    assert.equal(formatDiagnostic({ message: "config unreadable", spec: [] }), "config unreadable");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isRecursiveComponent,
  stronglyConnectedComponents,
} from "../../src/check/recursion.js";
import { compileSource } from "../../src/driver/index.js";

describe("function call graph SCC (spec §inference-and-recursion)", () => {
  it("detects direct self-recursion", () => {
    const graph = new Map<string, readonly string[]>([
      ["f", ["f"]],
    ]);
    const successors = (n: string) => graph.get(n) ?? [];
    const components = stronglyConnectedComponents(["f"], successors);
    assert.equal(components.length, 1);
    assert.equal(isRecursiveComponent(components[0]!, successors), true);
  });

  it("detects indirect two-function recursion", () => {
    const graph = new Map<string, readonly string[]>([
      ["f", ["g"]],
      ["g", ["f"]],
    ]);
    const successors = (n: string) => graph.get(n) ?? [];
    const components = stronglyConnectedComponents(["f", "g"], successors);
    assert.equal(components.length, 1);
    assert.equal(components[0]!.length, 2);
    assert.equal(isRecursiveComponent(components[0]!, successors), true);
  });

  it("does not mark acyclic functions as recursive", () => {
    const graph = new Map<string, readonly string[]>([
      ["a", ["b"]],
      ["b", []],
    ]);
    const successors = (n: string) => graph.get(n) ?? [];
    const components = stronglyConnectedComponents(["a", "b"], successors);
    assert.equal(components.length, 2);
    assert.ok(components.every((c) => !isRecursiveComponent(c, successors)));
  });
});

describe("recursion detection sees calls in every expression position", () => {
  // `collectCalleeNames` builds the call graph these rules run on. It used to
  // skip an `if` condition and an index-assignment target, so a recursive call
  // hiding in either escaped §recursion and §inference-and-recursion entirely.
  function expectRejected(source: string, messageIncludes: string): void {
    const result = compileSource(source, "index.cbs", {
      endpoints: ["alice", "bob"],
    });
    assert.equal(
      result.success,
      false,
      `expected rejection, but the program compiled:\n${source}`,
    );
    assert.ok(
      result.errors.some((e) => e.message.includes(messageIncludes)),
      JSON.stringify(result.errors),
    );
  }

  it("rejects a recursive choreography function called from an if condition (§recursion)", () => {
    expectRejected(
      `
function g(): boolean@every {
    if (g()) {
        return true@every;
    }
    return false@every;
}
`,
      "cannot be recursive",
    );
  });

  it("rejects mutual recursion through if conditions (§recursion)", () => {
    expectRejected(
      `
function a(): boolean@every {
    if (b()) {
        return true@every;
    }
    return false@every;
}
function b(): boolean@every {
    if (a()) {
        return true@every;
    }
    return false@every;
}
`,
      "cannot be recursive",
    );
  });

  it("rejects a recursive call in an index assignment target (§recursion)", () => {
    expectRejected(
      `
function g(): integer@every {
    let xs: integer[]@every = [1, 2]@every;
    xs[g()] = 1@every;
    return 0@every;
}
`,
      "cannot be recursive",
    );
  });

  it("rejects a recursive local function with an omitted return type called from an if condition (§inference-and-recursion)", () => {
    expectRejected(
      `
function f@alice(n: integer@alice) {
    if (f(n) < 1@alice) {
        return 1@alice;
    }
    return 2@alice;
}
`,
      "omitted return type cannot be recursive",
    );
  });
});

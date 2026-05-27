import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isRecursiveComponent,
  stronglyConnectedComponents,
} from "../../src/check/recursion.js";

describe("function call graph SCC (spec §7.14.8)", () => {
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

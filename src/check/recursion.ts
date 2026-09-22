/**
 * Call-graph helpers for recursive function detection (spec §inference-and-recursion).
 */

/** Tarjan's algorithm — returns strongly connected components. */
export function stronglyConnectedComponents(
  nodes: readonly string[],
  successors: (node: string) => readonly string[],
): string[][] {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const components: string[][] = [];

  const strongConnect = (v: string): void => {
    indices.set(v, index);
    lowlink.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);

    for (const w of successors(v)) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      components.push(component);
    }
  };

  for (const node of nodes) {
    if (!indices.has(node)) {
      strongConnect(node);
    }
  }

  return components;
}

/** True when the component contains a call cycle (direct or indirect). */
export function isRecursiveComponent(
  component: readonly string[],
  successors: (node: string) => readonly string[],
): boolean {
  if (component.length > 1) {
    return true;
  }
  const only = component[0];
  if (only === undefined) {
    return false;
  }
  return successors(only).includes(only);
}

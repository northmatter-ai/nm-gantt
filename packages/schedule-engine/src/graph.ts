/** Graph helpers: Tarjan's SCC for cycles and Kahn's algorithm with a min-heap on id. */

export class MinHeap {
  private readonly a: string[] = [];
  get size() { return this.a.length; }
  push(v: string): void {
    const a = this.a;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]! <= a[i]!) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): string | undefined {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l]! < a[m]!) m = l;
        if (r < a.length && a[r]! < a[m]!) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

/** Strongly connected components with more than one node (iterative Tarjan). Nodes visited in sorted order. */
export function findCycles(nodes: string[], succ: (id: string) => string[]): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];

  for (const root of nodes) {
    if (idx.has(root)) continue;
    const work: { v: string; i: number; next: string[] }[] = [];
    const open = (v: string) => {
      idx.set(v, index); low.set(v, index); index++;
      stack.push(v); onStack.add(v);
      work.push({ v, i: 0, next: succ(v) });
    };
    open(root);
    while (work.length > 0) {
      const top = work[work.length - 1]!;
      if (top.i < top.next.length) {
        const w = top.next[top.i++]!;
        if (!idx.has(w)) open(w);
        else if (onStack.has(w)) low.set(top.v, Math.min(low.get(top.v)!, idx.get(w)!));
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1]!.v;
        low.set(parent, Math.min(low.get(parent)!, low.get(top.v)!));
      }
      if (low.get(top.v) === idx.get(top.v)) {
        const comp: string[] = [];
        let w: string;
        do { w = stack.pop()!; onStack.delete(w); comp.push(w); } while (w !== top.v);
        if (comp.length > 1) out.push(comp);
      }
    }
  }
  return out;
}

/** One concrete cycle inside an SCC, starting from its smallest id, in link order. */
export function cycleOrder(component: string[], succ: (id: string) => string[]): string[] {
  const inComp = new Set(component);
  const start = [...component].sort()[0]!;
  // BFS from start's successors back to start, within the component.
  const prev = new Map<string, string>();
  const queue: string[] = [];
  for (const n of succ(start)) if (inComp.has(n) && !prev.has(n)) { prev.set(n, start); queue.push(n); }
  while (queue.length > 0) {
    const v = queue.shift()!;
    if (v === start) break;
    for (const n of succ(v)) {
      if (inComp.has(n) && !prev.has(n)) { prev.set(n, v); queue.push(n); }
    }
  }
  const path: string[] = [];
  let cur = prev.get(start);
  while (cur !== undefined && cur !== start) { path.push(cur); cur = prev.get(cur); }
  return [start, ...path.reverse()];
}

/** Topological order with ties broken by smallest id. Assumes no cycles. */
export function topoOrder(nodes: string[], succ: (id: string) => string[], indegree: (id: string) => number): string[] {
  const deg = new Map<string, number>();
  const heap = new MinHeap();
  for (const n of nodes) {
    const d = indegree(n);
    deg.set(n, d);
    if (d === 0) heap.push(n);
  }
  const order: string[] = [];
  for (let v = heap.pop(); v !== undefined; v = heap.pop()) {
    order.push(v);
    for (const w of succ(v)) {
      const d = deg.get(w)! - 1;
      deg.set(w, d);
      if (d === 0) heap.push(w);
    }
  }
  return order;
}

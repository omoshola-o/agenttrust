import type { ATFEntry } from "../ledger/entry.js";

export interface TimelineEntry {
  entry: ATFEntry;
  depth: number;
  children: string[];
}

export function buildTimeline(entries: readonly ATFEntry[]): TimelineEntry[] {
  const sorted = [...entries].sort((a, b) => a.ts.localeCompare(b.ts));

  const childrenMap = new Map<string, string[]>();
  const parentMap = new Map<string, string>();

  for (const entry of sorted) {
    if (entry.context.parentAction) {
      parentMap.set(entry.id, entry.context.parentAction);
      const siblings = childrenMap.get(entry.context.parentAction) ?? [];
      siblings.push(entry.id);
      childrenMap.set(entry.context.parentAction, siblings);
    }
  }

  function getDepth(id: string): number {
    let depth = 0;
    let current = id;
    while (parentMap.has(current)) {
      depth++;
      current = parentMap.get(current)!;
    }
    return depth;
  }

  return sorted.map((entry) => ({
    entry,
    depth: getDepth(entry.id),
    children: childrenMap.get(entry.id) ?? [],
  }));
}

export function findActionChain(entries: readonly ATFEntry[], startId: string): ATFEntry[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const result: ATFEntry[] = [];
  const visited = new Set<string>();
  const queue = [startId];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const entry = byId.get(id);
    if (entry) {
      result.push(entry);
      for (const other of entries) {
        if (other.context.parentAction === id) {
          queue.push(other.id);
        }
      }
    }
  }

  return result.sort((a, b) => a.ts.localeCompare(b.ts));
}

import { describe, it, expect } from "vitest";
import { buildTimeline, findActionChain } from "../../src/query/timeline.js";
import { createEntry } from "../../src/ledger/entry.js";
import type { CreateEntryInput } from "../../src/ledger/entry.js";

function makeInput(overrides: Partial<CreateEntryInput> = {}): CreateEntryInput {
  return {
    agent: "default",
    session: "ses_test",
    action: { type: "file.read", target: "/tmp/test", detail: "test" },
    context: { goal: "test", trigger: "manual" },
    outcome: { status: "success" },
    risk: { score: 1, labels: [], autoFlagged: false },
    ...overrides,
  };
}

describe("buildTimeline", () => {
  it("returns empty array for no entries", () => {
    expect(buildTimeline([])).toEqual([]);
  });

  it("sets depth 0 for root actions", () => {
    const entry = createEntry(makeInput(), "");
    const timeline = buildTimeline([entry]);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]!.depth).toBe(0);
    expect(timeline[0]!.children).toEqual([]);
  });

  it("computes depth for chained actions", () => {
    const root = createEntry(makeInput(), "");
    const child = createEntry(
      makeInput({ context: { goal: "child", trigger: "chain", parentAction: root.id } }),
      root.hash,
    );
    const grandchild = createEntry(
      makeInput({ context: { goal: "grandchild", trigger: "chain", parentAction: child.id } }),
      child.hash,
    );

    const timeline = buildTimeline([root, child, grandchild]);
    expect(timeline[0]!.depth).toBe(0);
    expect(timeline[1]!.depth).toBe(1);
    expect(timeline[2]!.depth).toBe(2);
  });

  it("tracks children IDs", () => {
    const root = createEntry(makeInput(), "");
    const child = createEntry(
      makeInput({ context: { goal: "child", trigger: "chain", parentAction: root.id } }),
      root.hash,
    );

    const timeline = buildTimeline([root, child]);
    expect(timeline[0]!.children).toContain(child.id);
  });
});

describe("findActionChain", () => {
  it("returns single entry for no children", () => {
    const entry = createEntry(makeInput(), "");
    const chain = findActionChain([entry], entry.id);
    expect(chain).toHaveLength(1);
    expect(chain[0]!.id).toBe(entry.id);
  });

  it("returns full chain from root", () => {
    const root = createEntry(makeInput(), "");
    const child = createEntry(
      makeInput({ context: { goal: "child", trigger: "chain", parentAction: root.id } }),
      root.hash,
    );
    const unrelated = createEntry(makeInput(), child.hash);

    const chain = findActionChain([root, child, unrelated], root.id);
    expect(chain).toHaveLength(2);
    expect(chain.map((e) => e.id)).toContain(root.id);
    expect(chain.map((e) => e.id)).toContain(child.id);
    expect(chain.map((e) => e.id)).not.toContain(unrelated.id);
  });

  it("returns empty array for unknown ID", () => {
    const entry = createEntry(makeInput(), "");
    const chain = findActionChain([entry], "nonexistent");
    expect(chain).toHaveLength(0);
  });
});

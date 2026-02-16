import { describe, it, expect } from "vitest";
import { highActionRate } from "../../../src/analyzer/rules/frequency.js";
import { DEFAULT_CONFIG } from "../../../src/analyzer/types.js";
import type { ATFEntry } from "../../../src/ledger/entry.js";
import type { RuleContext } from "../../../src/analyzer/types.js";

function makeEntry(overrides: Partial<ATFEntry> = {}): ATFEntry {
  return {
    id: "01TESTENTRY000000000000001",
    v: 1,
    ts: "2026-02-15T18:00:00.000Z",
    prevHash: "",
    hash: "testhash",
    agent: "default",
    session: "ses_test",
    action: {
      type: "file.read" as ATFEntry["action"]["type"],
      target: "/home/user/test.txt",
      detail: "Read test file",
    },
    context: {
      goal: "Test goal",
      trigger: "test",
    },
    outcome: {
      status: "success",
    },
    risk: {
      score: 0,
      labels: [],
      autoFlagged: false,
    },
    ...overrides,
  };
}

function makeContext(overrides: Partial<RuleContext> = {}): RuleContext {
  return {
    sessionHistory: [],
    recentEntries: [],
    knownTargets: new Set<string>(),
    config: DEFAULT_CONFIG,
    ...overrides,
  };
}

/**
 * Creates N entries within a 1-minute window ending at the given timestamp.
 * All entries are spaced ~1 second apart within that window.
 */
function makeRecentEntries(count: number, endTs: string): ATFEntry[] {
  const endTime = new Date(endTs).getTime();
  const entries: ATFEntry[] = [];
  for (let i = 0; i < count; i++) {
    // Space entries 1 second apart, all within the last minute
    const ts = new Date(endTime - (count - 1 - i) * 1000).toISOString();
    entries.push(
      makeEntry({
        id: `01TESTENTRY00000000000${String(i).padStart(4, "0")}`,
        ts,
        action: {
          type: "file.read" as ATFEntry["action"]["type"],
          target: `/home/user/file${i}.txt`,
          detail: `Read file ${i}`,
        },
      }),
    );
  }
  return entries;
}

describe("highActionRate (freq-001)", () => {
  it("returns null when recent action count is below maxActionsPerMinute", () => {
    const entry = makeEntry();
    const recentEntries = makeRecentEntries(10, entry.ts);
    const ctx = makeContext({ recentEntries });
    expect(highActionRate.evaluate(entry, ctx)).toBeNull();
  });

  it("returns null when recent action count equals maxActionsPerMinute", () => {
    const entry = makeEntry();
    const recentEntries = makeRecentEntries(30, entry.ts);
    const ctx = makeContext({ recentEntries });
    expect(highActionRate.evaluate(entry, ctx)).toBeNull();
  });

  it("triggers when recent action count exceeds maxActionsPerMinute", () => {
    const entry = makeEntry();
    const recentEntries = makeRecentEntries(31, entry.ts);
    const ctx = makeContext({ recentEntries });
    const result = highActionRate.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("freq-001");
    expect(result!.severity).toBe("medium");
    expect(result!.riskContribution).toBe(6);
    expect(result!.labels).toEqual(["high_frequency"]);
  });

  it("respects custom maxActionsPerMinute from config", () => {
    const entry = makeEntry();
    // With a threshold of 10, 11 entries should trigger
    const recentEntries = makeRecentEntries(11, entry.ts);
    const ctx = makeContext({
      recentEntries,
      config: { ...DEFAULT_CONFIG, maxActionsPerMinute: 10 },
    });
    const result = highActionRate.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("freq-001");
  });

  it("does not trigger with custom high threshold", () => {
    const entry = makeEntry();
    const recentEntries = makeRecentEntries(31, entry.ts);
    const ctx = makeContext({
      recentEntries,
      config: { ...DEFAULT_CONFIG, maxActionsPerMinute: 50 },
    });
    expect(highActionRate.evaluate(entry, ctx)).toBeNull();
  });

  it("returns correct action count in evidence", () => {
    const entry = makeEntry();
    const recentEntries = makeRecentEntries(35, entry.ts);
    const ctx = makeContext({ recentEntries });
    const result = highActionRate.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.evidence).toBeDefined();
    expect(result!.evidence!["actionCount"]).toBe(35);
    expect(result!.evidence!["threshold"]).toBe(30);
  });

  it("includes threshold in evidence", () => {
    const entry = makeEntry();
    const recentEntries = makeRecentEntries(16, entry.ts);
    const ctx = makeContext({
      recentEntries,
      config: { ...DEFAULT_CONFIG, maxActionsPerMinute: 15 },
    });
    const result = highActionRate.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.evidence!["threshold"]).toBe(15);
  });

  it("does not count entries outside the 1-minute window", () => {
    const entry = makeEntry({ ts: "2026-02-15T18:02:00.000Z" });
    // Create entries spread over 2 minutes (only ~half within the last minute)
    const recentEntries: ATFEntry[] = [];
    const endTime = new Date(entry.ts).getTime();
    for (let i = 0; i < 40; i++) {
      // Spread 40 entries across 120 seconds (3s apart)
      const ts = new Date(endTime - (39 - i) * 3000).toISOString();
      recentEntries.push(
        makeEntry({
          id: `01TESTENTRY00000000000${String(i).padStart(4, "0")}`,
          ts,
        }),
      );
    }
    // ~20 entries should be within the last 60 seconds, which is < 30
    const ctx = makeContext({ recentEntries });
    expect(highActionRate.evaluate(entry, ctx)).toBeNull();
  });

  it("has correct rule metadata", () => {
    expect(highActionRate.id).toBe("freq-001");
    expect(highActionRate.category).toBe("frequency");
    expect(highActionRate.severity).toBe("medium");
    expect(highActionRate.enabledByDefault).toBe(true);
  });
});

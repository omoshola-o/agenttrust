import { describe, it, expect } from "vitest";
import { parseTimeRange, applyFilters } from "../../src/query/filters.js";
import { createEntry } from "../../src/ledger/entry.js";
import type { ATFEntry, CreateEntryInput } from "../../src/ledger/entry.js";

function makeEntry(overrides: Partial<CreateEntryInput> = {}, prevHash = ""): ATFEntry {
  const defaults: CreateEntryInput = {
    agent: "default",
    session: "ses_test",
    action: { type: "file.read", target: "/tmp/test", detail: "test" },
    context: { goal: "test", trigger: "manual" },
    outcome: { status: "success" },
    risk: { score: 1, labels: [], autoFlagged: false },
    ...overrides,
  };
  return createEntry(defaults, prevHash);
}

describe("parseTimeRange", () => {
  it("parses hours", () => {
    const range = parseTimeRange("24h");
    expect(range).not.toBeNull();
    expect(range!.from).toBeInstanceOf(Date);
    expect(range!.to).toBeInstanceOf(Date);
    const diff = range!.to!.getTime() - range!.from!.getTime();
    expect(diff).toBeCloseTo(24 * 60 * 60 * 1000, -3);
  });

  it("parses days", () => {
    const range = parseTimeRange("7d");
    expect(range).not.toBeNull();
    const diff = range!.to!.getTime() - range!.from!.getTime();
    expect(diff).toBeCloseTo(7 * 24 * 60 * 60 * 1000, -3);
  });

  it("parses weeks", () => {
    const range = parseTimeRange("4w");
    expect(range).not.toBeNull();
    const diff = range!.to!.getTime() - range!.from!.getTime();
    expect(diff).toBeCloseTo(28 * 24 * 60 * 60 * 1000, -3);
  });

  it("returns null for invalid input", () => {
    expect(parseTimeRange("invalid")).toBeNull();
    expect(parseTimeRange("")).toBeNull();
    expect(parseTimeRange("24x")).toBeNull();
  });
});

describe("applyFilters", () => {
  it("returns all entries with no filters", () => {
    const entries = [makeEntry(), makeEntry()];
    expect(applyFilters(entries, {})).toHaveLength(2);
  });

  it("filters by action type", () => {
    const entries = [
      makeEntry({ action: { type: "file.read", target: "a", detail: "a" } }),
      makeEntry({ action: { type: "api.call", target: "b", detail: "b" } }),
    ];
    const result = applyFilters(entries, { actionTypes: ["file.read"] });
    expect(result).toHaveLength(1);
    expect(result[0]!.action.type).toBe("file.read");
  });

  it("filters by risk score minimum", () => {
    const entries = [
      makeEntry({ risk: { score: 2, labels: [], autoFlagged: false } }),
      makeEntry({ risk: { score: 8, labels: ["data_access"], autoFlagged: true } }),
    ];
    const result = applyFilters(entries, { riskScoreMin: 5 });
    expect(result).toHaveLength(1);
    expect(result[0]!.risk.score).toBe(8);
  });

  it("filters by agent", () => {
    const entries = [makeEntry({ agent: "alpha" }), makeEntry({ agent: "beta" })];
    const result = applyFilters(entries, { agent: "alpha" });
    expect(result).toHaveLength(1);
    expect(result[0]!.agent).toBe("alpha");
  });

  it("filters by risk labels", () => {
    const entries = [
      makeEntry({ risk: { score: 5, labels: ["financial"], autoFlagged: false } }),
      makeEntry({ risk: { score: 3, labels: ["execution"], autoFlagged: false } }),
    ];
    const result = applyFilters(entries, { riskLabels: ["financial"] });
    expect(result).toHaveLength(1);
    expect(result[0]!.risk.labels).toContain("financial");
  });

  it("combines filters with AND logic", () => {
    const entries = [
      makeEntry({
        agent: "alpha",
        risk: { score: 8, labels: ["financial"], autoFlagged: true },
      }),
      makeEntry({
        agent: "alpha",
        risk: { score: 2, labels: [], autoFlagged: false },
      }),
      makeEntry({
        agent: "beta",
        risk: { score: 9, labels: ["financial"], autoFlagged: true },
      }),
    ];
    const result = applyFilters(entries, { agent: "alpha", riskScoreMin: 5 });
    expect(result).toHaveLength(1);
    expect(result[0]!.agent).toBe("alpha");
    expect(result[0]!.risk.score).toBe(8);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger } from "../../src/ledger/ledger.js";
import { collectDailyData, collectWeeklyData } from "../../src/digest/collector.js";
import { DEFAULT_DIGEST_CONFIG } from "../../src/digest/types.js";
import type { DigestConfig } from "../../src/digest/types.js";
import type { CreateEntryInput } from "../../src/ledger/entry.js";

function makeInput(overrides: Partial<CreateEntryInput> = {}): CreateEntryInput {
  return {
    agent: "default",
    session: "ses_test",
    action: { type: "file.read", target: "/test.txt", detail: "Test" },
    context: { goal: "Test", trigger: "test" },
    outcome: { status: "success" },
    risk: { score: 1, labels: [], autoFlagged: false },
    ...overrides,
  };
}

describe("collectDailyData", () => {
  let testDir: string;
  let ledger: Ledger;
  let config: DigestConfig;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), "agenttrust-collector-test-"));
    ledger = new Ledger({ workspacePath: testDir });
    await ledger.init();
    config = {
      ...DEFAULT_DIGEST_CONFIG,
      outputDir: join(testDir, "digests"),
    };
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns DigestData with correct period for the given date", async () => {
    const date = new Date();
    const data = await collectDailyData(date, ledger, config);

    expect(data.period).toBeDefined();
    expect(data.period.from).toBeDefined();
    expect(data.period.to).toBeDefined();
    expect(data.period.label).toBeDefined();
    // The label should be a YYYY-MM-DD string
    expect(data.period.label).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("counts actions correctly", async () => {
    await ledger.append(makeInput());
    await ledger.append(makeInput({
      action: { type: "exec.command", target: "ls", detail: "List files" },
    }));
    await ledger.append(makeInput({
      action: { type: "file.write", target: "/output.txt", detail: "Write file" },
    }));

    const date = new Date();
    const data = await collectDailyData(date, ledger, config);

    expect(data.activity.totalActions).toBe(3);
    expect(data.activity.byType["file.read"]).toBe(1);
    expect(data.activity.byType["exec.command"]).toBe(1);
    expect(data.activity.byType["file.write"]).toBe(1);
  });

  it("returns empty data when no entries exist for the given date", async () => {
    // Use a date far in the past so no entries match
    const pastDate = new Date("2020-01-01T12:00:00.000Z");
    const data = await collectDailyData(pastDate, ledger, config);

    expect(data.activity.totalActions).toBe(0);
    expect(data.activity.uniqueSessions).toBe(0);
    expect(data.activity.uniqueTargets).toBe(0);
  });

  it("handles a ledger with no entries at all", async () => {
    const date = new Date();
    const data = await collectDailyData(date, ledger, config);

    expect(data.activity.totalActions).toBe(0);
    expect(data.consistency.totalClaims).toBe(0);
    expect(data.consistency.totalExecutions).toBe(0);
  });

  it("correctly counts unique sessions", async () => {
    await ledger.append(makeInput({ session: "ses_a" }));
    await ledger.append(makeInput({ session: "ses_b" }));
    await ledger.append(makeInput({ session: "ses_a" }));

    const date = new Date();
    const data = await collectDailyData(date, ledger, config);

    expect(data.activity.uniqueSessions).toBe(2);
  });

  it("correctly counts unique targets", async () => {
    await ledger.append(makeInput({
      action: { type: "file.read", target: "/a.txt", detail: "Read A" },
    }));
    await ledger.append(makeInput({
      action: { type: "file.read", target: "/b.txt", detail: "Read B" },
    }));
    await ledger.append(makeInput({
      action: { type: "file.read", target: "/a.txt", detail: "Read A again" },
    }));

    const date = new Date();
    const data = await collectDailyData(date, ledger, config);

    expect(data.activity.uniqueTargets).toBe(2);
  });

  it("populates risk level counts", async () => {
    await ledger.append(makeInput({ risk: { score: 1, labels: [], autoFlagged: false } }));
    await ledger.append(makeInput({ risk: { score: 5, labels: [], autoFlagged: false } }));
    await ledger.append(makeInput({ risk: { score: 8, labels: ["data_access"], autoFlagged: true } }));

    const date = new Date();
    const data = await collectDailyData(date, ledger, config);

    expect(data.activity.byRiskLevel.low).toBeGreaterThanOrEqual(1);
    expect(data.activity.totalActions).toBe(3);
  });
});

describe("collectWeeklyData", () => {
  let testDir: string;
  let ledger: Ledger;
  let config: DigestConfig;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), "agenttrust-collector-weekly-test-"));
    ledger = new Ledger({ workspacePath: testDir });
    await ledger.init();
    config = {
      ...DEFAULT_DIGEST_CONFIG,
      outputDir: join(testDir, "digests"),
    };
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns data with a week label", async () => {
    const date = new Date();
    const data = await collectWeeklyData(date, ledger, config);

    expect(data.period).toBeDefined();
    expect(data.period.label).toMatch(/^\d{4}-W\d{2}$/);
  });

  it("aggregates entries across the week", async () => {
    await ledger.append(makeInput());
    await ledger.append(makeInput({
      action: { type: "api.call", target: "https://example.com/api", detail: "API call" },
    }));
    await ledger.append(makeInput({
      action: { type: "message.send", target: "user@example.com", detail: "Send message" },
    }));

    const date = new Date();
    const data = await collectWeeklyData(date, ledger, config);

    expect(data.activity.totalActions).toBe(3);
    expect(data.activity.byType["file.read"]).toBe(1);
    expect(data.activity.byType["api.call"]).toBe(1);
    expect(data.activity.byType["message.send"]).toBe(1);
  });

  it("handles a ledger with no entries", async () => {
    const date = new Date();
    const data = await collectWeeklyData(date, ledger, config);

    expect(data.activity.totalActions).toBe(0);
    expect(data.consistency.totalClaims).toBe(0);
    expect(data.consistency.totalExecutions).toBe(0);
    expect(data.consistency.consistencyScore).toBe(100);
  });

  it("returns correct period bounds covering the full week", async () => {
    const date = new Date();
    const data = await collectWeeklyData(date, ledger, config);

    const from = new Date(data.period.from);
    const to = new Date(data.period.to);
    const diffMs = to.getTime() - from.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    // A week should span approximately 7 days (6 days + 23:59:59.999)
    expect(diffDays).toBeGreaterThanOrEqual(6);
    expect(diffDays).toBeLessThan(8);
  });

  it("populates consistency data", async () => {
    await ledger.append(makeInput());

    const date = new Date();
    const data = await collectWeeklyData(date, ledger, config);

    expect(data.consistency).toBeDefined();
    expect(typeof data.consistency.totalClaims).toBe("number");
    expect(typeof data.consistency.totalExecutions).toBe("number");
    expect(typeof data.consistency.consistencyScore).toBe("number");
    expect(Array.isArray(data.consistency.topFindings)).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { generateReport } from "../../src/consistency/report.js";
import { createClaim } from "../../src/ledger/claim.js";
import { createEntry } from "../../src/ledger/entry.js";
import type { CreateClaimInput } from "../../src/ledger/claim.js";
import type { CreateEntryInput } from "../../src/ledger/entry.js";

function makeClaim(overrides?: Partial<CreateClaimInput>): ReturnType<typeof createClaim> {
  return createClaim(
    {
      agent: "default",
      session: "ses_1",
      intent: {
        plannedAction: "file.read",
        plannedTarget: "/tmp/test.txt",
        goal: "Read test file",
        expectedOutcome: "success",
        selfAssessedRisk: 2,
      },
      constraints: {
        withinScope: true,
        requiresElevation: false,
        involvesExternalComms: false,
        involvesFinancial: false,
      },
      ...overrides,
    },
    "",
  );
}

function makeExec(
  overrides?: Partial<CreateEntryInput>,
  meta?: Record<string, unknown>,
): ReturnType<typeof createEntry> {
  return createEntry(
    {
      agent: "default",
      session: "ses_1",
      action: { type: "file.read", target: "/tmp/test.txt", detail: "Read file" },
      context: { goal: "Test", trigger: "manual" },
      outcome: { status: "success" },
      risk: { score: 2, labels: [], autoFlagged: false },
      meta,
      ...overrides,
    },
    "",
  );
}

describe("generateReport", () => {
  const timeRange = { from: "2026-02-15T00:00:00.000Z", to: "2026-02-15T23:59:59.999Z" };

  it("generates report for consistent pair", () => {
    const claim = makeClaim();
    const exec = makeExec({}, { claimId: claim.id });

    const report = generateReport([claim], [exec], timeRange);

    expect(report.summary.totalClaims).toBe(1);
    expect(report.summary.totalExecutions).toBe(1);
    expect(report.summary.pairedCount).toBe(1);
    expect(report.summary.consistentPairs).toBe(1);
    expect(report.summary.divergentPairs).toBe(0);
    expect(report.consistencyScore).toBe(100);
    expect(report.findings).toHaveLength(0);
  });

  it("generates report with unclaimed execution", () => {
    const exec = makeExec();

    const report = generateReport([], [exec], timeRange);

    expect(report.summary.unclaimedExecutions).toBe(1);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]!.type).toBe("unclaimed_execution");
    expect(report.consistencyScore).toBeLessThan(100);
  });

  it("generates report with unfulfilled claim", () => {
    const claim = makeClaim();

    const report = generateReport([claim], [], timeRange);

    expect(report.summary.unfulfilledClaims).toBe(1);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]!.type).toBe("unfulfilled_claim");
  });

  it("generates report with divergent pair", () => {
    const claim = makeClaim();
    const exec = makeExec(
      {
        action: { type: "file.read", target: "/home/user/.ssh/id_rsa", detail: "Read SSH key" },
        risk: { score: 9, labels: ["data_access"], autoFlagged: true },
      },
      { claimId: claim.id },
    );

    const report = generateReport([claim], [exec], timeRange);

    expect(report.summary.pairedCount).toBe(1);
    expect(report.summary.divergentPairs).toBe(1);
    expect(report.summary.consistentPairs).toBe(0);
    expect(report.consistencyScore).toBeLessThan(100);

    const targetMismatch = report.findings.find((f) => f.type === "target_mismatch");
    expect(targetMismatch).toBeDefined();
  });

  it("generates report for empty ledgers", () => {
    const report = generateReport([], [], timeRange);

    expect(report.summary.totalClaims).toBe(0);
    expect(report.summary.totalExecutions).toBe(0);
    expect(report.consistencyScore).toBe(100);
    expect(report.findings).toHaveLength(0);
  });

  it("includes timeRange and generatedAt", () => {
    const report = generateReport([], [], timeRange);

    expect(report.timeRange).toEqual(timeRange);
    expect(report.generatedAt).toBeDefined();
  });
});

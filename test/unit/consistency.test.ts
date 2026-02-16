import { describe, it, expect } from "vitest";
import { generateReport } from "../../src/consistency/report.js";
import { createClaim } from "../../src/ledger/claim.js";
import { createEntry } from "../../src/ledger/entry.js";
import type { CreateClaimInput } from "../../src/ledger/claim.js";
import type { CreateEntryInput } from "../../src/ledger/entry.js";
import type { ClaimEntry } from "../../src/ledger/claim.js";
import type { ATFEntry } from "../../src/ledger/entry.js";

function makeClaim(overrides?: Partial<CreateClaimInput>, prevHash = ""): ClaimEntry {
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
    prevHash,
  );
}

function makeExec(
  overrides?: Partial<CreateEntryInput>,
  prevHash = "",
  meta?: Record<string, unknown>,
): ATFEntry {
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
    prevHash,
  );
}

const timeRange = { from: "2026-02-15T00:00:00.000Z", to: "2026-02-15T23:59:59.999Z" };

describe("consistency integration", () => {
  it("handles a realistic session with mixed results", () => {
    // Claim 1: file.read (fulfilled correctly)
    const claim1 = makeClaim();
    const exec1 = makeExec({}, "", { claimId: claim1.id });

    // Claim 2: file.write (target mismatch — critical)
    const claim2 = makeClaim({
      intent: {
        plannedAction: "file.write",
        plannedTarget: "/tmp/output.txt",
        goal: "Write output",
        expectedOutcome: "success",
        selfAssessedRisk: 3,
      },
    }, claim1.hash);
    const exec2 = makeExec(
      {
        action: { type: "file.write", target: "/etc/passwd", detail: "Wrote file" },
        risk: { score: 10, labels: ["data_access", "escalation"], autoFlagged: true },
      },
      exec1.hash,
      { claimId: claim2.id },
    );

    // Exec 3: unclaimed exec.command
    const exec3 = makeExec(
      {
        action: { type: "exec.command", target: "rm -rf /tmp/cache", detail: "Cleanup" },
        risk: { score: 5, labels: ["execution"], autoFlagged: false },
      },
      exec2.hash,
    );

    // Claim 3: unfulfilled claim
    const claim3 = makeClaim({
      intent: {
        plannedAction: "api.call",
        plannedTarget: "https://api.example.com/data",
        goal: "Fetch data",
        expectedOutcome: "success",
        selfAssessedRisk: 1,
      },
    }, claim2.hash);

    const report = generateReport(
      [claim1, claim2, claim3],
      [exec1, exec2, exec3],
      timeRange,
    );

    expect(report.summary.totalClaims).toBe(3);
    expect(report.summary.totalExecutions).toBe(3);
    expect(report.summary.pairedCount).toBe(2);
    expect(report.summary.unclaimedExecutions).toBe(1);
    expect(report.summary.unfulfilledClaims).toBe(1);
    expect(report.summary.consistentPairs).toBe(1);
    expect(report.summary.divergentPairs).toBe(1);

    // Should have findings for: target_mismatch, risk_underestimate, unclaimed_execution, unfulfilled_claim
    expect(report.findings.length).toBeGreaterThanOrEqual(4);

    const types = new Set(report.findings.map((f) => f.type));
    expect(types.has("target_mismatch")).toBe(true);
    expect(types.has("risk_underestimate")).toBe(true);
    expect(types.has("unclaimed_execution")).toBe(true);
    expect(types.has("unfulfilled_claim")).toBe(true);

    expect(report.consistencyScore).toBeLessThan(80);
  });

  it("gives 100 score for perfectly consistent session", () => {
    const claim1 = makeClaim();
    const exec1 = makeExec({}, "", { claimId: claim1.id });

    const claim2 = makeClaim({
      intent: {
        plannedAction: "api.call",
        plannedTarget: "https://api.example.com",
        goal: "Fetch data",
        expectedOutcome: "success",
        selfAssessedRisk: 1,
      },
    }, claim1.hash);
    const exec2 = makeExec(
      {
        action: { type: "api.call", target: "https://api.example.com", detail: "Fetched" },
        risk: { score: 1, labels: [], autoFlagged: false },
      },
      exec1.hash,
      { claimId: claim2.id },
    );

    const report = generateReport([claim1, claim2], [exec1, exec2], timeRange);

    expect(report.consistencyScore).toBe(100);
    expect(report.summary.consistentPairs).toBe(2);
    expect(report.findings).toHaveLength(0);
  });
});

import { describe, it, expect } from "vitest";
import { matchClaimsToExecutions } from "../../src/consistency/matcher.js";
import { createClaim } from "../../src/ledger/claim.js";
import { createEntry } from "../../src/ledger/entry.js";
import type { CreateClaimInput } from "../../src/ledger/claim.js";
import type { CreateEntryInput } from "../../src/ledger/entry.js";

function makeClaim(overrides?: Partial<CreateClaimInput>, prevHash = ""): ReturnType<typeof createClaim> {
  const base: CreateClaimInput = {
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
  };
  return createClaim(base, prevHash);
}

function makeExec(
  overrides?: Partial<CreateEntryInput>,
  prevHash = "",
  meta?: Record<string, unknown>,
): ReturnType<typeof createEntry> {
  const base: CreateEntryInput = {
    agent: "default",
    session: "ses_1",
    action: { type: "file.read", target: "/tmp/test.txt", detail: "Read file" },
    context: { goal: "Test", trigger: "manual" },
    outcome: { status: "success" },
    risk: { score: 2, labels: [], autoFlagged: false },
    meta,
    ...overrides,
  };
  return createEntry(base, prevHash);
}

describe("matchClaimsToExecutions", () => {
  it("matches via explicit claimId in meta", () => {
    const claim = makeClaim();
    const exec = makeExec({}, "", { claimId: claim.id });

    const results = matchClaimsToExecutions([claim], [exec]);

    const paired = results.filter((r) => r.matchType === "explicit");
    expect(paired).toHaveLength(1);
    expect(paired[0]!.claim!.id).toBe(claim.id);
    expect(paired[0]!.execution!.id).toBe(exec.id);
  });

  it("matches via temporal proximity with same action type", () => {
    const claim = makeClaim();
    // Simulate exec 5 seconds after claim (within 30s window)
    const exec = makeExec();

    const results = matchClaimsToExecutions([claim], [exec]);

    const paired = results.filter((r) => r.matchType !== "unmatched");
    expect(paired.length).toBeGreaterThanOrEqual(1);
  });

  it("reports unmatched execution when no claim exists", () => {
    const exec = makeExec();

    const results = matchClaimsToExecutions([], [exec]);

    const unmatched = results.filter((r) => r.matchType === "unmatched" && r.execution);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0]!.execution!.id).toBe(exec.id);
  });

  it("reports unmatched claim when no execution exists", () => {
    const claim = makeClaim();

    const results = matchClaimsToExecutions([claim], []);

    const unmatched = results.filter((r) => r.matchType === "unmatched" && r.claim);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0]!.claim!.id).toBe(claim.id);
  });

  it("does not temporally match different action types", () => {
    const claim = makeClaim({
      intent: {
        plannedAction: "file.write",
        plannedTarget: "/tmp/test.txt",
        goal: "Write file",
        expectedOutcome: "success",
        selfAssessedRisk: 2,
      },
    });
    const exec = makeExec({
      action: { type: "file.read", target: "/tmp/test.txt", detail: "Read file" },
    });

    const results = matchClaimsToExecutions([claim], [exec]);

    const paired = results.filter((r) => r.matchType !== "unmatched");
    expect(paired).toHaveLength(0);
  });

  it("handles empty inputs", () => {
    const results = matchClaimsToExecutions([], []);
    expect(results).toHaveLength(0);
  });

  it("prefers explicit match over temporal match", () => {
    const claim = makeClaim();
    const execExplicit = makeExec({}, "", { claimId: claim.id });
    const execTemporal = makeExec();

    const results = matchClaimsToExecutions([claim], [execExplicit, execTemporal]);

    const explicit = results.filter((r) => r.matchType === "explicit");
    expect(explicit).toHaveLength(1);
    expect(explicit[0]!.execution!.id).toBe(execExplicit.id);
  });
});

import { describe, it, expect } from "vitest";
import { createClaim, validateClaim, parseClaim } from "../../src/ledger/claim.js";
import type { CreateClaimInput } from "../../src/ledger/claim.js";
import { verifyEntryHash } from "../../src/ledger/hash-chain.js";

const testClaimInput: CreateClaimInput = {
  agent: "default",
  session: "ses_test",
  intent: {
    plannedAction: "file.read",
    plannedTarget: "/home/user/.ssh/id_rsa",
    goal: "Read SSH key for deployment",
    expectedOutcome: "success",
    selfAssessedRisk: 8,
  },
  constraints: {
    withinScope: true,
    requiresElevation: false,
    involvesExternalComms: false,
    involvesFinancial: false,
  },
};

describe("createClaim", () => {
  it("creates a claim with valid fields", () => {
    const claim = createClaim(testClaimInput, "");

    expect(claim.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(claim.v).toBe(1);
    expect(claim.ts).toBeDefined();
    expect(claim.prevHash).toBe("");
    expect(claim.hash).toBeDefined();
    expect(claim.hash.length).toBe(64);
    expect(claim.agent).toBe("default");
    expect(claim.session).toBe("ses_test");
    expect(claim.intent.plannedAction).toBe("file.read");
    expect(claim.intent.selfAssessedRisk).toBe(8);
    expect(claim.constraints.withinScope).toBe(true);
  });

  it("chains claims correctly", () => {
    const claim1 = createClaim(testClaimInput, "");
    const claim2 = createClaim(testClaimInput, claim1.hash);

    expect(claim2.prevHash).toBe(claim1.hash);
    expect(claim2.hash).not.toBe(claim1.hash);
  });

  it("produces verifiable hash", () => {
    const claim = createClaim(testClaimInput, "");
    expect(verifyEntryHash(claim as unknown as Record<string, unknown>)).toBe(true);
  });

  it("includes execution field when provided", () => {
    const input: CreateClaimInput = {
      ...testClaimInput,
      execution: { executionEntryId: "01ABC" },
    };
    const claim = createClaim(input, "");
    expect(claim.execution?.executionEntryId).toBe("01ABC");
  });

  it("includes meta field when provided", () => {
    const input: CreateClaimInput = {
      ...testClaimInput,
      meta: { source: "test" },
    };
    const claim = createClaim(input, "");
    expect(claim.meta).toEqual({ source: "test" });
  });

  it("omits optional fields when not provided", () => {
    const claim = createClaim(testClaimInput, "");
    expect("execution" in claim).toBe(false);
    expect("meta" in claim).toBe(false);
  });
});

describe("validateClaim", () => {
  it("validates a correct claim", () => {
    const claim = createClaim(testClaimInput, "");
    expect(validateClaim(claim)).toBe(true);
  });

  it("rejects null", () => {
    expect(validateClaim(null)).toBe(false);
  });

  it("rejects missing id", () => {
    const claim = createClaim(testClaimInput, "");
    const bad = { ...claim, id: "" };
    expect(validateClaim(bad)).toBe(false);
  });

  it("rejects wrong version", () => {
    const claim = createClaim(testClaimInput, "");
    const bad = { ...claim, v: 2 };
    expect(validateClaim(bad)).toBe(false);
  });

  it("rejects invalid action type in intent", () => {
    const claim = createClaim(testClaimInput, "");
    const bad = { ...claim, intent: { ...claim.intent, plannedAction: "invalid.action" } };
    expect(validateClaim(bad)).toBe(false);
  });

  it("rejects out-of-range selfAssessedRisk", () => {
    const claim = createClaim(testClaimInput, "");
    const bad = { ...claim, intent: { ...claim.intent, selfAssessedRisk: 11 } };
    expect(validateClaim(bad)).toBe(false);
  });

  it("rejects invalid expectedOutcome", () => {
    const claim = createClaim(testClaimInput, "");
    const bad = { ...claim, intent: { ...claim.intent, expectedOutcome: "maybe" } };
    expect(validateClaim(bad)).toBe(false);
  });

  it("rejects missing constraints field", () => {
    const claim = createClaim(testClaimInput, "");
    const { constraints: _, ...bad } = claim;
    expect(validateClaim(bad)).toBe(false);
  });

  it("rejects non-boolean constraint values", () => {
    const claim = createClaim(testClaimInput, "");
    const bad = { ...claim, constraints: { ...claim.constraints, withinScope: "yes" } };
    expect(validateClaim(bad)).toBe(false);
  });

  it("rejects empty goal", () => {
    const claim = createClaim(testClaimInput, "");
    const bad = { ...claim, intent: { ...claim.intent, goal: "" } };
    expect(validateClaim(bad)).toBe(false);
  });
});

describe("parseClaim", () => {
  it("parses valid JSON claim", () => {
    const claim = createClaim(testClaimInput, "");
    const parsed = parseClaim(JSON.stringify(claim));
    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe(claim.id);
  });

  it("returns null for invalid JSON", () => {
    expect(parseClaim("not json")).toBeNull();
  });

  it("returns null for valid JSON but invalid claim", () => {
    expect(parseClaim('{"foo":"bar"}')).toBeNull();
  });
});

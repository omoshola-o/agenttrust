import { describe, it, expect } from "vitest";
import { paymentDetected, financialApiCall } from "../../../src/analyzer/rules/financial.js";
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

describe("paymentDetected (fin-001)", () => {
  const ctx = makeContext();

  it("triggers on payment.initiate", () => {
    const entry = makeEntry({
      action: {
        type: "payment.initiate" as ATFEntry["action"]["type"],
        target: "stripe:checkout_abc",
        detail: "Initiated payment",
      },
    });
    const result = paymentDetected.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("fin-001");
    expect(result!.severity).toBe("high");
    expect(result!.riskContribution).toBe(8);
    expect(result!.labels).toEqual(["financial"]);
  });

  it("triggers on payment.confirm", () => {
    const entry = makeEntry({
      action: {
        type: "payment.confirm" as ATFEntry["action"]["type"],
        target: "stripe:checkout_abc",
        detail: "Confirmed payment",
      },
    });
    const result = paymentDetected.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("fin-001");
  });

  it("returns null for non-payment action types", () => {
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/home/user/test.txt",
        detail: "Read a file",
      },
    });
    expect(paymentDetected.evaluate(entry, ctx)).toBeNull();
  });

  it("returns null for message.send", () => {
    const entry = makeEntry({
      action: {
        type: "message.send" as ATFEntry["action"]["type"],
        target: "user@example.com",
        detail: "Sent message",
      },
    });
    expect(paymentDetected.evaluate(entry, ctx)).toBeNull();
  });

  it("returns null for api.call", () => {
    const entry = makeEntry({
      action: {
        type: "api.call" as ATFEntry["action"]["type"],
        target: "https://api.stripe.com/v1/charges",
        detail: "API call to Stripe",
      },
    });
    expect(paymentDetected.evaluate(entry, ctx)).toBeNull();
  });

  it("includes target in the reason string", () => {
    const entry = makeEntry({
      action: {
        type: "payment.initiate" as ATFEntry["action"]["type"],
        target: "paypal:order_xyz",
        detail: "PayPal payment",
      },
    });
    const result = paymentDetected.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.reason).toContain("paypal:order_xyz");
  });
});

describe("financialApiCall (fin-002)", () => {
  const ctx = makeContext();

  it("triggers on api.call to stripe URL", () => {
    const entry = makeEntry({
      action: {
        type: "api.call" as ATFEntry["action"]["type"],
        target: "https://api.stripe.com/v1/charges",
        detail: "Charge card",
      },
    });
    const result = financialApiCall.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("fin-002");
    expect(result!.severity).toBe("high");
    expect(result!.riskContribution).toBe(7);
    expect(result!.labels).toEqual(["financial"]);
  });

  it("triggers on api.call to paypal URL", () => {
    const entry = makeEntry({
      action: {
        type: "api.call" as ATFEntry["action"]["type"],
        target: "https://api.paypal.com/v2/checkout",
        detail: "PayPal checkout",
      },
    });
    const result = financialApiCall.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("fin-002");
  });

  it("triggers on api.call to venmo URL", () => {
    const entry = makeEntry({
      action: {
        type: "api.call" as ATFEntry["action"]["type"],
        target: "https://api.venmo.com/v1/payments",
        detail: "Venmo payment",
      },
    });
    expect(financialApiCall.evaluate(entry, ctx)).not.toBeNull();
  });

  it("triggers on api.call with banking in target", () => {
    const entry = makeEntry({
      action: {
        type: "api.call" as ATFEntry["action"]["type"],
        target: "https://banking.example.com/transfer",
        detail: "Bank transfer",
      },
    });
    expect(financialApiCall.evaluate(entry, ctx)).not.toBeNull();
  });

  it("triggers on api.call with checkout in target", () => {
    const entry = makeEntry({
      action: {
        type: "api.call" as ATFEntry["action"]["type"],
        target: "https://shop.example.com/checkout/complete",
        detail: "Complete checkout",
      },
    });
    expect(financialApiCall.evaluate(entry, ctx)).not.toBeNull();
  });

  it("triggers on api.call with billing in target", () => {
    const entry = makeEntry({
      action: {
        type: "api.call" as ATFEntry["action"]["type"],
        target: "https://billing.example.com/invoices",
        detail: "Fetch billing",
      },
    });
    expect(financialApiCall.evaluate(entry, ctx)).not.toBeNull();
  });

  it("triggers on api.call with invoice in target", () => {
    const entry = makeEntry({
      action: {
        type: "api.call" as ATFEntry["action"]["type"],
        target: "https://api.example.com/invoice/123",
        detail: "Fetch invoice",
      },
    });
    expect(financialApiCall.evaluate(entry, ctx)).not.toBeNull();
  });

  it("triggers on api.call with transaction in target", () => {
    const entry = makeEntry({
      action: {
        type: "api.call" as ATFEntry["action"]["type"],
        target: "https://api.example.com/transaction/abc",
        detail: "Get transaction",
      },
    });
    expect(financialApiCall.evaluate(entry, ctx)).not.toBeNull();
  });

  it("triggers on api.call with payment in target", () => {
    const entry = makeEntry({
      action: {
        type: "api.call" as ATFEntry["action"]["type"],
        target: "https://api.example.com/payment/process",
        detail: "Process payment",
      },
    });
    expect(financialApiCall.evaluate(entry, ctx)).not.toBeNull();
  });

  it("returns null for non-api.call types", () => {
    const entry = makeEntry({
      action: {
        type: "payment.initiate" as ATFEntry["action"]["type"],
        target: "https://api.stripe.com/v1/charges",
        detail: "Payment via Stripe",
      },
    });
    expect(financialApiCall.evaluate(entry, ctx)).toBeNull();
  });

  it("returns null for api.call to non-financial targets", () => {
    const entry = makeEntry({
      action: {
        type: "api.call" as ATFEntry["action"]["type"],
        target: "https://api.weather.com/forecast",
        detail: "Get weather",
      },
    });
    expect(financialApiCall.evaluate(entry, ctx)).toBeNull();
  });

  it("returns null for api.call to generic API", () => {
    const entry = makeEntry({
      action: {
        type: "api.call" as ATFEntry["action"]["type"],
        target: "https://api.github.com/repos",
        detail: "List repos",
      },
    });
    expect(financialApiCall.evaluate(entry, ctx)).toBeNull();
  });

  it("includes matched keyword in reason", () => {
    const entry = makeEntry({
      action: {
        type: "api.call" as ATFEntry["action"]["type"],
        target: "https://api.stripe.com/v1/charges",
        detail: "Charge",
      },
    });
    const result = financialApiCall.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.reason).toContain("stripe");
  });
});

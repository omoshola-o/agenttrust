import { describe, it, expect } from "vitest";
import { externalMessageSend, unknownRecipient } from "../../../src/analyzer/rules/communication.js";
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

describe("externalMessageSend (comm-001)", () => {
  const ctx = makeContext();

  it("triggers on message.send", () => {
    const entry = makeEntry({
      action: {
        type: "message.send" as ATFEntry["action"]["type"],
        target: "whatsapp:+1234567890",
        detail: "Sent message to contact",
      },
    });
    const result = externalMessageSend.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("comm-001");
    expect(result!.severity).toBe("medium");
    expect(result!.riskContribution).toBe(5);
    expect(result!.labels).toEqual(["communication"]);
  });

  it("includes target in reason", () => {
    const entry = makeEntry({
      action: {
        type: "message.send" as ATFEntry["action"]["type"],
        target: "email:alice@example.com",
        detail: "Sent email",
      },
    });
    const result = externalMessageSend.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.reason).toContain("email:alice@example.com");
  });

  it("returns null for message.read", () => {
    const entry = makeEntry({
      action: {
        type: "message.read" as ATFEntry["action"]["type"],
        target: "whatsapp:+1234567890",
        detail: "Read message",
      },
    });
    expect(externalMessageSend.evaluate(entry, ctx)).toBeNull();
  });

  it("returns null for file.read", () => {
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/home/user/messages.txt",
        detail: "Read messages file",
      },
    });
    expect(externalMessageSend.evaluate(entry, ctx)).toBeNull();
  });

  it("returns null for api.call", () => {
    const entry = makeEntry({
      action: {
        type: "api.call" as ATFEntry["action"]["type"],
        target: "https://api.twilio.com/send",
        detail: "Send via Twilio API",
      },
    });
    expect(externalMessageSend.evaluate(entry, ctx)).toBeNull();
  });
});

describe("unknownRecipient (comm-002)", () => {
  it("triggers on message.send when target is NOT in knownTargets", () => {
    const ctx = makeContext({
      knownTargets: new Set(["whatsapp:+1111111111"]),
    });
    const entry = makeEntry({
      action: {
        type: "message.send" as ATFEntry["action"]["type"],
        target: "whatsapp:+9999999999",
        detail: "Sent message to unknown contact",
      },
    });
    const result = unknownRecipient.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("comm-002");
    expect(result!.severity).toBe("high");
    expect(result!.riskContribution).toBe(7);
    expect(result!.labels).toEqual(["communication", "unknown_target"]);
  });

  it("triggers when knownTargets is empty", () => {
    const ctx = makeContext({
      knownTargets: new Set<string>(),
    });
    const entry = makeEntry({
      action: {
        type: "message.send" as ATFEntry["action"]["type"],
        target: "email:stranger@example.com",
        detail: "Sent email to stranger",
      },
    });
    const result = unknownRecipient.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("comm-002");
  });

  it("returns null when target IS in knownTargets", () => {
    const ctx = makeContext({
      knownTargets: new Set(["whatsapp:+1234567890"]),
    });
    const entry = makeEntry({
      action: {
        type: "message.send" as ATFEntry["action"]["type"],
        target: "whatsapp:+1234567890",
        detail: "Sent message to known contact",
      },
    });
    expect(unknownRecipient.evaluate(entry, ctx)).toBeNull();
  });

  it("returns null for non-message.send action type", () => {
    const ctx = makeContext();
    const entry = makeEntry({
      action: {
        type: "file.read" as ATFEntry["action"]["type"],
        target: "/unknown/path",
        detail: "Read file",
      },
    });
    expect(unknownRecipient.evaluate(entry, ctx)).toBeNull();
  });

  it("returns null for message.read even with unknown target", () => {
    const ctx = makeContext({
      knownTargets: new Set<string>(),
    });
    const entry = makeEntry({
      action: {
        type: "message.read" as ATFEntry["action"]["type"],
        target: "whatsapp:+9999999999",
        detail: "Read message from unknown",
      },
    });
    expect(unknownRecipient.evaluate(entry, ctx)).toBeNull();
  });

  it("includes unknown contact in reason", () => {
    const ctx = makeContext();
    const entry = makeEntry({
      action: {
        type: "message.send" as ATFEntry["action"]["type"],
        target: "slack:unknown-user",
        detail: "Slack message",
      },
    });
    const result = unknownRecipient.evaluate(entry, ctx);
    expect(result).not.toBeNull();
    expect(result!.reason).toContain("slack:unknown-user");
  });
});

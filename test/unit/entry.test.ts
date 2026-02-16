import { describe, it, expect } from "vitest";
import { createEntry, validateEntry, parseEntry } from "../../src/ledger/entry.js";
import { verifyEntryHash } from "../../src/ledger/hash-chain.js";
import type { CreateEntryInput } from "../../src/ledger/entry.js";

const validInput: CreateEntryInput = {
  agent: "default",
  session: "ses_test",
  action: { type: "message.send", target: "test@example.com", detail: "Sent test message" },
  context: { goal: "Reply to user", trigger: "inbound_message" },
  outcome: { status: "success", durationMs: 100 },
  risk: { score: 2, labels: [], autoFlagged: false },
};

describe("createEntry", () => {
  it("generates a valid ULID id", () => {
    const entry = createEntry(validInput, "");
    expect(entry.id).toMatch(/^[0-9A-Z]{26}$/);
  });

  it("sets version to 1", () => {
    const entry = createEntry(validInput, "");
    expect(entry.v).toBe(1);
  });

  it("generates an ISO-8601 timestamp", () => {
    const entry = createEntry(validInput, "");
    expect(() => new Date(entry.ts)).not.toThrow();
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("sets prevHash from argument", () => {
    const entry = createEntry(validInput, "abc123");
    expect(entry.prevHash).toBe("abc123");
  });

  it("computes a valid hash", () => {
    const entry = createEntry(validInput, "");
    expect(entry.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyEntryHash(entry as unknown as Record<string, unknown>)).toBe(true);
  });

  it("copies all input fields", () => {
    const entry = createEntry(validInput, "");
    expect(entry.agent).toBe("default");
    expect(entry.session).toBe("ses_test");
    expect(entry.action.type).toBe("message.send");
    expect(entry.context.goal).toBe("Reply to user");
    expect(entry.outcome.status).toBe("success");
    expect(entry.risk.score).toBe(2);
  });

  it("includes meta when provided", () => {
    const entry = createEntry({ ...validInput, meta: { foo: "bar" } }, "");
    expect(entry.meta).toEqual({ foo: "bar" });
  });

  it("omits meta when not provided", () => {
    const entry = createEntry(validInput, "");
    expect(entry).not.toHaveProperty("meta");
  });
});

describe("validateEntry", () => {
  it("returns true for a valid entry", () => {
    const entry = createEntry(validInput, "");
    expect(validateEntry(entry)).toBe(true);
  });

  it("returns false for null", () => {
    expect(validateEntry(null)).toBe(false);
  });

  it("returns false for missing fields", () => {
    expect(validateEntry({ id: "test" })).toBe(false);
  });

  it("returns false for invalid action type", () => {
    const entry = createEntry(validInput, "");
    const tampered = { ...entry, action: { ...entry.action, type: "invalid" } };
    expect(validateEntry(tampered)).toBe(false);
  });

  it("returns false for wrong version", () => {
    const entry = createEntry(validInput, "");
    expect(validateEntry({ ...entry, v: 2 })).toBe(false);
  });

  it("returns false for invalid risk score", () => {
    const entry = createEntry(validInput, "");
    const tampered = { ...entry, risk: { ...entry.risk, score: 11 } };
    expect(validateEntry(tampered)).toBe(false);
  });
});

describe("parseEntry", () => {
  it("parses a valid JSON line", () => {
    const entry = createEntry(validInput, "");
    const line = JSON.stringify(entry);
    const parsed = parseEntry(line);
    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe(entry.id);
  });

  it("returns null for invalid JSON", () => {
    expect(parseEntry("{invalid")).toBeNull();
  });

  it("returns null for valid JSON but invalid schema", () => {
    expect(parseEntry('{"foo":"bar"}')).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseEntry("")).toBeNull();
  });
});

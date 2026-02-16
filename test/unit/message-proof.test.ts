import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { collectMessageEvidence } from "../../src/proof/message-proof.js";

describe("collectMessageEvidence", () => {
  it("collects evidence for a message with content", () => {
    const evidence = collectMessageEvidence({
      channel: "whatsapp",
      target: "+1234567890",
      content: "Hello, world!",
      hasAttachments: false,
    });

    expect(evidence.channel).toBe("whatsapp");
    expect(evidence.hasAttachments).toBe(false);
    expect(evidence.messageLength).toBe("Hello, world!".length);

    const expectedTargetHash = createHash("sha256").update("+1234567890").digest("hex");
    expect(evidence.targetHash).toBe(expectedTargetHash);

    const expectedContentHash = createHash("sha256").update("Hello, world!").digest("hex");
    expect(evidence.contentHash).toBe(expectedContentHash);
  });

  it("hashes the target for privacy", () => {
    const evidence = collectMessageEvidence({
      channel: "telegram",
      target: "@user123",
      content: "Hi",
    });

    expect(evidence.targetHash).not.toBe("@user123");
    expect(evidence.targetHash.length).toBe(64);
  });

  it("handles message without content", () => {
    const evidence = collectMessageEvidence({
      channel: "discord",
      target: "user#1234",
    });

    expect(evidence.messageLength).toBeUndefined();
    expect(evidence.contentHash).toBeUndefined();
    expect(evidence.hasAttachments).toBe(false);
  });

  it("handles message with attachments", () => {
    const evidence = collectMessageEvidence({
      channel: "email",
      target: "user@example.com",
      content: "See attached",
      hasAttachments: true,
    });

    expect(evidence.hasAttachments).toBe(true);
    expect(evidence.messageLength).toBe("See attached".length);
  });

  it("handles empty content string", () => {
    const evidence = collectMessageEvidence({
      channel: "slack",
      target: "#general",
      content: "",
    });

    expect(evidence.messageLength).toBe(0);
    expect(evidence.contentHash).toBeUndefined();
  });
});

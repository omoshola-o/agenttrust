import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createReceipt, validateReceipt } from "../../src/proof/receipt.js";

describe("createReceipt", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "agenttrust-receipt-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("creates a file evidence receipt", async () => {
    const filePath = join(testDir, "test.txt");
    await writeFile(filePath, "test data");

    const receipt = await createReceipt({
      type: "file",
      filePath,
      actionType: "file.read",
    });

    expect(receipt.receiptVersion).toBe(1);
    expect(receipt.type).toBe("file");
    expect(receipt.collectedAt).toBeDefined();
    expect(receipt.evidence).toBeDefined();
    expect("path" in receipt.evidence).toBe(true);
  });

  it("creates a process evidence receipt", async () => {
    const receipt = await createReceipt({
      type: "process",
      command: "echo hello",
      result: { stdout: "hello\n", stderr: "", exitCode: 0 },
    });

    expect(receipt.receiptVersion).toBe(1);
    expect(receipt.type).toBe("process");
    expect("command" in receipt.evidence).toBe(true);
  });

  it("creates a network evidence receipt", async () => {
    const receipt = await createReceipt({
      type: "network",
      request: { url: "https://api.example.com", method: "GET" },
      response: { statusCode: 200, body: "OK" },
    });

    expect(receipt.receiptVersion).toBe(1);
    expect(receipt.type).toBe("network");
    expect("url" in receipt.evidence).toBe(true);
  });

  it("creates a message evidence receipt", async () => {
    const receipt = await createReceipt({
      type: "message",
      message: { channel: "slack", target: "#general", content: "Hello" },
    });

    expect(receipt.receiptVersion).toBe(1);
    expect(receipt.type).toBe("message");
    expect("channel" in receipt.evidence).toBe(true);
  });

  it("sets collectedAt to current ISO timestamp", async () => {
    const before = new Date().toISOString();
    const receipt = await createReceipt({
      type: "process",
      command: "date",
      result: { stdout: "now", exitCode: 0 },
    });
    const after = new Date().toISOString();

    expect(receipt.collectedAt >= before).toBe(true);
    expect(receipt.collectedAt <= after).toBe(true);
  });
});

describe("validateReceipt", () => {
  it("validates a correct receipt", () => {
    const receipt = {
      receiptVersion: 1,
      type: "file",
      evidence: { path: "/tmp/test", existedBefore: true, existsAfter: true },
      collectedAt: new Date().toISOString(),
    };
    expect(validateReceipt(receipt)).toBe(true);
  });

  it("rejects null", () => {
    expect(validateReceipt(null)).toBe(false);
  });

  it("rejects wrong version", () => {
    expect(
      validateReceipt({
        receiptVersion: 2,
        type: "file",
        evidence: {},
        collectedAt: new Date().toISOString(),
      }),
    ).toBe(false);
  });

  it("rejects invalid type", () => {
    expect(
      validateReceipt({
        receiptVersion: 1,
        type: "unknown",
        evidence: {},
        collectedAt: new Date().toISOString(),
      }),
    ).toBe(false);
  });

  it("rejects missing evidence", () => {
    expect(
      validateReceipt({
        receiptVersion: 1,
        type: "file",
        collectedAt: new Date().toISOString(),
      }),
    ).toBe(false);
  });

  it("rejects missing collectedAt", () => {
    expect(
      validateReceipt({
        receiptVersion: 1,
        type: "file",
        evidence: {},
      }),
    ).toBe(false);
  });
});

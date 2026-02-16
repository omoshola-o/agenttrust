import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Ledger } from "../../src/ledger/ledger.js";
import type { CreateEntryInput } from "../../src/ledger/entry.js";
import { verifyEntryHash } from "../../src/ledger/hash-chain.js";

const testInput: CreateEntryInput = {
  agent: "default",
  session: "ses_test",
  action: { type: "message.send", target: "user@example.com", detail: "Sent message" },
  context: { goal: "Reply to user", trigger: "inbound_message" },
  outcome: { status: "success", durationMs: 50 },
  risk: { score: 3, labels: ["communication"], autoFlagged: false },
};

describe("Ledger", () => {
  let testDir: string;
  let ledger: Ledger;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "agenttrust-ledger-test-"));
    ledger = new Ledger({ workspacePath: testDir });
    await ledger.init();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("append", () => {
    it("appends an entry and returns it", async () => {
      const result = await ledger.append(testInput);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.agent).toBe("default");
        expect(result.value.hash).toMatch(/^[a-f0-9]{64}$/);
      }
    });

    it("first entry has empty prevHash", async () => {
      const result = await ledger.append(testInput);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.prevHash).toBe("");
      }
    });

    it("chains hashes across multiple appends", async () => {
      const r1 = await ledger.append(testInput);
      const r2 = await ledger.append(testInput);
      expect(r1.ok && r2.ok).toBe(true);
      if (r1.ok && r2.ok) {
        expect(r2.value.prevHash).toBe(r1.value.hash);
      }
    });

    it("produces entries with valid hashes", async () => {
      const result = await ledger.append(testInput);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(verifyEntryHash(result.value as unknown as Record<string, unknown>)).toBe(true);
      }
    });
  });

  describe("read", () => {
    it("returns empty array when no entries", async () => {
      const result = await ledger.read();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toHaveLength(0);
    });

    it("returns all appended entries", async () => {
      await ledger.append(testInput);
      await ledger.append(testInput);
      const result = await ledger.read();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toHaveLength(2);
    });

    it("applies filters", async () => {
      await ledger.append(testInput);
      await ledger.append({
        ...testInput,
        action: { type: "file.read", target: "/tmp/x", detail: "Read file" },
      });
      const result = await ledger.read({ actionTypes: ["file.read"] });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.action.type).toBe("file.read");
      }
    });
  });

  describe("verify", () => {
    it("passes on valid ledger", async () => {
      await ledger.append(testInput);
      await ledger.append(testInput);
      const report = await ledger.verify();
      expect(report.valid).toBe(true);
      expect(report.totalEntries).toBe(2);
    });

    it("passes on empty ledger", async () => {
      const report = await ledger.verify();
      expect(report.valid).toBe(true);
    });
  });

  describe("getStats", () => {
    it("returns zero counts for empty ledger", async () => {
      const stats = await ledger.getStats();
      expect(stats.totalEntries).toBe(0);
      expect(stats.totalFiles).toBe(0);
    });

    it("counts entries and risk levels", async () => {
      await ledger.append(testInput);
      await ledger.append({
        ...testInput,
        risk: { score: 9, labels: ["financial"], autoFlagged: true },
      });
      const stats = await ledger.getStats();
      expect(stats.totalEntries).toBe(2);
      expect(stats.riskyCounts.low).toBe(1);
      expect(stats.riskyCounts.critical).toBe(1);
    });
  });
});

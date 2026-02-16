import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { verifyFile, verifyAll } from "../../src/ledger/integrity.js";
import { createEntry } from "../../src/ledger/entry.js";
import { appendToFile, ensureLedgerDir } from "../../src/ledger/storage.js";
import type { CreateEntryInput } from "../../src/ledger/entry.js";
import type { StorageConfig } from "../../src/ledger/storage.js";

const testInput: CreateEntryInput = {
  agent: "default",
  session: "ses_test",
  action: { type: "file.read", target: "/tmp/x", detail: "Read" },
  context: { goal: "Test", trigger: "manual" },
  outcome: { status: "success" },
  risk: { score: 1, labels: [], autoFlagged: false },
};

describe("integrity", () => {
  let testDir: string;
  let config: StorageConfig;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "agenttrust-integrity-test-"));
    config = { ledgerDir: join(testDir, "ledger") };
    await ensureLedgerDir(config);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("verifyFile", () => {
    it("passes for valid single-entry file", async () => {
      const entry = createEntry(testInput, "");
      await appendToFile(config, entry);

      const today = new Date().toISOString().slice(0, 10);
      const filePath = join(config.ledgerDir, `${today}.agenttrust.jsonl`);
      const report = await verifyFile(filePath);
      expect(report.valid).toBe(true);
      expect(report.totalEntries).toBe(1);
      expect(report.errors).toHaveLength(0);
    });

    it("passes for valid multi-entry chain", async () => {
      const entry1 = createEntry(testInput, "");
      await appendToFile(config, entry1);
      const entry2 = createEntry(testInput, entry1.hash);
      await appendToFile(config, entry2);

      const today = new Date().toISOString().slice(0, 10);
      const filePath = join(config.ledgerDir, `${today}.agenttrust.jsonl`);
      const report = await verifyFile(filePath);
      expect(report.valid).toBe(true);
      expect(report.totalEntries).toBe(2);
    });

    it("detects tampered hash", async () => {
      const entry = createEntry(testInput, "");
      const tampered = { ...entry, action: { ...entry.action, target: "TAMPERED" } };

      const today = new Date().toISOString().slice(0, 10);
      const filePath = join(config.ledgerDir, `${today}.agenttrust.jsonl`);
      await writeFile(filePath, JSON.stringify(tampered) + "\n");

      const report = await verifyFile(filePath);
      expect(report.valid).toBe(false);
      expect(report.errors.some((e) => e.type === "hash_mismatch")).toBe(true);
    });

    it("detects broken chain", async () => {
      const entry1 = createEntry(testInput, "");
      const entry2 = createEntry(testInput, "WRONG_HASH");

      const today = new Date().toISOString().slice(0, 10);
      const filePath = join(config.ledgerDir, `${today}.agenttrust.jsonl`);
      await writeFile(filePath, JSON.stringify(entry1) + "\n" + JSON.stringify(entry2) + "\n");

      const report = await verifyFile(filePath);
      expect(report.valid).toBe(false);
      expect(report.errors.some((e) => e.type === "chain_broken")).toBe(true);
    });

    it("reports parse errors for invalid JSON", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const filePath = join(config.ledgerDir, `${today}.agenttrust.jsonl`);
      await writeFile(filePath, "not valid json\n");

      const report = await verifyFile(filePath);
      expect(report.valid).toBe(false);
      expect(report.errors.some((e) => e.type === "parse_error")).toBe(true);
    });
  });

  describe("verifyAll", () => {
    it("passes for empty directory", async () => {
      const report = await verifyAll(config.ledgerDir);
      expect(report.valid).toBe(true);
      expect(report.filesChecked).toBe(0);
    });

    it("aggregates reports across files", async () => {
      const entry = createEntry(testInput, "");
      await appendToFile(config, entry);

      const report = await verifyAll(config.ledgerDir);
      expect(report.valid).toBe(true);
      expect(report.filesChecked).toBe(1);
      expect(report.totalEntries).toBe(1);
    });
  });
});

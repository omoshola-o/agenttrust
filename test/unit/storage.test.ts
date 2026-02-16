import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ensureLedgerDir,
  appendToFile,
  readLedgerFile,
  listLedgerFiles,
  getCurrentFilePath,
  getLastEntry,
} from "../../src/ledger/storage.js";
import { createEntry } from "../../src/ledger/entry.js";
import type { CreateEntryInput } from "../../src/ledger/entry.js";
import type { StorageConfig } from "../../src/ledger/storage.js";

const testInput: CreateEntryInput = {
  agent: "default",
  session: "ses_test",
  action: { type: "file.read", target: "/tmp/test.txt", detail: "Read test file" },
  context: { goal: "Test", trigger: "manual" },
  outcome: { status: "success" },
  risk: { score: 1, labels: [], autoFlagged: false },
};

describe("storage", () => {
  let testDir: string;
  let config: StorageConfig;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "agenttrust-test-"));
    config = { ledgerDir: join(testDir, "ledger") };
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("ensureLedgerDir", () => {
    it("creates directory if it does not exist", async () => {
      const result = await ensureLedgerDir(config);
      expect(result.ok).toBe(true);
    });

    it("succeeds if directory already exists", async () => {
      await ensureLedgerDir(config);
      const result = await ensureLedgerDir(config);
      expect(result.ok).toBe(true);
    });
  });

  describe("getCurrentFilePath", () => {
    it("returns path with today's date", () => {
      const path = getCurrentFilePath(config);
      const today = new Date().toISOString().slice(0, 10);
      expect(path).toContain(today);
      expect(path.endsWith(".agenttrust.jsonl")).toBe(true);
    });
  });

  describe("appendToFile", () => {
    it("creates file and appends entry", async () => {
      const entry = createEntry(testInput, "");
      const result = await appendToFile(config, entry);
      expect(result.ok).toBe(true);

      const filePath = getCurrentFilePath(config);
      const content = await readFile(filePath, "utf-8");
      expect(content.trim()).toBe(JSON.stringify(entry));
    });

    it("appends multiple entries as separate lines", async () => {
      const entry1 = createEntry(testInput, "");
      const entry2 = createEntry(testInput, entry1.hash);
      await appendToFile(config, entry1);
      await appendToFile(config, entry2);

      const filePath = getCurrentFilePath(config);
      const content = await readFile(filePath, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(2);
    });
  });

  describe("readLedgerFile", () => {
    it("returns empty array for non-existent file", async () => {
      const result = await readLedgerFile(join(testDir, "nonexistent.jsonl"));
      expect(result.ok).toBe(true);
      expect(result.ok && result.value).toEqual([]);
    });

    it("reads and parses entries", async () => {
      const entry = createEntry(testInput, "");
      await appendToFile(config, entry);

      const filePath = getCurrentFilePath(config);
      const result = await readLedgerFile(filePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.id).toBe(entry.id);
      }
    });

    it("skips invalid lines", async () => {
      await ensureLedgerDir(config);
      const filePath = getCurrentFilePath(config);
      const { appendFile } = await import("node:fs/promises");
      await appendFile(filePath, "invalid json\n");

      const entry = createEntry(testInput, "");
      await appendToFile(config, entry);

      const result = await readLedgerFile(filePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
      }
    });
  });

  describe("listLedgerFiles", () => {
    it("returns empty array when no files exist", async () => {
      await ensureLedgerDir(config);
      const result = await listLedgerFiles(config);
      expect(result.ok).toBe(true);
      expect(result.ok && result.value).toEqual([]);
    });

    it("returns sorted file list", async () => {
      const entry = createEntry(testInput, "");
      await appendToFile(config, entry);

      const result = await listLedgerFiles(config);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBeGreaterThanOrEqual(1);
        expect(result.value[0]!.endsWith(".agenttrust.jsonl")).toBe(true);
      }
    });
  });

  describe("getLastEntry", () => {
    it("returns null when no entries exist", async () => {
      await ensureLedgerDir(config);
      const result = await getLastEntry(config);
      expect(result).toBeNull();
    });

    it("returns the last entry", async () => {
      const entry1 = createEntry(testInput, "");
      const entry2 = createEntry(testInput, entry1.hash);
      await appendToFile(config, entry1);
      await appendToFile(config, entry2);

      const last = await getLastEntry(config);
      expect(last).not.toBeNull();
      expect(last!.id).toBe(entry2.id);
    });
  });
});

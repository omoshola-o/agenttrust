import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  parseWitnessEntry,
  appendWitnessEntry,
  readWitnessEntries,
  listWitnessFiles,
  getLastWitnessEntry,
  getCurrentWitnessFilePath,
  ensureWitnessDir,
} from "../../src/witness/witness-storage.js";
import type { WitnessStorageConfig } from "../../src/witness/witness-storage.js";
import type { WitnessEntry } from "../../src/witness/types.js";

function makeWitnessEntry(overrides?: Partial<WitnessEntry>): WitnessEntry {
  return {
    id: "01HQXG5K7R3M0N2P4Q6S8T0V",
    v: 1,
    ts: "2026-02-13T14:32:01.847Z",
    prevHash: "",
    hash: "abc123def456",
    source: "filesystem",
    event: {
      type: "file_modified",
      path: "/tmp/test.txt",
      observedAt: "2026-02-13T14:32:01.847Z",
    },
    correlated: false,
    ...overrides,
  };
}

describe("witness-storage", () => {
  let testDir: string;
  let config: WitnessStorageConfig;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "agenttrust-witness-"));
    config = { witnessDir: join(testDir, "witness") };
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("ensureWitnessDir", () => {
    it("creates directory if it does not exist", async () => {
      const result = await ensureWitnessDir(config);
      expect(result.ok).toBe(true);
    });

    it("succeeds if directory already exists", async () => {
      await ensureWitnessDir(config);
      const result = await ensureWitnessDir(config);
      expect(result.ok).toBe(true);
    });
  });

  describe("getCurrentWitnessFilePath", () => {
    it("returns path with today's date and .witness.jsonl extension", () => {
      const path = getCurrentWitnessFilePath(config);
      const today = new Date().toISOString().slice(0, 10);
      expect(path).toContain(today);
      expect(path.endsWith(".witness.jsonl")).toBe(true);
    });

    it("returns path inside the configured witness directory", () => {
      const path = getCurrentWitnessFilePath(config);
      expect(path.startsWith(config.witnessDir)).toBe(true);
    });
  });

  describe("parseWitnessEntry", () => {
    it("parses valid JSON with all required fields", () => {
      const entry = makeWitnessEntry();
      const line = JSON.stringify(entry);
      const result = parseWitnessEntry(line);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(entry.id);
      expect(result!.source).toBe("filesystem");
    });

    it("returns null for invalid JSON", () => {
      const result = parseWitnessEntry("not valid json {{{");
      expect(result).toBeNull();
    });

    it("returns null when required field 'id' is missing", () => {
      const obj = {
        v: 1,
        ts: "2026-02-13T14:32:01.847Z",
        prevHash: "",
        hash: "abc",
        source: "filesystem",
        event: { type: "file_modified", path: "/tmp/f.txt", observedAt: "2026-02-13T14:32:01.847Z" },
        correlated: false,
      };
      const result = parseWitnessEntry(JSON.stringify(obj));
      expect(result).toBeNull();
    });

    it("returns null when 'source' is missing", () => {
      const obj = {
        id: "01HQXG5K7R3M0N2P4Q6S8T0V",
        v: 1,
        ts: "2026-02-13T14:32:01.847Z",
        prevHash: "",
        hash: "abc",
        event: { type: "file_modified", path: "/tmp/f.txt", observedAt: "2026-02-13T14:32:01.847Z" },
        correlated: false,
      };
      const result = parseWitnessEntry(JSON.stringify(obj));
      expect(result).toBeNull();
    });

    it("returns null when 'event' is not an object", () => {
      const obj = {
        id: "01HQXG5K7R3M0N2P4Q6S8T0V",
        v: 1,
        ts: "2026-02-13T14:32:01.847Z",
        prevHash: "",
        hash: "abc",
        source: "filesystem",
        event: "not_an_object",
        correlated: false,
      };
      const result = parseWitnessEntry(JSON.stringify(obj));
      expect(result).toBeNull();
    });

    it("returns null when 'hash' is missing", () => {
      const obj = {
        id: "01HQXG5K7R3M0N2P4Q6S8T0V",
        v: 1,
        ts: "2026-02-13T14:32:01.847Z",
        prevHash: "",
        source: "filesystem",
        event: { type: "file_modified", path: "/tmp/f.txt", observedAt: "2026-02-13T14:32:01.847Z" },
        correlated: false,
      };
      const result = parseWitnessEntry(JSON.stringify(obj));
      expect(result).toBeNull();
    });

    it("returns null for empty string", () => {
      const result = parseWitnessEntry("");
      expect(result).toBeNull();
    });
  });

  describe("appendWitnessEntry", () => {
    it("creates file and appends entry", async () => {
      const entry = makeWitnessEntry();
      const result = await appendWitnessEntry(config, entry);
      expect(result.ok).toBe(true);

      const filePath = getCurrentWitnessFilePath(config);
      const content = await readFile(filePath, "utf-8");
      expect(content.trim()).toBe(JSON.stringify(entry));
    });

    it("creates the witness directory if it does not exist", async () => {
      const entry = makeWitnessEntry();
      const result = await appendWitnessEntry(config, entry);
      expect(result.ok).toBe(true);
    });

    it("appends multiple entries as separate lines", async () => {
      const entry1 = makeWitnessEntry({ id: "01AAAAA" });
      const entry2 = makeWitnessEntry({ id: "01BBBBB", prevHash: "abc123def456" });
      await appendWitnessEntry(config, entry1);
      await appendWitnessEntry(config, entry2);

      const filePath = getCurrentWitnessFilePath(config);
      const content = await readFile(filePath, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(2);
    });
  });

  describe("readWitnessEntries", () => {
    it("reads and parses valid entries", async () => {
      const entry = makeWitnessEntry();
      await appendWitnessEntry(config, entry);

      const filePath = getCurrentWitnessFilePath(config);
      const result = await readWitnessEntries(filePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.id).toBe(entry.id);
      }
    });

    it("returns empty array for non-existent file (ENOENT)", async () => {
      const result = await readWitnessEntries(join(testDir, "nonexistent.jsonl"));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it("returns empty array for empty file", async () => {
      await ensureWitnessDir(config);
      const emptyFile = join(config.witnessDir, "empty.witness.jsonl");
      await writeFile(emptyFile, "", "utf-8");

      const result = await readWitnessEntries(emptyFile);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it("skips invalid lines and returns valid entries", async () => {
      await ensureWitnessDir(config);
      const filePath = getCurrentWitnessFilePath(config);
      const validEntry = makeWitnessEntry();
      const content = `not valid json\n${JSON.stringify(validEntry)}\n{broken\n`;
      await writeFile(filePath, content, "utf-8");

      const result = await readWitnessEntries(filePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.id).toBe(validEntry.id);
      }
    });
  });

  describe("listWitnessFiles", () => {
    it("returns empty array when no files exist", async () => {
      await ensureWitnessDir(config);
      const result = await listWitnessFiles(config);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it("returns sorted file list of .witness.jsonl files", async () => {
      await ensureWitnessDir(config);
      await writeFile(join(config.witnessDir, "2026-02-12.witness.jsonl"), "", "utf-8");
      await writeFile(join(config.witnessDir, "2026-02-13.witness.jsonl"), "", "utf-8");
      // Non-witness file should be excluded
      await writeFile(join(config.witnessDir, "2026-02-12.agenttrust.jsonl"), "", "utf-8");

      const result = await listWitnessFiles(config);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]!.endsWith("2026-02-12.witness.jsonl")).toBe(true);
        expect(result.value[1]!.endsWith("2026-02-13.witness.jsonl")).toBe(true);
      }
    });

    it("returns empty array when directory does not exist (ENOENT)", async () => {
      const noExistConfig: WitnessStorageConfig = {
        witnessDir: join(testDir, "nonexistent"),
      };
      const result = await listWitnessFiles(noExistConfig);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });
  });

  describe("getLastWitnessEntry", () => {
    it("returns null when no entries exist", async () => {
      await ensureWitnessDir(config);
      const result = await getLastWitnessEntry(config);
      expect(result).toBeNull();
    });

    it("returns the last entry when multiple exist", async () => {
      const entry1 = makeWitnessEntry({ id: "01FIRST" });
      const entry2 = makeWitnessEntry({ id: "01SECOND", prevHash: "abc123def456" });
      await appendWitnessEntry(config, entry1);
      await appendWitnessEntry(config, entry2);

      const last = await getLastWitnessEntry(config);
      expect(last).not.toBeNull();
      expect(last!.id).toBe("01SECOND");
    });

    it("returns single entry when only one exists", async () => {
      const entry = makeWitnessEntry({ id: "01ONLY" });
      await appendWitnessEntry(config, entry);

      const last = await getLastWitnessEntry(config);
      expect(last).not.toBeNull();
      expect(last!.id).toBe("01ONLY");
    });
  });
});

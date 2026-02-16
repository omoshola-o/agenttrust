import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ensureClaimsDir,
  appendClaim,
  readClaims,
  listClaimFiles,
  getCurrentClaimFilePath,
  getLastClaim,
} from "../../src/ledger/claims-storage.js";
import { createClaim } from "../../src/ledger/claim.js";
import type { CreateClaimInput } from "../../src/ledger/claim.js";
import type { ClaimsStorageConfig } from "../../src/ledger/claims-storage.js";

const testClaimInput: CreateClaimInput = {
  agent: "default",
  session: "ses_test",
  intent: {
    plannedAction: "file.read",
    plannedTarget: "/tmp/test.txt",
    goal: "Read test file",
    expectedOutcome: "success",
    selfAssessedRisk: 1,
  },
  constraints: {
    withinScope: true,
    requiresElevation: false,
    involvesExternalComms: false,
    involvesFinancial: false,
  },
};

describe("claims-storage", () => {
  let testDir: string;
  let config: ClaimsStorageConfig;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "agenttrust-claims-"));
    config = { claimsDir: join(testDir, "claims") };
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("ensureClaimsDir", () => {
    it("creates directory if it does not exist", async () => {
      const result = await ensureClaimsDir(config);
      expect(result.ok).toBe(true);
    });

    it("succeeds if directory already exists", async () => {
      await ensureClaimsDir(config);
      const result = await ensureClaimsDir(config);
      expect(result.ok).toBe(true);
    });
  });

  describe("getCurrentClaimFilePath", () => {
    it("returns path with today's date and .claims.jsonl extension", () => {
      const path = getCurrentClaimFilePath(config);
      const today = new Date().toISOString().slice(0, 10);
      expect(path).toContain(today);
      expect(path.endsWith(".claims.jsonl")).toBe(true);
    });
  });

  describe("appendClaim", () => {
    it("creates file and appends claim", async () => {
      const claim = createClaim(testClaimInput, "");
      const result = await appendClaim(config, claim);
      expect(result.ok).toBe(true);

      const filePath = getCurrentClaimFilePath(config);
      const content = await readFile(filePath, "utf-8");
      expect(content.trim()).toBe(JSON.stringify(claim));
    });

    it("appends multiple claims as separate lines", async () => {
      const claim1 = createClaim(testClaimInput, "");
      const claim2 = createClaim(testClaimInput, claim1.hash);
      await appendClaim(config, claim1);
      await appendClaim(config, claim2);

      const filePath = getCurrentClaimFilePath(config);
      const content = await readFile(filePath, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(2);
    });
  });

  describe("readClaims", () => {
    it("returns empty array for non-existent file", async () => {
      const result = await readClaims(join(testDir, "nonexistent.jsonl"));
      expect(result.ok).toBe(true);
      expect(result.ok && result.value).toEqual([]);
    });

    it("reads and parses claims", async () => {
      const claim = createClaim(testClaimInput, "");
      await appendClaim(config, claim);

      const filePath = getCurrentClaimFilePath(config);
      const result = await readClaims(filePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.id).toBe(claim.id);
      }
    });
  });

  describe("listClaimFiles", () => {
    it("returns empty array when no files exist", async () => {
      await ensureClaimsDir(config);
      const result = await listClaimFiles(config);
      expect(result.ok).toBe(true);
      expect(result.ok && result.value).toEqual([]);
    });

    it("returns sorted file list", async () => {
      const claim = createClaim(testClaimInput, "");
      await appendClaim(config, claim);

      const result = await listClaimFiles(config);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBeGreaterThanOrEqual(1);
        expect(result.value[0]!.endsWith(".claims.jsonl")).toBe(true);
      }
    });
  });

  describe("getLastClaim", () => {
    it("returns null when no claims exist", async () => {
      await ensureClaimsDir(config);
      const result = await getLastClaim(config);
      expect(result).toBeNull();
    });

    it("returns the last claim", async () => {
      const claim1 = createClaim(testClaimInput, "");
      const claim2 = createClaim(testClaimInput, claim1.hash);
      await appendClaim(config, claim1);
      await appendClaim(config, claim2);

      const last = await getLastClaim(config);
      expect(last).not.toBeNull();
      expect(last!.id).toBe(claim2.id);
    });
  });
});

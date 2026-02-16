import { join } from "node:path";
import { homedir } from "node:os";
import { stat } from "node:fs/promises";
import type { CreateEntryInput, ATFEntry } from "./entry.js";
import { createEntry } from "./entry.js";
import type { StorageConfig, StorageResult } from "./storage.js";
import {
  appendToFile,
  readLedgerFile,
  getLastEntry,
  ensureLedgerDir,
} from "./storage.js";
import { verifyAll } from "./integrity.js";
import type { IntegrityReport } from "./integrity.js";
import type { QueryFilters } from "../query/filters.js";
import { applyFilters, getRelevantFiles } from "../query/filters.js";
import { getRiskLevel } from "../schema/risk.js";
import type { ClaimEntry, CreateClaimInput } from "./claim.js";
import { createClaim } from "./claim.js";
import type { ClaimsStorageConfig } from "./claims-storage.js";
import {
  appendClaim as appendClaimToFile,
  readClaims as readClaimFile,
  getLastClaim,
  ensureClaimsDir,
  listClaimFiles,
} from "./claims-storage.js";

export interface LedgerConfig {
  workspacePath?: string;
}

export interface LedgerStats {
  totalEntries: number;
  oldestEntry?: string;
  newestEntry?: string;
  totalFiles: number;
  riskyCounts: { critical: number; high: number; medium: number; low: number };
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export async function resolveWorkspace(hint?: string): Promise<string> {
  if (hint) return hint;

  // Walk up from cwd looking for .agenttrust/ or openclaw.json
  let dir = process.cwd();
  const root = "/";
  while (dir !== root) {
    if (await dirExists(join(dir, ".agenttrust"))) return dir;
    try {
      await stat(join(dir, "openclaw.json"));
      return dir;
    } catch {
      // continue
    }
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }

  // Check ~/.openclaw/workspace/
  const openclawWorkspace = join(homedir(), ".openclaw", "workspace");
  if (await dirExists(openclawWorkspace)) return openclawWorkspace;

  return process.cwd();
}

export class Ledger {
  private cachedLastHash: string | null = null;
  private cachedLastClaimHash: string | null = null;
  private workspaceHint?: string;

  constructor(config: LedgerConfig = {}) {
    this.workspaceHint = config.workspacePath;
  }

  private async getStorageConfig(): Promise<StorageConfig> {
    const workspace = await resolveWorkspace(this.workspaceHint);
    return { ledgerDir: join(workspace, ".agenttrust", "ledger") };
  }

  private async getClaimsStorageConfig(): Promise<ClaimsStorageConfig> {
    const workspace = await resolveWorkspace(this.workspaceHint);
    return { claimsDir: join(workspace, ".agenttrust", "claims") };
  }

  private async getLastHash(config: StorageConfig): Promise<string> {
    if (this.cachedLastHash !== null) return this.cachedLastHash;
    const last = await getLastEntry(config);
    return last?.hash ?? "";
  }

  private async getLastClaimHash(config: ClaimsStorageConfig): Promise<string> {
    if (this.cachedLastClaimHash !== null) return this.cachedLastClaimHash;
    const last = await getLastClaim(config);
    return last?.hash ?? "";
  }

  async init(): Promise<StorageResult<void>> {
    const config = await this.getStorageConfig();
    const ledgerResult = await ensureLedgerDir(config);
    if (!ledgerResult.ok) return ledgerResult;

    const claimsConfig = await this.getClaimsStorageConfig();
    return ensureClaimsDir(claimsConfig);
  }

  async append(input: CreateEntryInput): Promise<StorageResult<ATFEntry>> {
    try {
      const config = await this.getStorageConfig();
      const prevHash = await this.getLastHash(config);
      const entry = createEntry(input, prevHash);
      const result = await appendToFile(config, entry);
      if (result.ok) {
        this.cachedLastHash = entry.hash;
        return { ok: true, value: entry };
      }
      return { ok: false, error: result.error };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async read(filters?: QueryFilters): Promise<StorageResult<ATFEntry[]>> {
    try {
      const config = await this.getStorageConfig();
      const files = await getRelevantFiles(config.ledgerDir, filters?.timeRange);
      const allEntries: ATFEntry[] = [];
      for (const file of files) {
        const result = await readLedgerFile(file);
        if (result.ok) allEntries.push(...result.value);
      }
      const filtered = filters ? applyFilters(allEntries, filters) : allEntries;
      return { ok: true, value: filtered };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async verify(): Promise<IntegrityReport> {
    const config = await this.getStorageConfig();
    return verifyAll(config.ledgerDir);
  }

  async getStats(): Promise<LedgerStats> {
    const config = await this.getStorageConfig();
    const readResult = await this.read();
    const entries = readResult.ok ? readResult.value : [];

    const files = await getRelevantFiles(config.ledgerDir);

    const riskyCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const e of entries) {
      const level = getRiskLevel(e.risk.score);
      riskyCounts[level]++;
    }

    return {
      totalEntries: entries.length,
      oldestEntry: entries[0]?.ts,
      newestEntry: entries[entries.length - 1]?.ts,
      totalFiles: files.length,
      riskyCounts,
    };
  }

  async appendClaim(input: CreateClaimInput): Promise<StorageResult<ClaimEntry>> {
    try {
      const config = await this.getClaimsStorageConfig();
      const prevHash = await this.getLastClaimHash(config);
      const claim = createClaim(input, prevHash);
      const result = await appendClaimToFile(config, claim);
      if (result.ok) {
        this.cachedLastClaimHash = claim.hash;
        return { ok: true, value: claim };
      }
      return { ok: false, error: result.error };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async readClaims(filters?: QueryFilters): Promise<StorageResult<ClaimEntry[]>> {
    try {
      const config = await this.getClaimsStorageConfig();
      const filesResult = await listClaimFiles(config);
      if (!filesResult.ok) return { ok: false, error: filesResult.error };

      let files = filesResult.value;
      if (filters?.timeRange?.from) {
        const fromDate = filters.timeRange.from.toISOString().slice(0, 10);
        const toDate = (filters.timeRange.to ?? new Date()).toISOString().slice(0, 10);
        const dateFiltered = files.filter((filePath) => {
          const name = filePath.split("/").pop() ?? "";
          const fileDate = name.slice(0, 10);
          return fileDate >= fromDate && fileDate <= toDate;
        });
        if (dateFiltered.length > 0) files = dateFiltered;
      }

      const allClaims: ClaimEntry[] = [];
      for (const file of files) {
        const result = await readClaimFile(file);
        if (result.ok) allClaims.push(...result.value);
      }

      let filtered = allClaims;
      if (filters?.timeRange) {
        const from = filters.timeRange.from;
        const to = filters.timeRange.to;
        filtered = filtered.filter((c) => {
          const t = new Date(c.ts).getTime();
          if (from && t < from.getTime()) return false;
          if (to && t > to.getTime()) return false;
          return true;
        });
      }
      if (filters?.agent) {
        filtered = filtered.filter((c) => c.agent === filters.agent);
      }
      if (filters?.session) {
        filtered = filtered.filter((c) => c.session === filters.session);
      }

      return { ok: true, value: filtered };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}

import { appendFile, mkdir, readFile as fsReadFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ClaimEntry } from "./claim.js";
import { parseClaim } from "./claim.js";
import type { StorageResult } from "./storage.js";

export interface ClaimsStorageConfig {
  claimsDir: string;
}

function formatDateUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getCurrentClaimFilePath(config: ClaimsStorageConfig): string {
  return join(config.claimsDir, `${formatDateUTC(new Date())}.claims.jsonl`);
}

export function getClaimFilePathForDate(config: ClaimsStorageConfig, date: Date): string {
  return join(config.claimsDir, `${formatDateUTC(date)}.claims.jsonl`);
}

export async function ensureClaimsDir(config: ClaimsStorageConfig): Promise<StorageResult<void>> {
  try {
    await mkdir(config.claimsDir, { recursive: true, mode: 0o700 });
    return { ok: true, value: undefined };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function appendClaim(
  config: ClaimsStorageConfig,
  claim: ClaimEntry,
): Promise<StorageResult<void>> {
  try {
    const dirResult = await ensureClaimsDir(config);
    if (!dirResult.ok) return dirResult;

    const filePath = getCurrentClaimFilePath(config);
    const line = JSON.stringify(claim) + "\n";
    await appendFile(filePath, line, { mode: 0o600 });
    return { ok: true, value: undefined };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function readClaims(path: string): Promise<StorageResult<ClaimEntry[]>> {
  try {
    const content = await fsReadFile(path, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim() !== "");
    const entries: ClaimEntry[] = [];
    for (const line of lines) {
      const claim = parseClaim(line);
      if (claim) entries.push(claim);
    }
    return { ok: true, value: entries };
  } catch (err) {
    const message = String(err);
    if (message.includes("ENOENT")) {
      return { ok: true, value: [] };
    }
    return { ok: false, error: message };
  }
}

export async function listClaimFiles(config: ClaimsStorageConfig): Promise<StorageResult<string[]>> {
  try {
    const entries = await readdir(config.claimsDir);
    const jsonlFiles = entries
      .filter((f) => f.endsWith(".claims.jsonl"))
      .sort()
      .map((f) => join(config.claimsDir, f));
    return { ok: true, value: jsonlFiles };
  } catch (err) {
    const message = String(err);
    if (message.includes("ENOENT")) {
      return { ok: true, value: [] };
    }
    return { ok: false, error: message };
  }
}

export async function getLastClaim(config: ClaimsStorageConfig): Promise<ClaimEntry | null> {
  const filePath = getCurrentClaimFilePath(config);
  const result = await readClaims(filePath);
  if (!result.ok || result.value.length === 0) return null;
  return result.value[result.value.length - 1]!;
}

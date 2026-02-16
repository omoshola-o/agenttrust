import { appendFile, mkdir, readFile as fsReadFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { WitnessEntry } from "./types.js";
import type { StorageResult } from "../ledger/storage.js";

export interface WitnessStorageConfig {
  witnessDir: string;
}

function formatDateUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getCurrentWitnessFilePath(config: WitnessStorageConfig): string {
  return join(config.witnessDir, `${formatDateUTC(new Date())}.witness.jsonl`);
}

export function getWitnessFilePathForDate(config: WitnessStorageConfig, date: Date): string {
  return join(config.witnessDir, `${formatDateUTC(date)}.witness.jsonl`);
}

export async function ensureWitnessDir(config: WitnessStorageConfig): Promise<StorageResult<void>> {
  try {
    await mkdir(config.witnessDir, { recursive: true, mode: 0o700 });
    return { ok: true, value: undefined };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function appendWitnessEntry(
  config: WitnessStorageConfig,
  entry: WitnessEntry,
): Promise<StorageResult<void>> {
  try {
    const dirResult = await ensureWitnessDir(config);
    if (!dirResult.ok) return dirResult;

    const filePath = getCurrentWitnessFilePath(config);
    const line = JSON.stringify(entry) + "\n";
    await appendFile(filePath, line, { mode: 0o600 });
    return { ok: true, value: undefined };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Parse a single line of JSONL into a WitnessEntry.
 * Returns null if parsing fails.
 */
export function parseWitnessEntry(line: string): WitnessEntry | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;
    if (
      typeof obj["id"] !== "string" ||
      typeof obj["ts"] !== "string" ||
      typeof obj["prevHash"] !== "string" ||
      typeof obj["hash"] !== "string" ||
      typeof obj["source"] !== "string" ||
      typeof obj["event"] !== "object" ||
      obj["event"] === null
    ) {
      return null;
    }
    return obj as unknown as WitnessEntry;
  } catch {
    return null;
  }
}

export async function readWitnessEntries(path: string): Promise<StorageResult<WitnessEntry[]>> {
  try {
    const content = await fsReadFile(path, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim() !== "");
    const entries: WitnessEntry[] = [];
    for (const line of lines) {
      const entry = parseWitnessEntry(line);
      if (entry) entries.push(entry);
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

export async function listWitnessFiles(config: WitnessStorageConfig): Promise<StorageResult<string[]>> {
  try {
    const entries = await readdir(config.witnessDir);
    const jsonlFiles = entries
      .filter((f) => f.endsWith(".witness.jsonl"))
      .sort()
      .map((f) => join(config.witnessDir, f));
    return { ok: true, value: jsonlFiles };
  } catch (err) {
    const message = String(err);
    if (message.includes("ENOENT")) {
      return { ok: true, value: [] };
    }
    return { ok: false, error: message };
  }
}

export async function getLastWitnessEntry(config: WitnessStorageConfig): Promise<WitnessEntry | null> {
  const filePath = getCurrentWitnessFilePath(config);
  const result = await readWitnessEntries(filePath);
  if (!result.ok || result.value.length === 0) return null;
  return result.value[result.value.length - 1]!;
}

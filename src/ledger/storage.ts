import { appendFile, mkdir, readFile as fsReadFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ATFEntry } from "./entry.js";
import { parseEntry } from "./entry.js";

export interface StorageConfig {
  ledgerDir: string;
}

export type StorageResult<T> = { ok: true; value: T } | { ok: false; error: string };

function formatDateUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getCurrentFilePath(config: StorageConfig): string {
  return join(config.ledgerDir, `${formatDateUTC(new Date())}.agenttrust.jsonl`);
}

export function getFilePathForDate(config: StorageConfig, date: Date): string {
  return join(config.ledgerDir, `${formatDateUTC(date)}.agenttrust.jsonl`);
}

export async function ensureLedgerDir(config: StorageConfig): Promise<StorageResult<void>> {
  try {
    await mkdir(config.ledgerDir, { recursive: true, mode: 0o700 });
    return { ok: true, value: undefined };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function appendToFile(
  config: StorageConfig,
  entry: ATFEntry,
): Promise<StorageResult<void>> {
  try {
    const dirResult = await ensureLedgerDir(config);
    if (!dirResult.ok) return dirResult;

    const filePath = getCurrentFilePath(config);
    const line = JSON.stringify(entry) + "\n";
    await appendFile(filePath, line, { mode: 0o600 });
    return { ok: true, value: undefined };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function readLedgerFile(path: string): Promise<StorageResult<ATFEntry[]>> {
  try {
    const content = await fsReadFile(path, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim() !== "");
    const entries: ATFEntry[] = [];
    for (const line of lines) {
      const entry = parseEntry(line);
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

export async function listLedgerFiles(config: StorageConfig): Promise<StorageResult<string[]>> {
  try {
    const entries = await readdir(config.ledgerDir);
    const jsonlFiles = entries
      .filter((f) => f.endsWith(".agenttrust.jsonl"))
      .sort()
      .map((f) => join(config.ledgerDir, f));
    return { ok: true, value: jsonlFiles };
  } catch (err) {
    const message = String(err);
    if (message.includes("ENOENT")) {
      return { ok: true, value: [] };
    }
    return { ok: false, error: message };
  }
}

export async function getLastEntry(config: StorageConfig): Promise<ATFEntry | null> {
  const filePath = getCurrentFilePath(config);
  const result = await readLedgerFile(filePath);
  if (!result.ok || result.value.length === 0) return null;
  return result.value[result.value.length - 1]!;
}

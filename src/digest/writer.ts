import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { DigestConfig } from "./types.js";

function formatDateUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/**
 * Get the file path for a digest.
 */
export function getDigestPath(
  config: DigestConfig,
  type: "daily" | "weekly",
  date: Date,
): string {
  if (type === "daily") {
    return join(config.outputDir, `${formatDateUTC(date)}-daily.md`);
  }
  const year = date.getUTCFullYear();
  const week = getWeekNumber(date);
  return join(config.outputDir, `${year}-W${String(week).padStart(2, "0")}-weekly.md`);
}

/**
 * Write a digest file to the workspace.
 */
export async function writeDigest(
  config: DigestConfig,
  content: string,
  filename: string,
): Promise<void> {
  await mkdir(config.outputDir, { recursive: true });
  const filePath = join(config.outputDir, filename);
  await writeFile(filePath, content, "utf-8");
}

/**
 * Write a digest file using the standard path convention.
 */
export async function writeDigestForDate(
  config: DigestConfig,
  content: string,
  type: "daily" | "weekly",
  date: Date,
): Promise<string> {
  await mkdir(config.outputDir, { recursive: true });
  const filePath = getDigestPath(config, type, date);
  await writeFile(filePath, content, "utf-8");
  return filePath;
}

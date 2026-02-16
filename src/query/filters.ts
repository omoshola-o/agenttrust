import type { ATFEntry } from "../ledger/entry.js";
import type { ActionType } from "../schema/action-types.js";
import type { RiskLabel } from "../schema/risk.js";
import { listLedgerFiles } from "../ledger/storage.js";
import { basename } from "node:path";

export interface TimeRange {
  from?: Date;
  to?: Date;
}

export interface QueryFilters {
  timeRange?: TimeRange;
  actionTypes?: ActionType[];
  riskScoreMin?: number;
  riskScoreMax?: number;
  agent?: string;
  session?: string;
  riskLabels?: RiskLabel[];
}

const TIME_PATTERN = /^(\d+)(h|d|w)$/;

export function parseTimeRange(input: string): TimeRange | null {
  const match = TIME_PATTERN.exec(input);
  if (!match) return null;

  const amount = parseInt(match[1]!, 10);
  const unit = match[2]!;

  const now = new Date();
  let ms: number;

  switch (unit) {
    case "h":
      ms = amount * 60 * 60 * 1000;
      break;
    case "d":
      ms = amount * 24 * 60 * 60 * 1000;
      break;
    case "w":
      ms = amount * 7 * 24 * 60 * 60 * 1000;
      break;
    default:
      return null;
  }

  return { from: new Date(now.getTime() - ms), to: now };
}

export function applyFilters(entries: readonly ATFEntry[], filters: QueryFilters): ATFEntry[] {
  let result = [...entries];

  if (filters.timeRange) {
    const { from, to } = filters.timeRange;
    result = result.filter((e) => {
      const ts = new Date(e.ts);
      if (from && ts < from) return false;
      if (to && ts > to) return false;
      return true;
    });
  }

  if (filters.actionTypes && filters.actionTypes.length > 0) {
    const typeSet = new Set(filters.actionTypes);
    result = result.filter((e) => typeSet.has(e.action.type));
  }

  if (filters.riskScoreMin !== undefined) {
    result = result.filter((e) => e.risk.score >= filters.riskScoreMin!);
  }

  if (filters.riskScoreMax !== undefined) {
    result = result.filter((e) => e.risk.score <= filters.riskScoreMax!);
  }

  if (filters.agent) {
    result = result.filter((e) => e.agent === filters.agent);
  }

  if (filters.session) {
    result = result.filter((e) => e.session === filters.session);
  }

  if (filters.riskLabels && filters.riskLabels.length > 0) {
    const labelSet = new Set(filters.riskLabels);
    result = result.filter((e) => e.risk.labels.some((l) => labelSet.has(l)));
  }

  return result;
}

export async function getRelevantFiles(
  ledgerDir: string,
  timeRange?: TimeRange,
): Promise<string[]> {
  const filesResult = await listLedgerFiles({ ledgerDir });
  if (!filesResult.ok) return [];

  if (!timeRange?.from) return filesResult.value;

  const fromDate = timeRange.from.toISOString().slice(0, 10);
  const toDate = (timeRange.to ?? new Date()).toISOString().slice(0, 10);

  return filesResult.value.filter((filePath) => {
    const name = basename(filePath);
    const fileDate = name.slice(0, 10);
    return fileDate >= fromDate && fileDate <= toDate;
  });
}

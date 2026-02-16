export type OutcomeStatus = "success" | "failure" | "partial" | "blocked";

const OUTCOME_STATUSES: ReadonlySet<string> = new Set([
  "success",
  "failure",
  "partial",
  "blocked",
]);

export interface ActionOutcome {
  status: OutcomeStatus;
  detail?: string;
  durationMs?: number;
}

export function validateOutcome(outcome: unknown): outcome is ActionOutcome {
  if (typeof outcome !== "object" || outcome === null) return false;
  const obj = outcome as Record<string, unknown>;
  if (typeof obj["status"] !== "string" || !OUTCOME_STATUSES.has(obj["status"])) return false;
  if ("detail" in obj && typeof obj["detail"] !== "string") return false;
  if ("durationMs" in obj && typeof obj["durationMs"] !== "number") return false;
  return true;
}

export type RiskLabel =
  | "financial"
  | "data_access"
  | "communication"
  | "escalation"
  | "execution"
  | "unknown_target"
  | "high_frequency";

export const RISK_LABELS: readonly RiskLabel[] = [
  "financial",
  "data_access",
  "communication",
  "escalation",
  "execution",
  "unknown_target",
  "high_frequency",
] as const;

const riskLabelSet = new Set<string>(RISK_LABELS);

export interface RiskAssessment {
  score: number;
  labels: RiskLabel[];
  autoFlagged: boolean;
}

export function validateRisk(risk: unknown): risk is RiskAssessment {
  if (typeof risk !== "object" || risk === null) return false;
  const obj = risk as Record<string, unknown>;
  if (typeof obj["score"] !== "number" || obj["score"] < 0 || obj["score"] > 10) return false;
  if (!Array.isArray(obj["labels"])) return false;
  for (const label of obj["labels"] as unknown[]) {
    if (typeof label !== "string" || !riskLabelSet.has(label)) return false;
  }
  if (typeof obj["autoFlagged"] !== "boolean") return false;
  return true;
}

export function getRiskLevel(score: number): "low" | "medium" | "high" | "critical" {
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

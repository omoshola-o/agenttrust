import { ulid } from "ulid";
import type { ActionType } from "../schema/action-types.js";
import { isActionType } from "../schema/action-types.js";
import { hashEntry } from "./hash-chain.js";

export interface ClaimIntent {
  plannedAction: ActionType;
  plannedTarget: string;
  goal: string;
  expectedOutcome: "success" | "partial" | "unknown";
  selfAssessedRisk: number;
}

export interface ClaimConstraints {
  withinScope: boolean;
  requiresElevation: boolean;
  involvesExternalComms: boolean;
  involvesFinancial: boolean;
}

export interface ClaimExecution {
  executionEntryId?: string;
}

export interface ClaimEntry {
  id: string;
  v: 1;
  ts: string;
  prevHash: string;
  hash: string;
  agent: string;
  session: string;
  intent: ClaimIntent;
  constraints: ClaimConstraints;
  execution?: ClaimExecution;
  meta?: Record<string, unknown>;
}

export interface CreateClaimInput {
  agent: string;
  session: string;
  intent: ClaimIntent;
  constraints: ClaimConstraints;
  execution?: ClaimExecution;
  meta?: Record<string, unknown>;
}

export function createClaim(input: CreateClaimInput, prevHash: string): ClaimEntry {
  const partial: Omit<ClaimEntry, "hash"> = {
    id: ulid(),
    v: 1,
    ts: new Date().toISOString(),
    prevHash,
    agent: input.agent,
    session: input.session,
    intent: input.intent,
    constraints: input.constraints,
    ...(input.execution !== undefined ? { execution: input.execution } : {}),
    ...(input.meta !== undefined ? { meta: input.meta } : {}),
  };

  const hash = hashEntry(partial as Record<string, unknown>);
  return { ...partial, hash };
}

const EXPECTED_OUTCOMES = new Set(["success", "partial", "unknown"]);

export function validateClaim(entry: unknown): entry is ClaimEntry {
  if (typeof entry !== "object" || entry === null) return false;
  const obj = entry as Record<string, unknown>;

  if (typeof obj["id"] !== "string" || obj["id"] === "") return false;
  if (obj["v"] !== 1) return false;
  if (typeof obj["ts"] !== "string") return false;
  if (typeof obj["prevHash"] !== "string") return false;
  if (typeof obj["hash"] !== "string" || obj["hash"] === "") return false;
  if (typeof obj["agent"] !== "string" || obj["agent"] === "") return false;
  if (typeof obj["session"] !== "string" || obj["session"] === "") return false;

  const intent = obj["intent"];
  if (typeof intent !== "object" || intent === null) return false;
  const i = intent as Record<string, unknown>;
  if (typeof i["plannedAction"] !== "string" || !isActionType(i["plannedAction"])) return false;
  if (typeof i["plannedTarget"] !== "string") return false;
  if (typeof i["goal"] !== "string" || i["goal"] === "") return false;
  if (typeof i["expectedOutcome"] !== "string" || !EXPECTED_OUTCOMES.has(i["expectedOutcome"])) return false;
  if (typeof i["selfAssessedRisk"] !== "number" || i["selfAssessedRisk"] < 0 || i["selfAssessedRisk"] > 10)
    return false;

  const constraints = obj["constraints"];
  if (typeof constraints !== "object" || constraints === null) return false;
  const c = constraints as Record<string, unknown>;
  if (typeof c["withinScope"] !== "boolean") return false;
  if (typeof c["requiresElevation"] !== "boolean") return false;
  if (typeof c["involvesExternalComms"] !== "boolean") return false;
  if (typeof c["involvesFinancial"] !== "boolean") return false;

  return true;
}

export function parseClaim(line: string): ClaimEntry | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (validateClaim(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

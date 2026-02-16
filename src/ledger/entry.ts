import { ulid } from "ulid";
import type { ActionType } from "../schema/action-types.js";
import { isActionType } from "../schema/action-types.js";
import type { ActionContext } from "../schema/context.js";
import { validateContext } from "../schema/context.js";
import type { ActionOutcome } from "../schema/outcome.js";
import { validateOutcome } from "../schema/outcome.js";
import type { RiskAssessment } from "../schema/risk.js";
import { validateRisk } from "../schema/risk.js";
import { hashEntry } from "./hash-chain.js";

export interface ATFEntry {
  id: string;
  v: 1;
  ts: string;
  prevHash: string;
  hash: string;
  agent: string;
  session: string;
  action: {
    type: ActionType;
    target: string;
    detail: string;
  };
  context: ActionContext;
  outcome: ActionOutcome;
  risk: RiskAssessment;
  meta?: Record<string, unknown>;
}

export interface CreateEntryInput {
  agent: string;
  session: string;
  action: {
    type: ActionType;
    target: string;
    detail: string;
  };
  context: ActionContext;
  outcome: ActionOutcome;
  risk: RiskAssessment;
  meta?: Record<string, unknown>;
}

export function createEntry(input: CreateEntryInput, prevHash: string): ATFEntry {
  const partial: Omit<ATFEntry, "hash"> = {
    id: ulid(),
    v: 1,
    ts: new Date().toISOString(),
    prevHash,
    agent: input.agent,
    session: input.session,
    action: input.action,
    context: input.context,
    outcome: input.outcome,
    risk: input.risk,
    ...(input.meta !== undefined ? { meta: input.meta } : {}),
  };

  const hash = hashEntry(partial as Record<string, unknown>);
  return { ...partial, hash };
}

export function validateEntry(entry: unknown): entry is ATFEntry {
  if (typeof entry !== "object" || entry === null) return false;
  const obj = entry as Record<string, unknown>;

  if (typeof obj["id"] !== "string" || obj["id"] === "") return false;
  if (obj["v"] !== 1) return false;
  if (typeof obj["ts"] !== "string") return false;
  if (typeof obj["prevHash"] !== "string") return false;
  if (typeof obj["hash"] !== "string" || obj["hash"] === "") return false;
  if (typeof obj["agent"] !== "string" || obj["agent"] === "") return false;
  if (typeof obj["session"] !== "string" || obj["session"] === "") return false;

  const action = obj["action"];
  if (typeof action !== "object" || action === null) return false;
  const act = action as Record<string, unknown>;
  if (typeof act["type"] !== "string" || !isActionType(act["type"])) return false;
  if (typeof act["target"] !== "string") return false;
  if (typeof act["detail"] !== "string") return false;

  if (!validateContext(obj["context"])) return false;
  if (!validateOutcome(obj["outcome"])) return false;
  if (!validateRisk(obj["risk"])) return false;

  return true;
}

export function parseEntry(line: string): ATFEntry | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (validateEntry(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

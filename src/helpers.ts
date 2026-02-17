/**
 * High-level helper functions for agent integration.
 *
 * These wrap the core Ledger API into simple one-liners so agents
 * can log actions and declare intent without constructing full entry objects.
 */

import { Ledger } from "./ledger/ledger.js";
import type { ATFEntry, CreateEntryInput } from "./ledger/entry.js";
import type { ActionType } from "./schema/action-types.js";
import type { RiskLabel } from "./schema/risk.js";
import type { OutcomeStatus } from "./schema/outcome.js";
import type { ClaimEntry } from "./ledger/claim.js";
import type { StorageResult } from "./ledger/storage.js";

// ─── Shared singleton ─────────────────────────────────────────────

let _defaultLedger: Ledger | null = null;

/**
 * Returns a shared Ledger instance. Creates one on first call.
 * Use `setDefaultLedger()` to override with a custom instance.
 */
export function getDefaultLedger(): Ledger {
  if (!_defaultLedger) {
    _defaultLedger = new Ledger();
  }
  return _defaultLedger;
}

/**
 * Replace the default Ledger instance (e.g. to point at a custom workspace).
 */
export function setDefaultLedger(ledger: Ledger): void {
  _defaultLedger = ledger;
}

/**
 * Reset the default Ledger (mainly for testing).
 */
export function resetDefaultLedger(): void {
  _defaultLedger = null;
}

// ─── logAction ─────────────────────────────────────────────────────

/** Minimal input for the logAction helper. */
export interface LogActionInput {
  /** Action type from the taxonomy (e.g. "file.read", "api.call") */
  type: ActionType;
  /** What was acted upon (file path, URL, etc.) */
  target: string;
  /** Human-readable description of what happened */
  detail: string;

  // ── Optional fields (sensible defaults applied) ──

  /** Outcome status. Default: "success" */
  status?: OutcomeStatus;
  /** How long the action took in ms */
  durationMs?: number;
  /** Outcome detail */
  outcomeDetail?: string;

  /** Risk score 0–10. Default: 0 */
  risk?: number;
  /** Risk labels. Default: [] */
  riskLabels?: RiskLabel[];

  /** Why the agent did it. Default: "Agent action" */
  goal?: string;
  /** What triggered it. Default: "chain" */
  trigger?: string;
  /** ULID of parent action if chained */
  parentAction?: string;

  /** Agent identifier. Default: "default" */
  agent?: string;
  /** Session identifier. Default: "default" */
  session?: string;

  /** Extensible metadata */
  meta?: Record<string, unknown>;
}

/**
 * Log a single agent action to the AgentTrust ledger.
 *
 * This is the primary integration point for agent frameworks.
 * Provide the essentials (type, target, detail) and let defaults
 * handle the rest.
 *
 * @example
 * ```ts
 * import { logAction } from "agenttrust";
 *
 * await logAction({
 *   type: "file.read",
 *   target: "/etc/hosts",
 *   detail: "Read hosts file for DNS lookup",
 * });
 * ```
 *
 * @example
 * ```ts
 * await logAction({
 *   type: "api.call",
 *   target: "https://api.openai.com/v1/chat",
 *   detail: "Called GPT-4 for summarization",
 *   risk: 2,
 *   riskLabels: ["communication"],
 *   goal: "Summarize user document",
 *   durationMs: 1340,
 * });
 * ```
 */
export async function logAction(
  input: LogActionInput,
  ledger?: Ledger,
): Promise<StorageResult<ATFEntry>> {
  const l = ledger ?? getDefaultLedger();

  const riskScore = input.risk ?? 0;
  const riskLabels = input.riskLabels ?? [];
  const autoFlagged = riskScore >= 7;

  const entry: CreateEntryInput = {
    agent: input.agent ?? "default",
    session: input.session ?? "default",
    action: {
      type: input.type,
      target: input.target,
      detail: input.detail,
    },
    context: {
      goal: input.goal ?? "Agent action",
      trigger: input.trigger ?? "chain",
      ...(input.parentAction ? { parentAction: input.parentAction } : {}),
    },
    outcome: {
      status: input.status ?? "success",
      ...(input.outcomeDetail ? { detail: input.outcomeDetail } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    },
    risk: {
      score: riskScore,
      labels: riskLabels,
      autoFlagged,
    },
    ...(input.meta ? { meta: input.meta } : {}),
  };

  return l.append(entry);
}

// ─── declareIntent ─────────────────────────────────────────────────

/** Minimal input for the declareIntent helper. */
export interface DeclareIntentInput {
  /** What the agent plans to do (action type) */
  type: ActionType;
  /** What will be acted upon */
  target: string;
  /** Why the agent is doing it */
  goal: string;

  // ── Optional ──

  /** Expected outcome. Default: "success" */
  expectedOutcome?: "success" | "partial" | "unknown";
  /** Self-assessed risk 0–10. Default: 0 */
  risk?: number;

  /** Does this action stay within scope? Default: true */
  withinScope?: boolean;
  /** Does it require elevated privileges? Default: false */
  requiresElevation?: boolean;
  /** Does it involve external communication? Default: false */
  involvesExternalComms?: boolean;
  /** Does it involve financial transactions? Default: false */
  involvesFinancial?: boolean;

  /** Agent identifier. Default: "default" */
  agent?: string;
  /** Session identifier. Default: "default" */
  session?: string;

  /** Extensible metadata */
  meta?: Record<string, unknown>;
}

/**
 * Declare what the agent intends to do before doing it.
 *
 * Claims are logged to a separate hash-chained ledger so the
 * consistency engine can later compare intent vs. execution.
 *
 * @example
 * ```ts
 * import { declareIntent } from "agenttrust";
 *
 * const claim = await declareIntent({
 *   type: "exec.command",
 *   target: "npm install express",
 *   goal: "Install HTTP framework for the user's project",
 * });
 *
 * // Now perform the action, then log it:
 * await logAction({
 *   type: "exec.command",
 *   target: "npm install express",
 *   detail: "Installed express v4.18.2",
 *   meta: { claimId: claim.value?.id },
 * });
 * ```
 */
export async function declareIntent(
  input: DeclareIntentInput,
  ledger?: Ledger,
): Promise<StorageResult<ClaimEntry>> {
  const l = ledger ?? getDefaultLedger();

  return l.appendClaim({
    agent: input.agent ?? "default",
    session: input.session ?? "default",
    intent: {
      plannedAction: input.type,
      plannedTarget: input.target,
      goal: input.goal,
      expectedOutcome: input.expectedOutcome ?? "success",
      selfAssessedRisk: input.risk ?? 0,
    },
    constraints: {
      withinScope: input.withinScope ?? true,
      requiresElevation: input.requiresElevation ?? false,
      involvesExternalComms: input.involvesExternalComms ?? false,
      involvesFinancial: input.involvesFinancial ?? false,
    },
    ...(input.meta ? { meta: input.meta } : {}),
  });
}

// ─── Convenience wrappers ──────────────────────────────────────────

/**
 * Initialize the AgentTrust workspace. Call once at agent startup.
 * Creates `.agenttrust/ledger/` and `.agenttrust/claims/` directories.
 */
export async function initWorkspace(workspacePath?: string): Promise<StorageResult<void>> {
  const ledger = workspacePath ? new Ledger({ workspacePath }) : getDefaultLedger();
  if (workspacePath) setDefaultLedger(ledger);
  return ledger.init();
}

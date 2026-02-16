import type { ClaimEntry } from "../ledger/claim.js";
import type { ATFEntry } from "../ledger/entry.js";
import type { ConsistencyFinding, FindingSeverity, MatchResult } from "./types.js";

export function detectDivergences(matches: readonly MatchResult[]): ConsistencyFinding[] {
  const findings: ConsistencyFinding[] = [];

  for (const match of matches) {
    if (match.matchType === "unmatched") {
      if (match.execution && !match.claim) {
        findings.push(detectUnclaimedExecution(match.execution));
      }
      if (match.claim && !match.execution) {
        findings.push(detectUnfulfilledClaim(match.claim));
      }
      continue;
    }

    if (match.claim && match.execution) {
      const pairFindings = detectPairDivergences(match.claim, match.execution);
      findings.push(...pairFindings);
    }
  }

  return findings;
}

function detectUnclaimedExecution(exec: ATFEntry): ConsistencyFinding {
  const severity: FindingSeverity = exec.risk.score < 3 ? "info" : "warning";
  return {
    type: "unclaimed_execution",
    severity,
    description: `Agent executed "${exec.action.type}: ${exec.action.target}" with no prior claim`,
    execution: exec,
    details: {
      actionType: exec.action.type,
      target: exec.action.target,
      riskScore: exec.risk.score,
    },
  };
}

function detectUnfulfilledClaim(claim: ClaimEntry): ConsistencyFinding {
  return {
    type: "unfulfilled_claim",
    severity: "warning",
    description: `Agent claimed "${claim.intent.plannedAction}: ${claim.intent.plannedTarget}" but never acted`,
    claim,
    details: {
      plannedAction: claim.intent.plannedAction,
      plannedTarget: claim.intent.plannedTarget,
      goal: claim.intent.goal,
    },
  };
}

function detectPairDivergences(claim: ClaimEntry, exec: ATFEntry): ConsistencyFinding[] {
  const findings: ConsistencyFinding[] = [];

  // Target mismatch
  if (claim.intent.plannedTarget !== exec.action.target) {
    const severity: FindingSeverity = exec.risk.score >= 7 ? "critical" : "warning";
    findings.push({
      type: "target_mismatch",
      severity,
      description: `Claimed target "${claim.intent.plannedTarget}" but executed on "${exec.action.target}"`,
      claim,
      execution: exec,
      details: {
        claimedTarget: claim.intent.plannedTarget,
        actualTarget: exec.action.target,
      },
    });
  }

  // Action type mismatch
  if (claim.intent.plannedAction !== exec.action.type) {
    findings.push({
      type: "action_type_mismatch",
      severity: "critical",
      description: `Claimed action "${claim.intent.plannedAction}" but executed "${exec.action.type}"`,
      claim,
      execution: exec,
      details: {
        claimedAction: claim.intent.plannedAction,
        actualAction: exec.action.type,
      },
    });
  }

  // Risk underestimate (3+ points difference)
  if (exec.risk.score - claim.intent.selfAssessedRisk >= 3) {
    findings.push({
      type: "risk_underestimate",
      severity: "warning",
      description: `Agent self-assessed risk ${claim.intent.selfAssessedRisk}, actual risk was ${exec.risk.score}`,
      claim,
      execution: exec,
      details: {
        selfAssessedRisk: claim.intent.selfAssessedRisk,
        actualRisk: exec.risk.score,
        difference: exec.risk.score - claim.intent.selfAssessedRisk,
      },
    });
  }

  // Scope violation
  if (claim.constraints.withinScope) {
    const scopeViolatingTypes = new Set([
      "elevated.enable",
      "elevated.command",
      "payment.initiate",
      "payment.confirm",
    ]);
    const isExternalComms = exec.action.type === "message.send" || exec.action.type === "session.send";

    if (scopeViolatingTypes.has(exec.action.type) || (isExternalComms && !claim.constraints.involvesExternalComms)) {
      findings.push({
        type: "scope_violation",
        severity: "critical",
        description: `Agent claimed within-scope but performed ${exec.action.type}`,
        claim,
        execution: exec,
        details: {
          claimedWithinScope: true,
          actualActionType: exec.action.type,
        },
      });
    }
  }

  // Escalation undeclared
  if (
    !claim.constraints.requiresElevation &&
    (exec.action.type === "elevated.enable" || exec.action.type === "elevated.command")
  ) {
    findings.push({
      type: "escalation_undeclared",
      severity: "critical",
      description: `Agent didn't claim elevation but used ${exec.action.type}`,
      claim,
      execution: exec,
      details: {
        claimedElevation: false,
        actualActionType: exec.action.type,
      },
    });
  }

  // Outcome unexpected
  if (
    claim.intent.expectedOutcome === "success" &&
    (exec.outcome.status === "failure" || exec.outcome.status === "blocked")
  ) {
    findings.push({
      type: "outcome_unexpected",
      severity: "info",
      description: `Expected ${claim.intent.expectedOutcome}, got ${exec.outcome.status}`,
      claim,
      execution: exec,
      details: {
        expectedOutcome: claim.intent.expectedOutcome,
        actualOutcome: exec.outcome.status,
      },
    });
  }

  return findings;
}

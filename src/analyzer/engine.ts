import type { ATFEntry } from "../ledger/entry.js";
import type { ClaimEntry } from "../ledger/claim.js";
import type {
  RiskRule,
  RuleContext,
  RuleMatch,
  RuleEngineConfig,
  EvaluationReport,
  RuleSeverity,
} from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";
import { getAllBuiltinRules } from "./rules/index.js";

export class RuleEngine {
  private rules: RiskRule[];
  private config: RuleEngineConfig;

  constructor(rules?: RiskRule[], config?: Partial<RuleEngineConfig>) {
    this.rules = rules ?? getAllBuiltinRules();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getConfig(): RuleEngineConfig {
    return { ...this.config };
  }

  getEnabledRules(): RiskRule[] {
    return this.rules.filter((rule) => {
      const override = this.config.ruleOverrides[rule.id];
      if (override !== undefined) return override;
      return rule.enabledByDefault;
    });
  }

  getAllRules(): RiskRule[] {
    return [...this.rules];
  }

  isRuleEnabled(ruleId: string): boolean {
    const rule = this.rules.find((r) => r.id === ruleId);
    if (!rule) return false;
    const override = this.config.ruleOverrides[rule.id];
    if (override !== undefined) return override;
    return rule.enabledByDefault;
  }

  evaluate(entry: ATFEntry, context: RuleContext): RuleMatch[] {
    const enabledRules = this.getEnabledRules();
    const matches: RuleMatch[] = [];
    for (const rule of enabledRules) {
      try {
        const match = rule.evaluate(entry, context);
        if (match) matches.push(match);
      } catch {
        // Rule errors are non-fatal
      }
    }
    return matches;
  }

  evaluateBatch(
    entries: ATFEntry[],
    claims?: ClaimEntry[],
  ): EvaluationReport {
    const matchesBySeverity: Record<RuleSeverity, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };
    const matchesByCategory: Record<string, number> = {};
    const matches: Array<{ entry: ATFEntry; ruleMatches: RuleMatch[] }> = [];
    let totalMatches = 0;

    const knownTargets = new Set<string>();
    const claimMap = new Map<string, ClaimEntry>();
    if (claims) {
      for (const c of claims) {
        claimMap.set(c.id, c);
      }
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const sessionHistory = entries.slice(0, i + 1).filter((e) => e.session === entry.session);
      const entryTime = new Date(entry.ts).getTime();
      const oneHourAgo = entryTime - 3_600_000;
      const recentEntries = entries.slice(0, i + 1).filter((e) => {
        const t = new Date(e.ts).getTime();
        return t >= oneHourAgo && t <= entryTime;
      });

      let pairedClaim: ClaimEntry | undefined;
      const claimId = (entry.meta as Record<string, unknown> | undefined)?.["claimId"];
      if (typeof claimId === "string") {
        pairedClaim = claimMap.get(claimId);
      }

      const context: RuleContext = {
        sessionHistory,
        pairedClaim,
        recentEntries,
        knownTargets: new Set(knownTargets),
        config: this.config,
      };

      const ruleMatches = this.evaluate(entry, context);
      if (ruleMatches.length > 0) {
        matches.push({ entry, ruleMatches });
        totalMatches += ruleMatches.length;
        for (const m of ruleMatches) {
          matchesBySeverity[m.severity]++;
          const rule = this.rules.find((r) => r.id === m.ruleId);
          if (rule) {
            matchesByCategory[rule.category] = (matchesByCategory[rule.category] ?? 0) + 1;
          }
        }
      }

      // Track known targets for future entries
      knownTargets.add(entry.action.target);
    }

    return {
      entriesEvaluated: entries.length,
      totalMatches,
      matchesBySeverity,
      matchesByCategory,
      matches,
    };
  }

  updateConfig(config: Partial<RuleEngineConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

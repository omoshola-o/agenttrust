import { describe, it, expect, beforeAll } from "vitest";
import chalk from "chalk";
import {
  renderBar,
  colorizeScore,
  renderHealthStatus,
} from "../../cli/formatters/color.js";
import {
  renderHeader,
  renderTrustSection,
  renderActivitySection,
  renderHealthSection,
  renderFindingsFooter,
  renderGettingStarted,
  renderNoWorkspace,
  formatStatusDashboard,
  formatStatusJson,
} from "../../cli/formatters/dashboard.js";
import type { StatusData } from "../../cli/formatters/dashboard.js";
import type { TrustVerdict, TrustLevel } from "../../src/correlation/types.js";

beforeAll(() => {
  chalk.level = 0;
});

// ─── Helpers ─────────────────────────────────────────────────────

function makeVerdict(overrides: Partial<TrustVerdict> = {}): TrustVerdict {
  return {
    trustScore: 87,
    level: "high" as TrustLevel,
    components: {
      integrity: 100,
      consistency: 85,
      witnessConfidence: 78,
    },
    ...overrides,
  };
}

function makeData(overrides: Partial<StatusData> = {}): StatusData {
  return {
    workspace: "/home/user/.openclaw/workspace",
    trust: makeVerdict(),
    activity: {
      total: 47,
      critical: 0,
      high: 2,
      medium: 8,
      low: 37,
      period: "24h",
    },
    health: {
      workspaceValid: true,
      ledgerFiles: 12,
      ledgerEntries: 1847,
      chainIntact: true,
      claimFiles: 3,
      claimCount: 92,
      witnessFiles: 5,
      witnessEventsToday: 234,
    },
    lastVerified: "2026-02-16T14:32:00.000Z",
    findingsCount: 1,
    findingsSummary: "2 high-risk actions detected in last 24h",
    ...overrides,
  };
}

// ─── renderBar ───────────────────────────────────────────────────

describe("renderBar", () => {
  it("renders full bar for 100", () => {
    const bar = renderBar(100);
    expect(bar).toContain("\u2588".repeat(25));
    expect(bar).not.toContain("\u2591");
  });

  it("renders empty bar for 0", () => {
    const bar = renderBar(0);
    expect(bar).toContain("\u2591".repeat(25));
    expect(bar).not.toContain("\u2588");
  });

  it("renders mixed bar for 50", () => {
    const bar = renderBar(50);
    // 50% of 25 = 12.5 → rounds to 13 filled
    expect(bar).toContain("\u2588");
    expect(bar).toContain("\u2591");
  });

  it("respects custom width", () => {
    const bar = renderBar(100, 10);
    expect(bar).toContain("\u2588".repeat(10));
  });

  it("clamps values above 100", () => {
    const bar = renderBar(150);
    expect(bar).toContain("\u2588".repeat(25));
  });

  it("clamps values below 0", () => {
    const bar = renderBar(-10);
    expect(bar).toContain("\u2591".repeat(25));
  });
});

// ─── colorizeScore ───────────────────────────────────────────────

describe("colorizeScore", () => {
  it("returns text for score >= 90 (green threshold)", () => {
    const result = colorizeScore(95, "95");
    expect(result).toContain("95");
  });

  it("returns text for score >= 70 (blue threshold)", () => {
    const result = colorizeScore(75, "75");
    expect(result).toContain("75");
  });

  it("returns text for score >= 50 (yellow threshold)", () => {
    const result = colorizeScore(55, "55");
    expect(result).toContain("55");
  });

  it("returns text for score < 50 (red threshold)", () => {
    const result = colorizeScore(30, "30");
    expect(result).toContain("30");
  });

  it("handles boundary at 90", () => {
    const result = colorizeScore(90, "90/100");
    expect(result).toContain("90/100");
  });

  it("handles boundary at 70", () => {
    const result = colorizeScore(70, "70/100");
    expect(result).toContain("70/100");
  });
});

// ─── renderHealthStatus ──────────────────────────────────────────

describe("renderHealthStatus", () => {
  it("renders 'ok'", () => {
    expect(renderHealthStatus("ok")).toContain("ok");
  });

  it("renders 'warn'", () => {
    expect(renderHealthStatus("warn")).toContain("warn");
  });

  it("renders 'fail'", () => {
    expect(renderHealthStatus("fail")).toContain("fail");
  });

  it("renders '--' for none", () => {
    expect(renderHealthStatus("none")).toContain("--");
  });
});

// ─── renderHeader ────────────────────────────────────────────────

describe("renderHeader", () => {
  it("contains AgentTrust branding", () => {
    const header = renderHeader("/test/workspace");
    expect(header).toContain("AgentTrust");
    expect(header).toContain("Trust & audit layer for AI agents");
  });

  it("contains workspace path", () => {
    const header = renderHeader("/home/user/.openclaw/workspace");
    expect(header).toContain("/home/user/.openclaw/workspace");
  });

  it("contains 'Workspace' label", () => {
    const header = renderHeader("/test");
    expect(header).toContain("Workspace");
  });
});

// ─── renderTrustSection ──────────────────────────────────────────

describe("renderTrustSection", () => {
  it("shows TRUST SCORE heading", () => {
    const section = renderTrustSection(makeVerdict());
    expect(section).toContain("TRUST SCORE");
  });

  it("shows score as N/100", () => {
    const section = renderTrustSection(makeVerdict({ trustScore: 87 }));
    expect(section).toContain("87/100");
  });

  it("shows trust level in uppercase", () => {
    const section = renderTrustSection(makeVerdict({ level: "high" as TrustLevel }));
    expect(section).toContain("HIGH");
  });

  it("shows all three components", () => {
    const section = renderTrustSection(makeVerdict());
    expect(section).toContain("Integrity");
    expect(section).toContain("Consistency");
    expect(section).toContain("Witness");
  });

  it("shows component scores", () => {
    const section = renderTrustSection(
      makeVerdict({
        components: { integrity: 100, consistency: 85, witnessConfidence: 78 },
      }),
    );
    expect(section).toContain("100");
    expect(section).toContain("85");
    expect(section).toContain("78");
  });

  it("shows status text for perfect integrity", () => {
    const section = renderTrustSection(
      makeVerdict({
        components: { integrity: 100, consistency: 95, witnessConfidence: 95 },
      }),
    );
    expect(section).toContain("All chains intact");
    expect(section).toContain("Fully consistent");
    expect(section).toContain("Fully corroborated");
  });

  it("shows status text for moderate scores", () => {
    const section = renderTrustSection(
      makeVerdict({
        components: { integrity: 50, consistency: 80, witnessConfidence: 80 },
      }),
    );
    expect(section).toContain("Some integrity issues");
    expect(section).toContain("Minor inconsistencies");
    expect(section).toContain("Some uncorroborated actions");
  });

  it("shows status text for low scores", () => {
    const section = renderTrustSection(
      makeVerdict({
        components: { integrity: 0, consistency: 50, witnessConfidence: 50 },
      }),
    );
    expect(section).toContain("Integrity verification failed");
    expect(section).toContain("Significant mismatches");
    expect(section).toContain("Significant witness concerns");
  });

  it("handles verified level", () => {
    const section = renderTrustSection(
      makeVerdict({ trustScore: 98, level: "verified" as TrustLevel }),
    );
    expect(section).toContain("VERIFIED");
  });

  it("handles null trust (no data)", () => {
    const section = renderTrustSection(null);
    expect(section).toContain("TRUST SCORE");
    expect(section).toContain("--/100");
    expect(section).toContain("No data yet");
  });
});

// ─── renderActivitySection ───────────────────────────────────────

describe("renderActivitySection", () => {
  it("shows RECENT ACTIVITY heading with period", () => {
    const section = renderActivitySection({
      total: 47,
      critical: 0,
      high: 2,
      medium: 8,
      low: 37,
      period: "24h",
    });
    expect(section).toContain("RECENT ACTIVITY");
    expect(section).toContain("24h");
  });

  it("shows all risk counts", () => {
    const section = renderActivitySection({
      total: 47,
      critical: 1,
      high: 2,
      medium: 8,
      low: 36,
      period: "24h",
    });
    expect(section).toContain("47");
    expect(section).toContain("Critical");
    expect(section).toContain("High");
    expect(section).toContain("Medium");
    expect(section).toContain("Low");
  });

  it("shows zero actions message when empty", () => {
    const section = renderActivitySection({
      total: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      period: "24h",
    });
    expect(section).toContain("No actions recorded yet");
  });

  it("includes custom period", () => {
    const section = renderActivitySection({
      total: 10,
      critical: 0,
      high: 0,
      medium: 0,
      low: 10,
      period: "7d",
    });
    expect(section).toContain("7d");
  });
});

// ─── renderHealthSection ─────────────────────────────────────────

describe("renderHealthSection", () => {
  it("shows HEALTH heading", () => {
    const section = renderHealthSection(makeData().health, null);
    expect(section).toContain("HEALTH");
  });

  it("shows workspace status", () => {
    const section = renderHealthSection(makeData().health, null);
    expect(section).toContain("Workspace");
    expect(section).toContain("ok");
  });

  it("shows failed workspace", () => {
    const health = { ...makeData().health, workspaceValid: false };
    const section = renderHealthSection(health, null);
    expect(section).toContain("fail");
  });

  it("shows ledger file and entry counts", () => {
    const section = renderHealthSection(makeData().health, null);
    expect(section).toContain("Ledger");
    expect(section).toContain("12 files");
    // 1,847 entries — toLocaleString may vary, just check the number
    expect(section).toContain("1,847");
    expect(section).toContain("entries");
  });

  it("shows chain intact status", () => {
    const section = renderHealthSection(makeData().health, null);
    expect(section).toContain("Chain");
    expect(section).toContain("Intact");
  });

  it("shows chain broken status", () => {
    const health = { ...makeData().health, chainIntact: false };
    const section = renderHealthSection(health, null);
    expect(section).toContain("Broken");
    expect(section).toContain("fail");
  });

  it("shows chain null status", () => {
    const health = { ...makeData().health, chainIntact: null };
    const section = renderHealthSection(health, null);
    expect(section).toContain("No entries");
    expect(section).toContain("--");
  });

  it("shows claim file and count", () => {
    const section = renderHealthSection(makeData().health, null);
    expect(section).toContain("Claims");
    expect(section).toContain("3 files");
    expect(section).toContain("92 claims");
  });

  it("shows witness events today", () => {
    const section = renderHealthSection(makeData().health, null);
    expect(section).toContain("Witness");
    expect(section).toContain("234 events today");
  });

  it("shows 'Not started' when no witness files", () => {
    const health = { ...makeData().health, witnessFiles: 0, witnessEventsToday: 0 };
    const section = renderHealthSection(health, null);
    expect(section).toContain("Not started");
  });

  it("shows last verified timestamp when provided", () => {
    const section = renderHealthSection(makeData().health, "2026-02-16T14:32:00.000Z");
    expect(section).toContain("Last verified");
    expect(section).toContain("Feb");
  });

  it("omits last verified when null", () => {
    const section = renderHealthSection(makeData().health, null);
    expect(section).not.toContain("Last verified");
  });

  it("shows 'No files' for ledger with zero files", () => {
    const health = { ...makeData().health, ledgerFiles: 0, ledgerEntries: 0 };
    const section = renderHealthSection(health, null);
    expect(section).toContain("No files");
  });

  it("shows singular file/entry for 1 ledger file", () => {
    const health = { ...makeData().health, ledgerFiles: 1, ledgerEntries: 1 };
    const section = renderHealthSection(health, null);
    expect(section).toContain("1 file,");
    expect(section).toContain("1 entry");
    // Should NOT say "files" or "entries"
    expect(section).not.toContain("1 files");
    expect(section).not.toContain("1 entries");
  });
});

// ─── renderFindingsFooter ────────────────────────────────────────

describe("renderFindingsFooter", () => {
  it("returns empty string for zero findings", () => {
    expect(renderFindingsFooter(0, null)).toBe("");
  });

  it("shows finding count and summary", () => {
    const footer = renderFindingsFooter(2, "2 high-risk actions detected");
    expect(footer).toContain("2 findings");
    expect(footer).toContain("2 high-risk actions detected");
  });

  it("uses singular for 1 finding", () => {
    const footer = renderFindingsFooter(1, "timing discrepancy");
    expect(footer).toContain("1 finding:");
    expect(footer).not.toContain("1 findings");
  });

  it("suggests agenttrust audit", () => {
    const footer = renderFindingsFooter(3, null);
    expect(footer).toContain("agenttrust audit");
  });

  it("uses default description when summary is null", () => {
    const footer = renderFindingsFooter(5, null);
    expect(footer).toContain("5 findings detected");
  });
});

// ─── renderGettingStarted ────────────────────────────────────────

describe("renderGettingStarted", () => {
  it("shows GETTING STARTED heading", () => {
    const section = renderGettingStarted();
    expect(section).toContain("GETTING STARTED");
  });

  it("has numbered steps", () => {
    const section = renderGettingStarted();
    expect(section).toContain("1.");
    expect(section).toContain("2.");
    expect(section).toContain("3.");
    expect(section).toContain("4.");
    expect(section).toContain("5.");
  });

  it("mentions key commands", () => {
    const section = renderGettingStarted();
    expect(section).toContain("agenttrust log");
    expect(section).toContain("agenttrust verify");
    expect(section).toContain("agenttrust trust");
    expect(section).toContain("agenttrust witness start");
  });
});

// ─── renderNoWorkspace ───────────────────────────────────────────

describe("renderNoWorkspace", () => {
  it("shows AgentTrust branding", () => {
    const output = renderNoWorkspace();
    expect(output).toContain("AgentTrust");
  });

  it("shows no workspace message", () => {
    const output = renderNoWorkspace();
    expect(output).toContain("No workspace found");
  });

  it("suggests agenttrust init", () => {
    const output = renderNoWorkspace();
    expect(output).toContain("agenttrust init");
  });

  it("suggests --workspace flag", () => {
    const output = renderNoWorkspace();
    expect(output).toContain("--workspace");
  });
});

// ─── formatStatusDashboard (integration) ─────────────────────────

describe("formatStatusDashboard", () => {
  it("contains all major sections when data present", () => {
    const output = formatStatusDashboard(makeData());
    expect(output).toContain("AgentTrust");
    expect(output).toContain("TRUST SCORE");
    expect(output).toContain("RECENT ACTIVITY");
    expect(output).toContain("HEALTH");
  });

  it("includes workspace path", () => {
    const output = formatStatusDashboard(makeData());
    expect(output).toContain("/home/user/.openclaw/workspace");
  });

  it("shows trust score", () => {
    const output = formatStatusDashboard(makeData());
    expect(output).toContain("87/100");
    expect(output).toContain("HIGH");
  });

  it("shows activity counts", () => {
    const output = formatStatusDashboard(makeData());
    expect(output).toContain("47");
    expect(output).toContain("Critical");
    expect(output).toContain("High");
  });

  it("shows health items", () => {
    const output = formatStatusDashboard(makeData());
    expect(output).toContain("Workspace");
    expect(output).toContain("Ledger");
    expect(output).toContain("Chain");
    expect(output).toContain("Claims");
    expect(output).toContain("Witness");
  });

  it("shows findings footer when findings exist", () => {
    const output = formatStatusDashboard(makeData());
    expect(output).toContain("finding");
    expect(output).toContain("agenttrust audit");
  });

  it("omits findings footer when count is zero", () => {
    const data = makeData({ findingsCount: 0, findingsSummary: null });
    const output = formatStatusDashboard(data);
    expect(output).not.toContain("agenttrust audit");
  });

  it("shows getting started when no trust data", () => {
    const data = makeData({ trust: null });
    const output = formatStatusDashboard(data);
    expect(output).toContain("GETTING STARTED");
    expect(output).toContain("agenttrust log");
  });

  it("does NOT show getting started when trust data present", () => {
    const output = formatStatusDashboard(makeData());
    expect(output).not.toContain("GETTING STARTED");
  });

  it("fits within 80 columns", () => {
    const output = formatStatusDashboard(makeData());
    const lines = output.split("\n");
    for (const line of lines) {
      // chalk.level=0 means no ANSI escape codes, so raw length check works
      expect(line.length).toBeLessThanOrEqual(80);
    }
  });
});

// ─── formatStatusJson ────────────────────────────────────────────

describe("formatStatusJson", () => {
  it("produces valid JSON", () => {
    const output = formatStatusJson(makeData());
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("includes trust score and level", () => {
    const json = JSON.parse(formatStatusJson(makeData()));
    expect(json.trust.score).toBe(87);
    expect(json.trust.level).toBe("high");
  });

  it("includes trust components", () => {
    const json = JSON.parse(formatStatusJson(makeData()));
    expect(json.trust.components.integrity).toBe(100);
    expect(json.trust.components.consistency).toBe(85);
    expect(json.trust.components.witnessConfidence).toBe(78);
  });

  it("includes activity data", () => {
    const json = JSON.parse(formatStatusJson(makeData()));
    expect(json.activity.total).toBe(47);
    expect(json.activity.period).toBe("24h");
    expect(json.activity.risk.critical).toBe(0);
    expect(json.activity.risk.high).toBe(2);
    expect(json.activity.risk.medium).toBe(8);
    expect(json.activity.risk.low).toBe(37);
  });

  it("includes health data", () => {
    const json = JSON.parse(formatStatusJson(makeData()));
    expect(json.health.workspace).toBe(true);
    expect(json.health.ledgerFiles).toBe(12);
    expect(json.health.ledgerEntries).toBe(1847);
    expect(json.health.chainIntact).toBe(true);
    expect(json.health.claimFiles).toBe(3);
    expect(json.health.claimCount).toBe(92);
    expect(json.health.witnessFiles).toBe(5);
    expect(json.health.witnessEventsToday).toBe(234);
  });

  it("includes lastVerified", () => {
    const json = JSON.parse(formatStatusJson(makeData()));
    expect(json.lastVerified).toBe("2026-02-16T14:32:00.000Z");
  });

  it("includes findings count", () => {
    const json = JSON.parse(formatStatusJson(makeData()));
    expect(json.findings).toBe(1);
  });

  it("handles null trust", () => {
    const json = JSON.parse(formatStatusJson(makeData({ trust: null })));
    expect(json.trust).toBeNull();
  });

  it("handles null lastVerified", () => {
    const json = JSON.parse(formatStatusJson(makeData({ lastVerified: null })));
    expect(json.lastVerified).toBeNull();
  });

  it("handles zero findings", () => {
    const json = JSON.parse(formatStatusJson(makeData({ findingsCount: 0 })));
    expect(json.findings).toBe(0);
  });
});

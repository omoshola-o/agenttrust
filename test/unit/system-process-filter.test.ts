import { describe, it, expect } from "vitest";
import {
  isSystemProcess,
  classifyUnloggedObservations,
  SYSTEM_PROCESS_EXCLUSIONS,
  correlate,
  generateFindings,
} from "../../src/correlation/engine.js";
import { computeWitnessConfidence } from "../../src/correlation/scorer.js";
import type { ATFEntry } from "../../src/ledger/entry.js";
import type {
  WitnessEntry,
  NetworkWitnessEvent,
  FileWitnessEvent,
  ProcessWitnessEvent,
} from "../../src/witness/types.js";
import type { CorrelationMatch } from "../../src/correlation/types.js";

const BASE_TS = "2026-02-16T14:00:00.000Z";

function makeNetworkWitness(overrides?: {
  id?: string;
  ts?: string;
  remoteHost?: string;
  remotePort?: number;
  command?: string;
  pid?: number;
}): WitnessEntry {
  return {
    id: overrides?.id ?? "WIT_N_" + Math.random().toString(36).slice(2, 10).toUpperCase(),
    v: 1,
    ts: overrides?.ts ?? BASE_TS,
    prevHash: "",
    hash: "wh_" + Math.random().toString(36).slice(2, 6),
    source: "network",
    event: {
      type: "connection_opened",
      remoteHost: overrides?.remoteHost ?? "api.example.com",
      remotePort: overrides?.remotePort ?? 443,
      protocol: "tcp" as const,
      pid: overrides?.pid ?? 1234,
      command: overrides?.command,
      observedAt: overrides?.ts ?? BASE_TS,
    } as NetworkWitnessEvent,
    correlated: false,
  };
}

function makeFileWitness(overrides?: {
  id?: string;
  ts?: string;
  path?: string;
}): WitnessEntry {
  return {
    id: overrides?.id ?? "WIT_F_" + Math.random().toString(36).slice(2, 10).toUpperCase(),
    v: 1,
    ts: overrides?.ts ?? BASE_TS,
    prevHash: "",
    hash: "wh_" + Math.random().toString(36).slice(2, 6),
    source: "filesystem",
    event: {
      type: "file_modified",
      path: overrides?.path ?? "/tmp/test.txt",
      observedAt: overrides?.ts ?? BASE_TS,
    } as FileWitnessEvent,
    correlated: false,
  };
}

function makeProcessWitness(overrides?: {
  id?: string;
  ts?: string;
  command?: string;
  pid?: number;
}): WitnessEntry {
  return {
    id: overrides?.id ?? "WIT_P_" + Math.random().toString(36).slice(2, 10).toUpperCase(),
    v: 1,
    ts: overrides?.ts ?? BASE_TS,
    prevHash: "",
    hash: "wh_" + Math.random().toString(36).slice(2, 6),
    source: "process",
    event: {
      type: "process_spawned",
      command: overrides?.command ?? "node",
      pid: overrides?.pid ?? 5678,
      ppid: 1,
      observedAt: overrides?.ts ?? BASE_TS,
    } as ProcessWitnessEvent,
    correlated: false,
  };
}

function makeExecEntry(overrides?: {
  id?: string;
  ts?: string;
  actionType?: string;
  target?: string;
  riskScore?: number;
}): ATFEntry {
  return {
    id: overrides?.id ?? "EXEC_" + Math.random().toString(36).slice(2, 10).toUpperCase(),
    v: 1,
    ts: overrides?.ts ?? BASE_TS,
    prevHash: "",
    hash: "eh_" + Math.random().toString(36).slice(2, 6),
    agent: "default",
    session: "ses_test",
    action: {
      type: (overrides?.actionType ?? "file.write") as ATFEntry["action"]["type"],
      target: overrides?.target ?? "/tmp/test.txt",
      detail: "Did something",
    },
    context: { goal: "Test", trigger: "inbound_message" },
    outcome: { status: "success", durationMs: 10 },
    risk: {
      score: overrides?.riskScore ?? 1,
      labels: [] as ATFEntry["risk"]["labels"],
      autoFlagged: false,
    },
  } as ATFEntry;
}

describe("isSystemProcess", () => {
  it("returns false for undefined command", () => {
    expect(isSystemProcess(undefined)).toBe(false);
  });

  it("returns false for empty command", () => {
    expect(isSystemProcess("")).toBe(false);
  });

  it("returns true for Google Chrome", () => {
    expect(isSystemProcess("Google Chrome")).toBe(true);
  });

  it("returns true for Google Chrome Helper", () => {
    expect(isSystemProcess("Google Chrome Helper")).toBe(true);
  });

  it("returns true for com.google.Chrome", () => {
    expect(isSystemProcess("com.google.Chrome")).toBe(true);
  });

  it("returns true for Safari", () => {
    expect(isSystemProcess("Safari")).toBe(true);
  });

  it("returns true for ChatGPT", () => {
    expect(isSystemProcess("ChatGPT")).toBe(true);
  });

  it("returns true for claude", () => {
    expect(isSystemProcess("claude")).toBe(true);
  });

  it("returns true for Claude Desktop", () => {
    expect(isSystemProcess("Claude Desktop")).toBe(true);
  });

  it("returns true for Weather", () => {
    expect(isSystemProcess("Weather")).toBe(true);
  });

  it("returns true for News", () => {
    expect(isSystemProcess("News")).toBe(true);
  });

  it("returns true for VS Code (code)", () => {
    expect(isSystemProcess("code")).toBe(true);
  });

  it("returns true for Code Helper", () => {
    expect(isSystemProcess("Code Helper (Renderer)")).toBe(true);
  });

  it("returns true for sharingd", () => {
    expect(isSystemProcess("sharingd")).toBe(true);
  });

  it("returns true for nsurlsessiond", () => {
    expect(isSystemProcess("nsurlsessiond")).toBe(true);
  });

  it("returns true for HP printer process", () => {
    expect(isSystemProcess("HP Smart")).toBe(true);
  });

  it("returns true for Electron", () => {
    expect(isSystemProcess("Electron")).toBe(true);
  });

  it("returns true for mDNSResponder", () => {
    expect(isSystemProcess("mDNSResponder")).toBe(true);
  });

  it("returns false for node", () => {
    expect(isSystemProcess("node")).toBe(false);
  });

  it("returns false for openclaw", () => {
    expect(isSystemProcess("openclaw")).toBe(false);
  });

  it("returns false for curl", () => {
    expect(isSystemProcess("curl")).toBe(false);
  });

  it("returns false for python3", () => {
    expect(isSystemProcess("python3")).toBe(false);
  });

  it("returns false for npm", () => {
    expect(isSystemProcess("npm")).toBe(false);
  });

  it("performs case-insensitive matching", () => {
    expect(isSystemProcess("CHROME")).toBe(true);
    expect(isSystemProcess("Safari")).toBe(true);
    expect(isSystemProcess("WEATHER")).toBe(true);
  });
});

describe("classifyUnloggedObservations", () => {
  it("classifies network events from system processes as background noise", () => {
    const chromeWitness = makeNetworkWitness({ id: "W1", command: "Google Chrome", remoteHost: "google.com" });
    const safariWitness = makeNetworkWitness({ id: "W2", command: "Safari", remoteHost: "apple.com" });
    const agentWitness = makeNetworkWitness({ id: "W3", command: "node", remoteHost: "unknown-server.example.com" });

    const result = classifyUnloggedObservations([chromeWitness, safariWitness, agentWitness]);
    expect(result.backgroundNoise).toHaveLength(2);
    expect(result.agentObservations).toHaveLength(1);
    expect(result.agentObservations[0]!.id).toBe("W3");
    expect(result.infrastructureTraffic).toHaveLength(0);
  });

  it("does not classify filesystem events as background noise", () => {
    const fileWitness = makeFileWitness({ id: "WF1", path: "/tmp/test.txt" });
    const result = classifyUnloggedObservations([fileWitness]);
    expect(result.backgroundNoise).toHaveLength(0);
    expect(result.agentObservations).toHaveLength(1);
  });

  it("does not classify process events as background noise", () => {
    const procWitness = makeProcessWitness({ id: "WP1", command: "npm test" });
    const result = classifyUnloggedObservations([procWitness]);
    expect(result.backgroundNoise).toHaveLength(0);
    expect(result.agentObservations).toHaveLength(1);
  });

  it("keeps network events without a command in agent observations", () => {
    const witness = makeNetworkWitness({ id: "W1", command: undefined, remoteHost: "unknown.host" });
    const result = classifyUnloggedObservations([witness]);
    expect(result.backgroundNoise).toHaveLength(0);
    expect(result.agentObservations).toHaveLength(1);
  });

  it("filters out VS Code network events", () => {
    const codeWitness = makeNetworkWitness({ id: "W1", command: "code", remoteHost: "update.code.visualstudio.com" });
    const result = classifyUnloggedObservations([codeWitness]);
    expect(result.backgroundNoise).toHaveLength(1);
    expect(result.agentObservations).toHaveLength(0);
  });

  it("filters out ChatGPT network events", () => {
    const witness = makeNetworkWitness({ id: "W1", command: "ChatGPT", remoteHost: "api.openai.com" });
    const result = classifyUnloggedObservations([witness]);
    expect(result.backgroundNoise).toHaveLength(1);
    expect(result.agentObservations).toHaveLength(0);
  });

  it("filters out Weather app network events", () => {
    const witness = makeNetworkWitness({ id: "W1", command: "Weather", remoteHost: "weather.apple.com" });
    const result = classifyUnloggedObservations([witness]);
    expect(result.backgroundNoise).toHaveLength(1);
    expect(result.agentObservations).toHaveLength(0);
  });

  it("returns empty arrays for empty input", () => {
    const result = classifyUnloggedObservations([]);
    expect(result.backgroundNoise).toHaveLength(0);
    expect(result.agentObservations).toHaveLength(0);
  });

  it("handles mixed event types correctly", () => {
    const events: WitnessEntry[] = [
      makeNetworkWitness({ id: "W1", command: "Chrome", remoteHost: "google.com" }),
      makeFileWitness({ id: "W2", path: "/tmp/file.txt" }),
      makeNetworkWitness({ id: "W3", command: "node", remoteHost: "api.example.com" }),
      makeProcessWitness({ id: "W4", command: "npm" }),
      makeNetworkWitness({ id: "W5", command: "Weather", remoteHost: "weather.apple.com" }),
    ];

    const result = classifyUnloggedObservations(events);
    expect(result.backgroundNoise).toHaveLength(2);   // Chrome + Weather
    expect(result.agentObservations).toHaveLength(3);  // file + node network + process
  });
});

describe("correlate() with background noise", () => {
  it("includes backgroundNoise count in summary", () => {
    // Chrome makes a connection — should be classified as background noise
    const chromeWitness = makeNetworkWitness({
      id: "W_CHROME",
      command: "Google Chrome",
      remoteHost: "google.com",
    });

    const report = correlate([chromeWitness], []);
    expect(report.summary.backgroundNoise).toBe(1);
    expect(report.summary.unloggedObservations).toBe(0);
    expect(report.summary.infrastructureTraffic).toBe(0);
  });

  it("does not generate silent_network findings for system process events", () => {
    const witnesses: WitnessEntry[] = [
      makeNetworkWitness({ id: "W1", command: "Google Chrome", remoteHost: "google.com" }),
      makeNetworkWitness({ id: "W2", command: "Safari", remoteHost: "apple.com" }),
      makeNetworkWitness({ id: "W3", command: "ChatGPT", remoteHost: "api.openai.com" }),
      makeNetworkWitness({ id: "W4", command: "Weather", remoteHost: "weather.apple.com" }),
      makeNetworkWitness({ id: "W5", command: "code", remoteHost: "update.code.visualstudio.com" }),
    ];

    const report = correlate(witnesses, []);
    const silentNetwork = report.findings.filter((f) => f.type === "silent_network");
    expect(silentNetwork).toHaveLength(0);
    expect(report.summary.backgroundNoise).toBe(5);
    expect(report.summary.infrastructureTraffic).toBe(0);
  });

  it("still generates silent_network findings for agent process events", () => {
    const agentWitness = makeNetworkWitness({
      id: "W_AGENT",
      command: "node",
      remoteHost: "suspicious.example.com",
    });

    const report = correlate([agentWitness], []);
    const silentNetwork = report.findings.filter((f) => f.type === "silent_network");
    expect(silentNetwork).toHaveLength(1);
    expect(report.summary.backgroundNoise).toBe(0);
    expect(report.summary.infrastructureTraffic).toBe(0);
  });

  it("system process network events do not reduce witness confidence", () => {
    // Many system process connections — should not reduce confidence
    const systemWitnesses: WitnessEntry[] = [];
    for (let i = 0; i < 20; i++) {
      systemWitnesses.push(
        makeNetworkWitness({
          id: `W_SYS_${i}`,
          command: "Google Chrome",
          remoteHost: `host${i}.google.com`,
        }),
      );
    }

    const report = correlate(systemWitnesses, []);
    expect(report.witnessConfidence).toBe(100);
    expect(report.summary.backgroundNoise).toBe(20);
  });

  it("agent network events still reduce witness confidence", () => {
    const agentWitness = makeNetworkWitness({
      id: "W_AGENT",
      command: "node",
      remoteHost: "suspicious.example.com",
    });

    const report = correlate([agentWitness], []);
    expect(report.witnessConfidence).toBeLessThan(100);
  });

  it("mixes system and agent events correctly", () => {
    const witnesses: WitnessEntry[] = [
      makeNetworkWitness({ id: "W1", command: "Chrome", remoteHost: "google.com" }),
      makeNetworkWitness({ id: "W2", command: "node", remoteHost: "malicious.com" }),
      makeNetworkWitness({ id: "W3", command: "Safari", remoteHost: "apple.com" }),
    ];

    const report = correlate(witnesses, []);
    expect(report.summary.backgroundNoise).toBe(2);
    expect(report.summary.infrastructureTraffic).toBe(0);
    expect(report.summary.unloggedObservations).toBe(1);
    // Only the node connection should generate a finding
    const silentNet = report.findings.filter((f) => f.type === "silent_network");
    expect(silentNet).toHaveLength(1);
    expect(silentNet[0]!.description).toContain("malicious.com");
  });
});

describe("generateFindings exclusion consistency", () => {
  it("does not generate findings for excluded network events passed to it", () => {
    // This tests that if somehow a system process event leaked through,
    // generateFindings still processes it — the filtering is in correlate()
    const systemWitness = makeNetworkWitness({
      id: "W_SYS",
      command: "Chrome",
      remoteHost: "google.com",
    });

    // generateFindings receives unfiltered — it WILL produce silent_network
    const findings = generateFindings([], [], [systemWitness]);
    expect(findings.some((f) => f.type === "silent_network")).toBe(true);
  });

  it("after classifyUnloggedObservations, only agent events reach generateFindings", () => {
    const mixed: WitnessEntry[] = [
      makeNetworkWitness({ id: "W1", command: "Chrome", remoteHost: "google.com" }),
      makeNetworkWitness({ id: "W2", command: "node", remoteHost: "evil.com" }),
    ];

    const { agentObservations } = classifyUnloggedObservations(mixed);
    const findings = generateFindings([], [], agentObservations);
    const silentNet = findings.filter((f) => f.type === "silent_network");
    expect(silentNet).toHaveLength(1);
    expect(silentNet[0]!.description).toContain("evil.com");
  });
});

describe("SYSTEM_PROCESS_EXCLUSIONS", () => {
  it("is a non-empty array of lowercase strings", () => {
    expect(SYSTEM_PROCESS_EXCLUSIONS.length).toBeGreaterThan(0);
    for (const name of SYSTEM_PROCESS_EXCLUSIONS) {
      expect(name).toBe(name.toLowerCase());
    }
  });

  it("includes all expected browser names", () => {
    const hasChrome = SYSTEM_PROCESS_EXCLUSIONS.some((n) => n.includes("chrome"));
    const hasSafari = SYSTEM_PROCESS_EXCLUSIONS.some((n) => n.includes("safari"));
    const hasFirefox = SYSTEM_PROCESS_EXCLUSIONS.some((n) => n.includes("firefox"));
    expect(hasChrome).toBe(true);
    expect(hasSafari).toBe(true);
    expect(hasFirefox).toBe(true);
  });

  it("includes AI assistants", () => {
    const hasChatGPT = SYSTEM_PROCESS_EXCLUSIONS.some((n) => n.includes("chatgpt"));
    const hasClaude = SYSTEM_PROCESS_EXCLUSIONS.some((n) => n.includes("claude"));
    expect(hasChatGPT).toBe(true);
    expect(hasClaude).toBe(true);
  });

  it("includes IDE names", () => {
    const hasCode = SYSTEM_PROCESS_EXCLUSIONS.includes("code");
    const hasElectron = SYSTEM_PROCESS_EXCLUSIONS.some((n) => n.includes("electron"));
    expect(hasCode).toBe(true);
    expect(hasElectron).toBe(true);
  });

  it("includes macOS system processes", () => {
    const hasWeather = SYSTEM_PROCESS_EXCLUSIONS.some((n) => n.includes("weather"));
    const hasNews = SYSTEM_PROCESS_EXCLUSIONS.some((n) => n.includes("news"));
    const hasSharingd = SYSTEM_PROCESS_EXCLUSIONS.some((n) => n.includes("sharingd"));
    expect(hasWeather).toBe(true);
    expect(hasNews).toBe(true);
    expect(hasSharingd).toBe(true);
  });
});

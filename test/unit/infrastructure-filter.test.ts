import { describe, it, expect } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  matchesInfrastructurePattern,
  isInfrastructureTraffic,
  KNOWN_INFRASTRUCTURE_PATTERNS,
  classifyUnloggedObservations,
  correlate,
} from "../../src/correlation/engine.js";
import { loadInfrastructurePatterns } from "../../src/correlation/config.js";
import type { InfrastructurePattern } from "../../src/correlation/types.js";
import type {
  WitnessEntry,
  NetworkWitnessEvent,
  FileWitnessEvent,
  ProcessWitnessEvent,
} from "../../src/witness/types.js";

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

// ─── matchesInfrastructurePattern ──────────────────────────────────

describe("matchesInfrastructurePattern", () => {
  describe("exact host matching", () => {
    const pattern: InfrastructurePattern = { host: "api.anthropic.com", label: "anthropic" };

    it("matches exact hostname", () => {
      expect(matchesInfrastructurePattern("api.anthropic.com", 443, pattern)).toBe(true);
    });

    it("does not match subdomain of exact pattern", () => {
      expect(matchesInfrastructurePattern("sub.api.anthropic.com", 443, pattern)).toBe(false);
    });

    it("does not match partial hostname", () => {
      expect(matchesInfrastructurePattern("api.anthropic.com.evil.com", 443, pattern)).toBe(false);
    });

    it("does not match different hostname", () => {
      expect(matchesInfrastructurePattern("api.openai.com", 443, pattern)).toBe(false);
    });
  });

  describe("wildcard subdomain matching", () => {
    const pattern: InfrastructurePattern = { host: "*.anthropic.com", label: "anthropic" };

    it("matches any subdomain", () => {
      expect(matchesInfrastructurePattern("api.anthropic.com", 443, pattern)).toBe(true);
    });

    it("matches multi-level subdomain", () => {
      expect(matchesInfrastructurePattern("us-west.api.anthropic.com", 443, pattern)).toBe(true);
    });

    it("matches bare domain (without subdomain)", () => {
      expect(matchesInfrastructurePattern("anthropic.com", 443, pattern)).toBe(true);
    });

    it("does not match different domain", () => {
      expect(matchesInfrastructurePattern("anthropic.evil.com", 443, pattern)).toBe(false);
    });

    it("does not match appended hostname", () => {
      expect(matchesInfrastructurePattern("notanthropic.com", 443, pattern)).toBe(false);
    });
  });

  describe("IP prefix wildcard matching", () => {
    const pattern: InfrastructurePattern = { host: "140.82.112.*", label: "github" };

    it("matches IP in range", () => {
      expect(matchesInfrastructurePattern("140.82.112.10", 443, pattern)).toBe(true);
    });

    it("matches IP at start of range", () => {
      expect(matchesInfrastructurePattern("140.82.112.0", 443, pattern)).toBe(true);
    });

    it("matches IP at end of range", () => {
      expect(matchesInfrastructurePattern("140.82.112.255", 443, pattern)).toBe(true);
    });

    it("does not match different subnet", () => {
      expect(matchesInfrastructurePattern("140.82.113.10", 443, pattern)).toBe(false);
    });

    it("does not match completely different IP", () => {
      expect(matchesInfrastructurePattern("192.168.1.1", 443, pattern)).toBe(false);
    });
  });

  describe("broad IP prefix matching", () => {
    const pattern: InfrastructurePattern = { host: "3.*", port: 443, label: "aws" };

    it("matches any IP starting with prefix", () => {
      expect(matchesInfrastructurePattern("3.100.200.5", 443, pattern)).toBe(true);
    });

    it("does not match with wrong port", () => {
      expect(matchesInfrastructurePattern("3.100.200.5", 80, pattern)).toBe(false);
    });

    it("does not match different first octet", () => {
      expect(matchesInfrastructurePattern("4.100.200.5", 443, pattern)).toBe(false);
    });
  });

  describe("IPv6 prefix matching", () => {
    const pattern: InfrastructurePattern = { host: "2606:4700:*", label: "cloudflare" };

    it("matches IPv6 with same prefix", () => {
      expect(matchesInfrastructurePattern("2606:4700:3030::1", undefined, pattern)).toBe(true);
    });

    it("does not match different IPv6 prefix", () => {
      expect(matchesInfrastructurePattern("2001:db8::", undefined, pattern)).toBe(false);
    });
  });

  describe("port constraint", () => {
    const pattern: InfrastructurePattern = { host: "api.anthropic.com", port: 443, label: "anthropic" };

    it("matches when port matches", () => {
      expect(matchesInfrastructurePattern("api.anthropic.com", 443, pattern)).toBe(true);
    });

    it("rejects when port does not match", () => {
      expect(matchesInfrastructurePattern("api.anthropic.com", 80, pattern)).toBe(false);
    });

    it("matches when connection port is undefined (no port info)", () => {
      // Port constraint only rejects when BOTH are defined and different
      expect(matchesInfrastructurePattern("api.anthropic.com", undefined, pattern)).toBe(true);
    });
  });

  describe("no port constraint", () => {
    const pattern: InfrastructurePattern = { host: "api.anthropic.com", label: "anthropic" };

    it("matches any port when pattern has no port", () => {
      expect(matchesInfrastructurePattern("api.anthropic.com", 80, pattern)).toBe(true);
      expect(matchesInfrastructurePattern("api.anthropic.com", 443, pattern)).toBe(true);
      expect(matchesInfrastructurePattern("api.anthropic.com", 8080, pattern)).toBe(true);
    });
  });
});

// ─── isInfrastructureTraffic ──────────────────────────────────────

describe("isInfrastructureTraffic", () => {
  it("matches Anthropic API", () => {
    expect(isInfrastructureTraffic("api.anthropic.com", 443)).toBe(true);
  });

  it("matches Anthropic subdomains", () => {
    expect(isInfrastructureTraffic("us-west.anthropic.com", 443)).toBe(true);
  });

  it("matches GitHub IPs", () => {
    expect(isInfrastructureTraffic("140.82.112.4", 443)).toBe(true);
    expect(isInfrastructureTraffic("140.82.113.22", 443)).toBe(true);
    expect(isInfrastructureTraffic("140.82.114.3", 443)).toBe(true);
    expect(isInfrastructureTraffic("140.82.121.10", 443)).toBe(true);
  });

  it("matches GitHub hostnames", () => {
    expect(isInfrastructureTraffic("api.github.com", 443)).toBe(true);
    expect(isInfrastructureTraffic("raw.githubusercontent.com", 443)).toBe(true);
  });

  it("matches Cloudflare IPs", () => {
    expect(isInfrastructureTraffic("104.18.1.1", 443)).toBe(true);
    expect(isInfrastructureTraffic("172.67.100.200", 443)).toBe(true);
  });

  it("matches npm registry", () => {
    expect(isInfrastructureTraffic("registry.npmjs.org", 443)).toBe(true);
    expect(isInfrastructureTraffic("npm.npmjs.com", 443)).toBe(true);
  });

  it("matches OpenAI API", () => {
    expect(isInfrastructureTraffic("api.openai.com", 443)).toBe(true);
  });

  it("matches AWS IPs on port 443 only", () => {
    expect(isInfrastructureTraffic("3.100.200.5", 443)).toBe(true);
    expect(isInfrastructureTraffic("3.100.200.5", 80)).toBe(false);
    expect(isInfrastructureTraffic("18.204.10.1", 443)).toBe(true);
    expect(isInfrastructureTraffic("18.204.10.1", 80)).toBe(false);
    expect(isInfrastructureTraffic("34.200.10.5", 443)).toBe(true);
    expect(isInfrastructureTraffic("35.180.20.1", 443)).toBe(true);
    expect(isInfrastructureTraffic("35.180.20.1", 8080)).toBe(false);
    expect(isInfrastructureTraffic("52.20.30.40", 443)).toBe(true);
    expect(isInfrastructureTraffic("52.20.30.40", 8080)).toBe(false);
  });

  it("matches Anthropic IPv6", () => {
    expect(isInfrastructureTraffic("2620:149:a0::1", 443)).toBe(true);
  });

  it("matches Google services IPv6", () => {
    expect(isInfrastructureTraffic("2001:4860:4860::8888", 443)).toBe(true);
  });

  it("matches Fastly CDN IPv6", () => {
    expect(isInfrastructureTraffic("2607:6bc0:1::100", 443)).toBe(true);
  });

  it("does not match unknown hosts", () => {
    expect(isInfrastructureTraffic("evil.com", 443)).toBe(false);
    expect(isInfrastructureTraffic("suspicious-server.example.com", 443)).toBe(false);
    expect(isInfrastructureTraffic("192.168.1.1", 443)).toBe(false);
  });

  describe("with custom patterns", () => {
    const customPatterns: InfrastructurePattern[] = [
      { host: "api.mycompany.com", label: "internal-api" },
      { host: "*.internal.mycompany.com", port: 443, label: "internal-services" },
    ];

    it("matches custom patterns", () => {
      expect(isInfrastructureTraffic("api.mycompany.com", 443, customPatterns)).toBe(true);
    });

    it("matches custom wildcard patterns", () => {
      expect(isInfrastructureTraffic("db.internal.mycompany.com", 443, customPatterns)).toBe(true);
    });

    it("still matches built-in patterns when custom are provided", () => {
      expect(isInfrastructureTraffic("api.anthropic.com", 443, customPatterns)).toBe(true);
    });

    it("rejects custom pattern with wrong port", () => {
      expect(isInfrastructureTraffic("db.internal.mycompany.com", 80, customPatterns)).toBe(false);
    });
  });
});

// ─── KNOWN_INFRASTRUCTURE_PATTERNS ────────────────────────────────

describe("KNOWN_INFRASTRUCTURE_PATTERNS", () => {
  it("is a non-empty array", () => {
    expect(KNOWN_INFRASTRUCTURE_PATTERNS.length).toBeGreaterThan(0);
  });

  it("every pattern has host and label", () => {
    for (const p of KNOWN_INFRASTRUCTURE_PATTERNS) {
      expect(typeof p.host).toBe("string");
      expect(p.host.length).toBeGreaterThan(0);
      expect(typeof p.label).toBe("string");
      expect(p.label.length).toBeGreaterThan(0);
    }
  });

  it("includes Anthropic patterns", () => {
    const anthropic = KNOWN_INFRASTRUCTURE_PATTERNS.filter((p) => p.label === "anthropic");
    expect(anthropic.length).toBeGreaterThan(0);
  });

  it("includes GitHub patterns", () => {
    const github = KNOWN_INFRASTRUCTURE_PATTERNS.filter((p) => p.label === "github");
    expect(github.length).toBeGreaterThan(0);
  });

  it("includes npm patterns", () => {
    const npm = KNOWN_INFRASTRUCTURE_PATTERNS.filter((p) => p.label === "npm");
    expect(npm.length).toBeGreaterThan(0);
  });

  it("includes Cloudflare patterns", () => {
    const cf = KNOWN_INFRASTRUCTURE_PATTERNS.filter((p) => p.label === "cloudflare");
    expect(cf.length).toBeGreaterThan(0);
  });

  it("includes OpenAI patterns", () => {
    const openai = KNOWN_INFRASTRUCTURE_PATTERNS.filter((p) => p.label === "openai");
    expect(openai.length).toBeGreaterThan(0);
  });

  it("includes AWS patterns", () => {
    const aws = KNOWN_INFRASTRUCTURE_PATTERNS.filter((p) => p.label === "aws");
    expect(aws.length).toBeGreaterThan(0);
    // All AWS patterns should require port 443
    for (const p of aws) {
      expect(p.port).toBe(443);
    }
  });

  it("includes Fastly patterns", () => {
    const fastly = KNOWN_INFRASTRUCTURE_PATTERNS.filter((p) => p.label === "fastly");
    expect(fastly.length).toBeGreaterThan(0);
  });

  it("includes Google patterns (both google-cloud and google labels)", () => {
    const google = KNOWN_INFRASTRUCTURE_PATTERNS.filter((p) =>
      p.label === "google" || p.label === "google-cloud",
    );
    expect(google.length).toBeGreaterThan(0);
  });
});

// ─── classifyUnloggedObservations with infrastructure ─────────────

describe("classifyUnloggedObservations infrastructure classification", () => {
  it("classifies network events to infrastructure hosts as infrastructure traffic", () => {
    const anthropicWitness = makeNetworkWitness({
      id: "W1",
      command: "node",
      remoteHost: "api.anthropic.com",
      remotePort: 443,
    });
    const githubWitness = makeNetworkWitness({
      id: "W2",
      command: "node",
      remoteHost: "140.82.112.10",
      remotePort: 443,
    });

    const result = classifyUnloggedObservations([anthropicWitness, githubWitness]);
    expect(result.infrastructureTraffic).toHaveLength(2);
    expect(result.agentObservations).toHaveLength(0);
    expect(result.backgroundNoise).toHaveLength(0);
  });

  it("system process classification takes priority over infrastructure", () => {
    // Chrome connecting to GitHub — Chrome is a system process, so it's background noise,
    // not infrastructure traffic
    const chromeGithub = makeNetworkWitness({
      id: "W1",
      command: "Google Chrome",
      remoteHost: "api.github.com",
      remotePort: 443,
    });

    const result = classifyUnloggedObservations([chromeGithub]);
    expect(result.backgroundNoise).toHaveLength(1);
    expect(result.infrastructureTraffic).toHaveLength(0);
    expect(result.agentObservations).toHaveLength(0);
  });

  it("agent process to unknown host remains in agent observations", () => {
    const agentWitness = makeNetworkWitness({
      id: "W1",
      command: "node",
      remoteHost: "suspicious-host.example.com",
      remotePort: 443,
    });

    const result = classifyUnloggedObservations([agentWitness]);
    expect(result.agentObservations).toHaveLength(1);
    expect(result.infrastructureTraffic).toHaveLength(0);
    expect(result.backgroundNoise).toHaveLength(0);
  });

  it("does not classify filesystem events as infrastructure", () => {
    const fileWitness = makeFileWitness({ id: "WF1", path: "/tmp/test.txt" });
    const result = classifyUnloggedObservations([fileWitness]);
    expect(result.infrastructureTraffic).toHaveLength(0);
    expect(result.agentObservations).toHaveLength(1);
  });

  it("does not classify process events as infrastructure", () => {
    const procWitness = makeProcessWitness({ id: "WP1", command: "npm test" });
    const result = classifyUnloggedObservations([procWitness]);
    expect(result.infrastructureTraffic).toHaveLength(0);
    expect(result.agentObservations).toHaveLength(1);
  });

  it("handles mixed classification: background + infrastructure + agent", () => {
    const events: WitnessEntry[] = [
      makeNetworkWitness({ id: "W1", command: "Chrome", remoteHost: "google.com" }),
      makeNetworkWitness({ id: "W2", command: "node", remoteHost: "api.anthropic.com", remotePort: 443 }),
      makeNetworkWitness({ id: "W3", command: "node", remoteHost: "evil.example.com" }),
      makeFileWitness({ id: "W4", path: "/tmp/file.txt" }),
      makeNetworkWitness({ id: "W5", command: "node", remoteHost: "registry.npmjs.org", remotePort: 443 }),
    ];

    const result = classifyUnloggedObservations(events);
    expect(result.backgroundNoise).toHaveLength(1);          // Chrome
    expect(result.infrastructureTraffic).toHaveLength(2);    // Anthropic + npm
    expect(result.agentObservations).toHaveLength(2);        // evil.example.com + file
  });

  it("accepts custom infrastructure patterns", () => {
    const customPatterns: InfrastructurePattern[] = [
      { host: "api.mycompany.com", label: "internal-api" },
    ];

    const witness = makeNetworkWitness({
      id: "W1",
      command: "node",
      remoteHost: "api.mycompany.com",
      remotePort: 443,
    });

    const result = classifyUnloggedObservations([witness], customPatterns);
    expect(result.infrastructureTraffic).toHaveLength(1);
    expect(result.agentObservations).toHaveLength(0);
  });
});

// ─── correlate() with infrastructure traffic ──────────────────────

describe("correlate() with infrastructure traffic", () => {
  it("includes infrastructureTraffic count in summary", () => {
    const anthropicWitness = makeNetworkWitness({
      id: "W_ANTHRO",
      command: "node",
      remoteHost: "api.anthropic.com",
      remotePort: 443,
    });

    const report = correlate([anthropicWitness], []);
    expect(report.summary.infrastructureTraffic).toBe(1);
    expect(report.summary.unloggedObservations).toBe(0);
    expect(report.summary.backgroundNoise).toBe(0);
  });

  it("does not generate silent_network findings for infrastructure traffic", () => {
    const witnesses: WitnessEntry[] = [
      makeNetworkWitness({ id: "W1", command: "node", remoteHost: "api.anthropic.com", remotePort: 443 }),
      makeNetworkWitness({ id: "W2", command: "node", remoteHost: "api.github.com", remotePort: 443 }),
      makeNetworkWitness({ id: "W3", command: "node", remoteHost: "registry.npmjs.org", remotePort: 443 }),
      makeNetworkWitness({ id: "W4", command: "node", remoteHost: "api.openai.com", remotePort: 443 }),
    ];

    const report = correlate(witnesses, []);
    const silentNetwork = report.findings.filter((f) => f.type === "silent_network");
    expect(silentNetwork).toHaveLength(0);
    expect(report.summary.infrastructureTraffic).toBe(4);
  });

  it("infrastructure traffic does not reduce witness confidence", () => {
    const infraWitnesses: WitnessEntry[] = [];
    for (let i = 0; i < 20; i++) {
      infraWitnesses.push(
        makeNetworkWitness({
          id: `W_INFRA_${i}`,
          command: "node",
          remoteHost: `shard${i}.anthropic.com`,
          remotePort: 443,
        }),
      );
    }

    const report = correlate(infraWitnesses, []);
    expect(report.witnessConfidence).toBe(100);
    expect(report.summary.infrastructureTraffic).toBe(20);
  });

  it("agent traffic to unknown hosts still generates findings", () => {
    const witnesses: WitnessEntry[] = [
      makeNetworkWitness({ id: "W1", command: "node", remoteHost: "api.anthropic.com", remotePort: 443 }),
      makeNetworkWitness({ id: "W2", command: "node", remoteHost: "evil.example.com", remotePort: 443 }),
    ];

    const report = correlate(witnesses, []);
    const silentNetwork = report.findings.filter((f) => f.type === "silent_network");
    expect(silentNetwork).toHaveLength(1);
    expect(silentNetwork[0]!.description).toContain("evil.example.com");
    expect(report.summary.infrastructureTraffic).toBe(1);
    expect(report.summary.unloggedObservations).toBe(1);
  });

  it("accepts custom infrastructure patterns via options", () => {
    const witness = makeNetworkWitness({
      id: "W1",
      command: "node",
      remoteHost: "api.mycompany.com",
      remotePort: 443,
    });

    // Without custom patterns — this is unknown
    const reportWithout = correlate([witness], []);
    expect(reportWithout.summary.infrastructureTraffic).toBe(0);
    expect(reportWithout.summary.unloggedObservations).toBe(1);

    // With custom patterns — classified as infrastructure
    const reportWith = correlate([witness], [], {
      customInfrastructurePatterns: [
        { host: "api.mycompany.com", label: "internal-api" },
      ],
    });
    expect(reportWith.summary.infrastructureTraffic).toBe(1);
    expect(reportWith.summary.unloggedObservations).toBe(0);
  });

  it("backward-compatible: bare timeRange still works", () => {
    const witness = makeNetworkWitness({
      id: "W1",
      command: "node",
      remoteHost: "api.anthropic.com",
      remotePort: 443,
    });

    const report = correlate([witness], [], {
      from: "2026-02-16T00:00:00.000Z",
      to: "2026-02-17T00:00:00.000Z",
    });
    expect(report.summary.infrastructureTraffic).toBe(1);
    expect(report.timeRange.from).toBe("2026-02-16T00:00:00.000Z");
  });

  it("combines background, infrastructure, and agent counts correctly", () => {
    const witnesses: WitnessEntry[] = [
      // Background noise: system process
      makeNetworkWitness({ id: "W1", command: "Chrome", remoteHost: "google.com" }),
      makeNetworkWitness({ id: "W2", command: "Safari", remoteHost: "apple.com" }),
      // Infrastructure: agent to known infra
      makeNetworkWitness({ id: "W3", command: "node", remoteHost: "api.anthropic.com", remotePort: 443 }),
      makeNetworkWitness({ id: "W4", command: "node", remoteHost: "registry.npmjs.org", remotePort: 443 }),
      makeNetworkWitness({ id: "W5", command: "node", remoteHost: "140.82.112.5", remotePort: 443 }),
      // Agent: unknown host
      makeNetworkWitness({ id: "W6", command: "node", remoteHost: "evil.example.com" }),
      // Non-network: always agent
      makeFileWitness({ id: "W7", path: "/tmp/test.txt" }),
    ];

    const report = correlate(witnesses, []);
    expect(report.summary.backgroundNoise).toBe(2);
    expect(report.summary.infrastructureTraffic).toBe(3);
    expect(report.summary.unloggedObservations).toBe(2);  // evil.example.com + file witness
  });
});

// ─── loadInfrastructurePatterns ───────────────────────────────────

describe("loadInfrastructurePatterns", () => {
  let tempDir: string;

  async function setup(): Promise<string> {
    tempDir = join(tmpdir(), `agenttrust-infra-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    return tempDir;
  }

  async function cleanup(): Promise<void> {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  it("returns empty array when config file does not exist", async () => {
    await setup();
    try {
      const result = await loadInfrastructurePatterns(join(tempDir, "nonexistent.yaml"));
      expect(result).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it("returns empty array when config has no witness section", async () => {
    await setup();
    try {
      const configPath = join(tempDir, "config.yaml");
      await writeFile(configPath, "riskThreshold: 7\nlogRetentionDays: 90\n");
      const result = await loadInfrastructurePatterns(configPath);
      expect(result).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it("returns empty array when witness section has no infrastructurePatterns", async () => {
    await setup();
    try {
      const configPath = join(tempDir, "config.yaml");
      await writeFile(configPath, "witness:\n  enabled: true\n");
      const result = await loadInfrastructurePatterns(configPath);
      expect(result).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it("loads infrastructure patterns from config", async () => {
    await setup();
    try {
      const configPath = join(tempDir, "config.yaml");
      const yaml = `
witness:
  infrastructurePatterns:
    - host: "api.mycompany.com"
      label: "internal-api"
    - host: "*.internal.mycompany.com"
      port: 443
      label: "internal-services"
`;
      await writeFile(configPath, yaml);
      const result = await loadInfrastructurePatterns(configPath);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ host: "api.mycompany.com", port: undefined, label: "internal-api" });
      expect(result[1]).toEqual({ host: "*.internal.mycompany.com", port: 443, label: "internal-services" });
    } finally {
      await cleanup();
    }
  });

  it("defaults label to 'custom' when not provided", async () => {
    await setup();
    try {
      const configPath = join(tempDir, "config.yaml");
      const yaml = `
witness:
  infrastructurePatterns:
    - host: "api.mycompany.com"
`;
      await writeFile(configPath, yaml);
      const result = await loadInfrastructurePatterns(configPath);
      expect(result).toHaveLength(1);
      expect(result[0]!.label).toBe("custom");
    } finally {
      await cleanup();
    }
  });

  it("skips entries without a host", async () => {
    await setup();
    try {
      const configPath = join(tempDir, "config.yaml");
      const yaml = `
witness:
  infrastructurePatterns:
    - label: "no-host"
    - host: "valid.example.com"
      label: "valid"
`;
      await writeFile(configPath, yaml);
      const result = await loadInfrastructurePatterns(configPath);
      expect(result).toHaveLength(1);
      expect(result[0]!.host).toBe("valid.example.com");
    } finally {
      await cleanup();
    }
  });

  it("skips entries with empty host", async () => {
    await setup();
    try {
      const configPath = join(tempDir, "config.yaml");
      const yaml = `
witness:
  infrastructurePatterns:
    - host: ""
      label: "empty"
    - host: "valid.example.com"
      label: "valid"
`;
      await writeFile(configPath, yaml);
      const result = await loadInfrastructurePatterns(configPath);
      expect(result).toHaveLength(1);
      expect(result[0]!.host).toBe("valid.example.com");
    } finally {
      await cleanup();
    }
  });

  it("returns empty array for invalid YAML", async () => {
    await setup();
    try {
      const configPath = join(tempDir, "config.yaml");
      await writeFile(configPath, "{{{{invalid yaml!!!!");
      const result = await loadInfrastructurePatterns(configPath);
      expect(result).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it("handles non-array infrastructurePatterns gracefully", async () => {
    await setup();
    try {
      const configPath = join(tempDir, "config.yaml");
      const yaml = `
witness:
  infrastructurePatterns: "not an array"
`;
      await writeFile(configPath, yaml);
      const result = await loadInfrastructurePatterns(configPath);
      expect(result).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it("handles null entries in patterns array", async () => {
    await setup();
    try {
      const configPath = join(tempDir, "config.yaml");
      const yaml = `
witness:
  infrastructurePatterns:
    - null
    - host: "valid.example.com"
      label: "valid"
`;
      await writeFile(configPath, yaml);
      const result = await loadInfrastructurePatterns(configPath);
      expect(result).toHaveLength(1);
      expect(result[0]!.host).toBe("valid.example.com");
    } finally {
      await cleanup();
    }
  });
});

import type { ATFEntry } from "../ledger/entry.js";
import type { WitnessEntry, FileWitnessEvent, ProcessWitnessEvent, NetworkWitnessEvent } from "../witness/types.js";
import type {
  CorrelationReport,
  CorrelationFinding,
  CorrelationMatch,
  InfrastructurePattern,
} from "./types.js";
import { correlateFileEvents } from "./file-correlator.js";
import { correlateProcessEvents } from "./process-correlator.js";
import { correlateNetworkEvents } from "./network-correlator.js";
import { computeWitnessConfidence } from "./scorer.js";

/** Sensitive paths that escalate unlogged observations to warning */
const SENSITIVE_PATH_PATTERNS = [
  "/.ssh/",
  "/.env",
  "/.gnupg/",
  "/credentials",
  "/.aws/",
  "/id_rsa",
  "/id_ed25519",
];

function isSensitivePath(path: string): boolean {
  const lower = path.toLowerCase();
  return SENSITIVE_PATH_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Known system process names that should be classified as background noise.
 * These processes make network connections for their own purposes and are
 * not part of the AI agent's activity.
 *
 * Matching is case-insensitive and uses substring matching (e.g. "chrome"
 * matches "Google Chrome Helper", "com.google.Chrome", etc.).
 */
export const SYSTEM_PROCESS_EXCLUSIONS: string[] = [
  // Browsers
  "chrome",
  "safari",
  "firefox",
  "webkit",
  // AI assistants (non-agent)
  "chatgpt",
  "claude",
  // Apple / macOS system
  "weather",
  "news",
  "sharingd",
  "nsurlsession",
  "apsd",
  "cloudd",
  "mds",
  "trustd",
  "rapportd",
  "identityservicesd",
  "bird",
  "assistant_service",
  "assistantd",
  "callservicesd",
  "wifiagent",
  "airplayxpc",
  "symptomsd",
  // Editors / IDEs
  "code",
  "code helper",
  "electron",
  // Printers / peripherals
  "hp",
  "canon",
  "epson",
  // System networking
  "networkserviceproxy",
  "netbiosd",
  "mdnsresponder",
  "configd",
  "systemuiserver",
];

/**
 * Check if a network witness event is from a known system process.
 * Returns true if the command matches any entry in the exclusion list
 * (case-insensitive substring match).
 */
export function isSystemProcess(command: string | undefined): boolean {
  if (!command) return false;
  const lower = command.toLowerCase();
  return SYSTEM_PROCESS_EXCLUSIONS.some((name) => lower.includes(name));
}

/**
 * Built-in infrastructure host patterns.
 * These represent hosts the agent process tree connects to as part of
 * normal operation (LLM APIs, package registries, CDNs, etc.) and should
 * not generate silent_network findings.
 *
 * Users can extend this list via `.agenttrust/config.yaml` under
 * `witness.infrastructurePatterns`.
 */
export const KNOWN_INFRASTRUCTURE_PATTERNS: InfrastructurePattern[] = [
  // Anthropic API
  { host: "api.anthropic.com", label: "anthropic" },
  { host: "*.anthropic.com", label: "anthropic" },
  { host: "2620:149:*", label: "anthropic" },
  // AWS IPs commonly used by Anthropic / cloud services (port 443 only)
  { host: "3.*", port: 443, label: "aws" },
  { host: "18.*", port: 443, label: "aws" },
  { host: "34.*", port: 443, label: "aws" },
  { host: "35.*", port: 443, label: "aws" },
  { host: "44.*", port: 443, label: "aws" },
  { host: "52.*", port: 443, label: "aws" },
  { host: "54.*", port: 443, label: "aws" },
  { host: "98.*", port: 443, label: "aws" },
  { host: "100.*", port: 443, label: "aws" },
  // GitHub
  { host: "140.82.112.*", label: "github" },
  { host: "140.82.113.*", label: "github" },
  { host: "140.82.114.*", label: "github" },
  { host: "140.82.121.*", label: "github" },
  { host: "*.github.com", label: "github" },
  { host: "*.githubusercontent.com", label: "github" },
  // Cloudflare
  { host: "104.18.*", label: "cloudflare" },
  { host: "172.64.*", label: "cloudflare" },
  { host: "172.65.*", label: "cloudflare" },
  { host: "172.66.*", label: "cloudflare" },
  { host: "172.67.*", label: "cloudflare" },
  { host: "172.68.*", label: "cloudflare" },
  { host: "172.69.*", label: "cloudflare" },
  { host: "172.70.*", label: "cloudflare" },
  { host: "172.71.*", label: "cloudflare" },
  { host: "162.159.*", label: "cloudflare" },
  { host: "2a06:98c1:*", label: "cloudflare" },
  { host: "2606:4700:*", label: "cloudflare" },
  // Google Cloud / Google services
  { host: "34.107.*", label: "google-cloud" },
  { host: "2607:f8b0:*", label: "google" },
  { host: "2001:4860:*", label: "google" },
  // Fastly CDN
  { host: "2607:6bc0:*", label: "fastly" },
  // npm registry
  { host: "registry.npmjs.org", label: "npm" },
  { host: "*.npmjs.org", label: "npm" },
  { host: "*.npmjs.com", label: "npm" },
  // OpenAI (for agents that use OpenAI)
  { host: "api.openai.com", label: "openai" },
  { host: "*.openai.com", label: "openai" },
];

/**
 * Check if a host/port combination matches an infrastructure pattern.
 *
 * Pattern matching rules:
 * - Exact: "api.anthropic.com" matches only that hostname
 * - Wildcard subdomain: "*.anthropic.com" matches "x.anthropic.com"
 * - IP prefix: "140.82.112.*" matches "140.82.112.0" through "140.82.112.255"
 * - Broad IP prefix: "3.*" matches any IP starting with "3."
 * - IPv6 prefix: "2606:4700:*" matches "2606:4700:..." addresses
 * - Port filtering: If pattern has a port, the connection port must match
 */
export function matchesInfrastructurePattern(
  host: string,
  port: number | undefined,
  pattern: InfrastructurePattern,
): boolean {
  // Check port constraint first (fast rejection)
  if (pattern.port !== undefined && port !== undefined && pattern.port !== port) {
    return false;
  }

  const patternHost = pattern.host;

  // Wildcard subdomain: "*.anthropic.com"
  if (patternHost.startsWith("*.")) {
    const suffix = patternHost.slice(1); // ".anthropic.com"
    return host.endsWith(suffix) || host === patternHost.slice(2);
  }

  // IP/IPv6 prefix wildcard: "140.82.112.*" or "3.*" or "2606:4700:*"
  if (patternHost.endsWith(".*") || patternHost.endsWith(":*")) {
    const prefix = patternHost.slice(0, -1); // "140.82.112." or "3." or "2606:4700:"
    return host.startsWith(prefix);
  }

  // Exact match
  return host === patternHost;
}

/**
 * Check if a network connection is to known infrastructure.
 * Checks against both built-in patterns and user-supplied custom patterns.
 */
export function isInfrastructureTraffic(
  host: string,
  port: number | undefined,
  customPatterns?: InfrastructurePattern[],
): boolean {
  const allPatterns = customPatterns
    ? [...KNOWN_INFRASTRUCTURE_PATTERNS, ...customPatterns]
    : KNOWN_INFRASTRUCTURE_PATTERNS;

  return allPatterns.some((p) => matchesInfrastructurePattern(host, port, p));
}

/** Options for the correlate() function */
export interface CorrelateOptions {
  /** Time range for the report */
  timeRange?: { from: string; to: string };
  /** Additional infrastructure patterns from user config */
  customInfrastructurePatterns?: InfrastructurePattern[];
}

/**
 * Run full correlation between witness events and execution entries.
 */
export function correlate(
  witnessEntries: WitnessEntry[],
  executions: ATFEntry[],
  timeRangeOrOptions?: { from: string; to: string } | CorrelateOptions,
): CorrelationReport {
  // Normalize arguments: support both old (timeRange) and new (options) forms
  let timeRange: { from: string; to: string } | undefined;
  let customInfraPatterns: InfrastructurePattern[] | undefined;

  if (timeRangeOrOptions) {
    if ("from" in timeRangeOrOptions && "to" in timeRangeOrOptions) {
      // Old-style: bare timeRange object
      timeRange = timeRangeOrOptions as { from: string; to: string };
    } else {
      // New-style: options object
      const opts = timeRangeOrOptions as CorrelateOptions;
      timeRange = opts.timeRange;
      customInfraPatterns = opts.customInfrastructurePatterns;
    }
  }

  // Run all three correlators
  const fileMatches = correlateFileEvents(witnessEntries, executions);
  const processMatches = correlateProcessEvents(witnessEntries, executions);
  const networkMatches = correlateNetworkEvents(witnessEntries, executions);

  const allMatches = [...fileMatches, ...processMatches, ...networkMatches];

  // Collect IDs of matched entries
  const matchedWitnessIds = new Set(allMatches.map((m) => m.witnessEntry.id));
  const matchedExecIds = new Set(allMatches.map((m) => m.executionEntry.id));

  // Find unwitnessed executions
  const unwitnessedExecs = findUnwitnessed(executions, matchedExecIds);

  // Find unlogged observations
  const unloggedObs = findUnlogged(witnessEntries, matchedWitnessIds);

  // Classify: background noise → infrastructure → agent observations
  const classified = classifyUnloggedObservations(unloggedObs, customInfraPatterns);

  // Generate findings from agent observations only
  const findings = generateFindings(allMatches, unwitnessedExecs, classified.agentObservations);

  // Count mismatched pairs (matches with discrepancies)
  const mismatchedPairs = allMatches.filter((m) => m.discrepancies.length > 0).length;

  // Compute witness confidence score with proportional model
  const witnessConfidence = computeWitnessConfidence(findings, {
    totalWitnessEvents: witnessEntries.length,
    totalExecutionEntries: executions.length,
    correlatedPairs: allMatches.length,
    backgroundNoise: classified.backgroundNoise.length,
    infrastructureTraffic: classified.infrastructureTraffic.length,
  });

  // Determine time range
  const now = new Date().toISOString();
  const range = timeRange ?? { from: now, to: now };

  return {
    generatedAt: now,
    timeRange: range,
    summary: {
      totalWitnessEvents: witnessEntries.length,
      totalExecutionEntries: executions.length,
      correlatedPairs: allMatches.length,
      unwitnessedExecutions: unwitnessedExecs.length,
      unloggedObservations: classified.agentObservations.length,
      mismatchedPairs,
      backgroundNoise: classified.backgroundNoise.length,
      infrastructureTraffic: classified.infrastructureTraffic.length,
    },
    findings,
    matches: allMatches,
    witnessConfidence,
  };
}

/**
 * Classification result for unlogged observations.
 */
export interface ClassifiedObservations {
  /** Observations that may represent genuine agent actions — these get findings */
  agentObservations: WitnessEntry[];
  /** Network events from system processes (Chrome, VS Code, etc.) */
  backgroundNoise: WitnessEntry[];
  /** Network events to known infrastructure hosts (Anthropic API, GitHub, npm, etc.) */
  infrastructureTraffic: WitnessEntry[];
}

/**
 * Classify unlogged witness observations into three buckets:
 *
 * 1. **Background noise** — Network events from known system processes
 *    (Chrome, VS Code, Weather, etc.) that are not part of the agent.
 * 2. **Infrastructure traffic** — Network events from the agent process tree
 *    to known infrastructure hosts (Anthropic API, GitHub, npm, Cloudflare).
 *    These are expected and should not generate findings.
 * 3. **Agent observations** — Everything else. These may represent genuine
 *    unreported agent actions and will generate correlation findings.
 */
export function classifyUnloggedObservations(
  unloggedObs: WitnessEntry[],
  customInfraPatterns?: InfrastructurePattern[],
): ClassifiedObservations {
  const agentObservations: WitnessEntry[] = [];
  const backgroundNoise: WitnessEntry[] = [];
  const infrastructureTraffic: WitnessEntry[] = [];

  for (const witness of unloggedObs) {
    if (witness.source === "network") {
      const netEvent = witness.event as NetworkWitnessEvent;

      // Step 1: System process → background noise
      if (isSystemProcess(netEvent.command)) {
        backgroundNoise.push(witness);
        continue;
      }

      // Step 2: Infrastructure host → infrastructure traffic
      if (isInfrastructureTraffic(netEvent.remoteHost, netEvent.remotePort, customInfraPatterns)) {
        infrastructureTraffic.push(witness);
        continue;
      }
    }

    // Everything else is an agent observation
    agentObservations.push(witness);
  }

  return { agentObservations, backgroundNoise, infrastructureTraffic };
}

/**
 * Find execution entries that have no matching witness event.
 * Only considers action types that SHOULD have witness events.
 */
export function findUnwitnessed(
  executions: ATFEntry[],
  correlatedIds: Set<string>,
): ATFEntry[] {
  const witnessableTypes = new Set([
    "file.read",
    "file.write",
    "file.delete",
    "exec.command",
    "exec.script",
    "api.call",
    "web.fetch",
    "web.search",
    "web.browse",
  ]);

  return executions.filter(
    (e) => !correlatedIds.has(e.id) && witnessableTypes.has(e.action.type),
  );
}

/**
 * Find witness entries that have no matching execution entry.
 */
export function findUnlogged(
  witnessEntries: WitnessEntry[],
  correlatedIds: Set<string>,
): WitnessEntry[] {
  return witnessEntries.filter((w) => !correlatedIds.has(w.id));
}

/**
 * Generate findings from matches, unwitnessed executions, and unlogged observations.
 */
export function generateFindings(
  matches: CorrelationMatch[],
  unwitnessedExecs: ATFEntry[],
  unloggedObs: WitnessEntry[],
): CorrelationFinding[] {
  const findings: CorrelationFinding[] = [];

  // Discrepancies from matched pairs
  for (const match of matches) {
    findings.push(...match.discrepancies);
  }

  // Unwitnessed executions
  for (const exec of unwitnessedExecs) {
    const isHighRisk = exec.risk.score >= 7;
    const isProcess = exec.action.type === "exec.command" || exec.action.type === "exec.script";

    if (isProcess) {
      findings.push({
        type: "phantom_process",
        severity: "critical",
        description: `Agent logged "${exec.action.type}: ${exec.action.target}" but no matching process was observed by witness`,
        execution: exec,
        details: {
          actionType: exec.action.type,
          target: exec.action.target,
          riskScore: exec.risk.score,
        },
      });
    } else {
      findings.push({
        type: "unwitnessed_execution",
        severity: isHighRisk ? "critical" : "warning",
        description: `Agent logged ${exec.action.type} on "${exec.action.target}" but witness did not observe it`,
        execution: exec,
        details: {
          actionType: exec.action.type,
          target: exec.action.target,
          riskScore: exec.risk.score,
        },
      });
    }
  }

  // Unlogged observations (only report notable ones)
  for (const witness of unloggedObs) {
    const event = witness.event;

    if (witness.source === "filesystem") {
      const fileEvent = event as FileWitnessEvent;
      const sensitive = isSensitivePath(fileEvent.path);

      if (sensitive) {
        findings.push({
          type: "silent_file_access",
          severity: "warning",
          description: `Witness saw ${fileEvent.type} at ${fileEvent.path} but no execution entry matches`,
          witnessEvent: witness,
          details: {
            eventType: fileEvent.type,
            path: fileEvent.path,
            sensitive: true,
          },
        });
      }
      // Non-sensitive file events are classified as background noise
    } else if (witness.source === "network") {
      const netEvent = event as NetworkWitnessEvent;
      findings.push({
        type: "silent_network",
        severity: "warning",
        description: `Witness observed connection to ${netEvent.remoteHost}:${netEvent.remotePort ?? "?"} but no execution entry contains this host`,
        witnessEvent: witness,
        details: {
          remoteHost: netEvent.remoteHost,
          remotePort: netEvent.remotePort,
          protocol: netEvent.protocol,
        },
      });
    } else if (witness.source === "process") {
      const procEvent = event as ProcessWitnessEvent;
      if (procEvent.type === "process_spawned") {
        findings.push({
          type: "unlogged_observation",
          severity: "info",
          description: `Witness observed process spawn (${procEvent.command}, PID ${procEvent.pid}) but no execution entry matches`,
          witnessEvent: witness,
          details: {
            command: procEvent.command,
            pid: procEvent.pid,
            ppid: procEvent.ppid,
          },
        });
      }
    }
  }

  return findings;
}

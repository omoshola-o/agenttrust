import { describe, it, expect } from "vitest";
import {
  extractHostFromTarget,
  hostMatches,
  correlateNetworkEvents,
} from "../../src/correlation/network-correlator.js";
import type { ATFEntry } from "../../src/ledger/entry.js";
import type { WitnessEntry, NetworkWitnessEvent } from "../../src/witness/types.js";

const BASE_TS = "2026-02-13T14:32:00.000Z";

function makeExecEntry(overrides?: {
  id?: string;
  ts?: string;
  action?: Partial<ATFEntry["action"]>;
  risk?: Partial<ATFEntry["risk"]>;
  meta?: Record<string, unknown>;
}): ATFEntry {
  return {
    id: overrides?.id ?? "EXEC_" + Math.random().toString(36).slice(2, 10).toUpperCase(),
    v: 1,
    ts: overrides?.ts ?? BASE_TS,
    prevHash: "",
    hash: "exechash123",
    agent: "default",
    session: "ses_test",
    action: {
      type: "api.call" as ATFEntry["action"]["type"],
      target: "https://api.example.com/data",
      detail: "Fetched data",
      ...overrides?.action,
    },
    context: { goal: "Test", trigger: "inbound_message" },
    outcome: { status: "success", durationMs: 10 },
    risk: {
      score: 1,
      labels: [],
      autoFlagged: false,
      ...overrides?.risk,
    },
    ...(overrides?.meta ? { meta: overrides.meta } : {}),
  } as ATFEntry;
}

function makeNetworkWitness(overrides?: {
  id?: string;
  ts?: string;
  eventType?: NetworkWitnessEvent["type"];
  remoteHost?: string;
  remotePort?: number;
  protocol?: "tcp" | "udp";
}): WitnessEntry {
  return {
    id: overrides?.id ?? "WIT_" + Math.random().toString(36).slice(2, 10).toUpperCase(),
    v: 1,
    ts: overrides?.ts ?? BASE_TS,
    prevHash: "",
    hash: "witnhash123",
    source: "network",
    event: {
      type: overrides?.eventType ?? "connection_opened",
      remoteHost: overrides?.remoteHost ?? "api.example.com",
      remotePort: overrides?.remotePort ?? 443,
      protocol: overrides?.protocol ?? "tcp",
      observedAt: overrides?.ts ?? BASE_TS,
    } as NetworkWitnessEvent,
    correlated: false,
  };
}

describe("network-correlator", () => {
  describe("extractHostFromTarget", () => {
    it("extracts hostname from full URL", () => {
      expect(extractHostFromTarget("https://api.example.com/v1/data")).toBe("api.example.com");
    });

    it("extracts host from host:port notation", () => {
      expect(extractHostFromTarget("db.internal.io:5432")).toBe("db.internal.io");
    });

    it("returns bare hostname when it looks like one", () => {
      expect(extractHostFromTarget("api.example.com")).toBe("api.example.com");
    });

    it("returns null for invalid input without dots or schemes", () => {
      expect(extractHostFromTarget("just-a-word")).toBeNull();
    });

    it("extracts host from URL with path but no scheme", () => {
      expect(extractHostFromTarget("api.example.com/v1/users")).toBe("api.example.com");
    });

    it("handles http scheme URLs", () => {
      expect(extractHostFromTarget("http://localhost:3000/api")).toBe("localhost");
    });
  });

  describe("hostMatches", () => {
    it("returns true for exact match", () => {
      expect(hostMatches("api.example.com", "https://api.example.com/data")).toBe(true);
    });

    it("returns true for substring match (subdomain contains target)", () => {
      expect(hostMatches("api.example.com", "https://example.com/data")).toBe(true);
    });

    it("returns false when hosts are completely different", () => {
      expect(hostMatches("api.example.com", "https://other.io/data")).toBe(false);
    });

    it("returns false when target cannot produce a host", () => {
      expect(hostMatches("api.example.com", "just-a-word")).toBe(false);
    });
  });

  describe("correlateNetworkEvents", () => {
    it("matches connection_opened with api.call entry by host and time", () => {
      const witness = makeNetworkWitness({ remoteHost: "api.example.com" });
      const exec = makeExecEntry({
        action: { type: "api.call" as ATFEntry["action"]["type"], target: "https://api.example.com/data", detail: "Fetched data" },
      });

      const matches = correlateNetworkEvents([witness], [exec]);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.witnessEntry.id).toBe(witness.id);
      expect(matches[0]!.executionEntry.id).toBe(exec.id);
      expect(matches[0]!.confidence).toBe(100);
    });

    it("does not match when time difference exceeds 10s window", () => {
      const witnessTs = "2026-02-13T14:32:00.000Z";
      const execTs = "2026-02-13T14:32:11.000Z"; // 11s apart
      const witness = makeNetworkWitness({ ts: witnessTs, remoteHost: "api.example.com" });
      const exec = makeExecEntry({
        ts: execTs,
        action: { type: "api.call" as ATFEntry["action"]["type"], target: "https://api.example.com/data", detail: "Fetched" },
      });

      const matches = correlateNetworkEvents([witness], [exec]);
      expect(matches).toHaveLength(0);
    });

    it("matches within the 10s window", () => {
      const witnessTs = "2026-02-13T14:32:00.000Z";
      const execTs = "2026-02-13T14:32:09.000Z"; // 9s apart
      const witness = makeNetworkWitness({ ts: witnessTs, remoteHost: "api.example.com" });
      const exec = makeExecEntry({
        ts: execTs,
        action: { type: "api.call" as ATFEntry["action"]["type"], target: "https://api.example.com/data", detail: "Fetched" },
      });

      const matches = correlateNetworkEvents([witness], [exec]);
      expect(matches).toHaveLength(1);
    });

    it("detects host evidence mismatch", () => {
      const witness = makeNetworkWitness({ remoteHost: "api.example.com" });
      const exec = makeExecEntry({
        action: { type: "api.call" as ATFEntry["action"]["type"], target: "https://api.example.com/data", detail: "Fetched" },
        meta: { networkEvidence: { remoteHost: "other.example.com", port: 443 } },
      });

      const matches = correlateNetworkEvents([witness], [exec]);
      expect(matches).toHaveLength(1);
      const evidenceFindings = matches[0]!.discrepancies.filter((d) => d.type === "evidence_mismatch");
      expect(evidenceFindings.length).toBeGreaterThanOrEqual(1);
      expect(matches[0]!.confidence).toBeLessThan(100);
    });

    it("detects port evidence mismatch", () => {
      const witness = makeNetworkWitness({ remoteHost: "api.example.com", remotePort: 443 });
      const exec = makeExecEntry({
        action: { type: "api.call" as ATFEntry["action"]["type"], target: "https://api.example.com/data", detail: "Fetched" },
        meta: { networkEvidence: { remoteHost: "api.example.com", port: 8080 } },
      });

      const matches = correlateNetworkEvents([witness], [exec]);
      expect(matches).toHaveLength(1);
      const portDiscrepancy = matches[0]!.discrepancies.filter(
        (d) => d.type === "evidence_mismatch" && (d.details as Record<string, unknown>)["witnessPort"] !== undefined,
      );
      expect(portDiscrepancy).toHaveLength(1);
    });

    it("only correlates connection_opened events, not connection_closed", () => {
      const closedWitness = makeNetworkWitness({
        remoteHost: "api.example.com",
        eventType: "connection_closed",
      });
      const exec = makeExecEntry({
        action: { type: "api.call" as ATFEntry["action"]["type"], target: "https://api.example.com/data", detail: "Fetched" },
      });

      const matches = correlateNetworkEvents([closedWitness], [exec]);
      expect(matches).toHaveLength(0);
    });

    it("only correlates connection_opened events, not dns_query", () => {
      const dnsWitness = makeNetworkWitness({
        remoteHost: "api.example.com",
        eventType: "dns_query",
      });
      const exec = makeExecEntry({
        action: { type: "api.call" as ATFEntry["action"]["type"], target: "https://api.example.com/data", detail: "Fetched" },
      });

      const matches = correlateNetworkEvents([dnsWitness], [exec]);
      expect(matches).toHaveLength(0);
    });

    it("returns empty matches for empty inputs", () => {
      expect(correlateNetworkEvents([], [])).toEqual([]);
      expect(correlateNetworkEvents([], [makeExecEntry()])).toEqual([]);
      expect(correlateNetworkEvents([makeNetworkWitness()], [])).toEqual([]);
    });

    it("matches web.fetch execution type", () => {
      const witness = makeNetworkWitness({ remoteHost: "cdn.example.com" });
      const exec = makeExecEntry({
        action: { type: "web.fetch" as ATFEntry["action"]["type"], target: "https://cdn.example.com/bundle.js", detail: "Fetched bundle" },
      });

      const matches = correlateNetworkEvents([witness], [exec]);
      expect(matches).toHaveLength(1);
    });

    it("detects timing discrepancy when diff exceeds 5s", () => {
      const witnessTs = "2026-02-13T14:32:00.000Z";
      const execTs = "2026-02-13T14:32:07.000Z"; // 7s apart
      const witness = makeNetworkWitness({ ts: witnessTs, remoteHost: "api.example.com" });
      const exec = makeExecEntry({
        ts: execTs,
        action: { type: "api.call" as ATFEntry["action"]["type"], target: "https://api.example.com/data", detail: "Fetched" },
      });

      const matches = correlateNetworkEvents([witness], [exec]);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.discrepancies.some((d) => d.type === "timing_discrepancy")).toBe(true);
    });
  });
});

import { describe, it, expect } from "vitest";
import {
  correlate,
  findUnwitnessed,
  findUnlogged,
  generateFindings,
} from "../../src/correlation/engine.js";
import type { ATFEntry } from "../../src/ledger/entry.js";
import type { WitnessEntry, FileWitnessEvent, ProcessWitnessEvent, NetworkWitnessEvent } from "../../src/witness/types.js";
import type { CorrelationMatch } from "../../src/correlation/types.js";

const BASE_TS = "2026-02-13T14:32:00.000Z";

function makeExecEntry(overrides?: {
  id?: string;
  ts?: string;
  actionType?: string;
  target?: string;
  detail?: string;
  riskScore?: number;
  riskLabels?: string[];
  meta?: Record<string, unknown>;
}): ATFEntry {
  return {
    id: overrides?.id ?? "EXEC_" + Math.random().toString(36).slice(2, 10).toUpperCase(),
    v: 1,
    ts: overrides?.ts ?? BASE_TS,
    prevHash: "",
    hash: "exechash_" + Math.random().toString(36).slice(2, 6),
    agent: "default",
    session: "ses_test",
    action: {
      type: (overrides?.actionType ?? "file.write") as ATFEntry["action"]["type"],
      target: overrides?.target ?? "/tmp/test.txt",
      detail: overrides?.detail ?? "Did something",
    },
    context: { goal: "Test", trigger: "inbound_message" },
    outcome: { status: "success", durationMs: 10 },
    risk: {
      score: overrides?.riskScore ?? 1,
      labels: (overrides?.riskLabels ?? []) as ATFEntry["risk"]["labels"],
      autoFlagged: false,
    },
    ...(overrides?.meta ? { meta: overrides.meta } : {}),
  } as ATFEntry;
}

function makeFileWitness(overrides?: {
  id?: string;
  ts?: string;
  eventType?: FileWitnessEvent["type"];
  path?: string;
}): WitnessEntry {
  return {
    id: overrides?.id ?? "WIT_F_" + Math.random().toString(36).slice(2, 10).toUpperCase(),
    v: 1,
    ts: overrides?.ts ?? BASE_TS,
    prevHash: "",
    hash: "witnhash_" + Math.random().toString(36).slice(2, 6),
    source: "filesystem",
    event: {
      type: overrides?.eventType ?? "file_modified",
      path: overrides?.path ?? "/tmp/test.txt",
      observedAt: overrides?.ts ?? BASE_TS,
    } as FileWitnessEvent,
    correlated: false,
  };
}

function makeProcessWitness(overrides?: {
  id?: string;
  ts?: string;
  eventType?: ProcessWitnessEvent["type"];
  command?: string;
  pid?: number;
}): WitnessEntry {
  return {
    id: overrides?.id ?? "WIT_P_" + Math.random().toString(36).slice(2, 10).toUpperCase(),
    v: 1,
    ts: overrides?.ts ?? BASE_TS,
    prevHash: "",
    hash: "witnhash_" + Math.random().toString(36).slice(2, 6),
    source: "process",
    event: {
      type: overrides?.eventType ?? "process_spawned",
      command: overrides?.command ?? "npm test",
      pid: overrides?.pid ?? 12345,
      ppid: 1,
      observedAt: overrides?.ts ?? BASE_TS,
    } as ProcessWitnessEvent,
    correlated: false,
  };
}

function makeNetworkWitness(overrides?: {
  id?: string;
  ts?: string;
  eventType?: NetworkWitnessEvent["type"];
  remoteHost?: string;
  remotePort?: number;
}): WitnessEntry {
  return {
    id: overrides?.id ?? "WIT_N_" + Math.random().toString(36).slice(2, 10).toUpperCase(),
    v: 1,
    ts: overrides?.ts ?? BASE_TS,
    prevHash: "",
    hash: "witnhash_" + Math.random().toString(36).slice(2, 6),
    source: "network",
    event: {
      type: overrides?.eventType ?? "connection_opened",
      remoteHost: overrides?.remoteHost ?? "api.example.com",
      remotePort: overrides?.remotePort ?? 443,
      protocol: "tcp" as const,
      observedAt: overrides?.ts ?? BASE_TS,
    } as NetworkWitnessEvent,
    correlated: false,
  };
}

describe("correlation-engine", () => {
  describe("correlate", () => {
    it("produces correct report with summary counts for matching entries", () => {
      const witness = makeFileWitness({ id: "WIT_1", path: "/tmp/test.txt" });
      const exec = makeExecEntry({
        id: "EXEC_1",
        actionType: "file.write",
        target: "/tmp/test.txt",
      });

      const report = correlate([witness], [exec]);

      expect(report.summary.totalWitnessEvents).toBe(1);
      expect(report.summary.totalExecutionEntries).toBe(1);
      expect(report.summary.correlatedPairs).toBe(1);
      expect(report.summary.unwitnessedExecutions).toBe(0);
      expect(report.summary.unloggedObservations).toBe(0);
      expect(report.matches).toHaveLength(1);
      expect(typeof report.generatedAt).toBe("string");
      expect(typeof report.witnessConfidence).toBe("number");
    });

    it("produces clean report with 100 confidence for empty inputs", () => {
      const report = correlate([], []);

      expect(report.summary.totalWitnessEvents).toBe(0);
      expect(report.summary.totalExecutionEntries).toBe(0);
      expect(report.summary.correlatedPairs).toBe(0);
      expect(report.summary.unwitnessedExecutions).toBe(0);
      expect(report.summary.unloggedObservations).toBe(0);
      expect(report.findings).toHaveLength(0);
      expect(report.witnessConfidence).toBe(100);
    });

    it("counts unwitnessed executions correctly", () => {
      const exec1 = makeExecEntry({ id: "EXEC_1", actionType: "file.write", target: "/tmp/a.txt" });
      const exec2 = makeExecEntry({ id: "EXEC_2", actionType: "file.read", target: "/tmp/b.txt" });
      // No witnesses
      const report = correlate([], [exec1, exec2]);

      expect(report.summary.unwitnessedExecutions).toBe(2);
      expect(report.summary.correlatedPairs).toBe(0);
    });

    it("counts unlogged observations correctly", () => {
      const witness1 = makeFileWitness({ id: "WIT_1", path: "/tmp/a.txt" });
      const witness2 = makeProcessWitness({ id: "WIT_2", command: "npm test" });
      // No execution entries
      const report = correlate([witness1, witness2], []);

      expect(report.summary.unloggedObservations).toBe(2);
      expect(report.summary.correlatedPairs).toBe(0);
    });

    it("uses provided time range", () => {
      const range = { from: "2026-02-13T00:00:00Z", to: "2026-02-13T23:59:59Z" };
      const report = correlate([], [], range);
      expect(report.timeRange).toEqual(range);
    });

    it("counts mismatched pairs when matches have discrepancies", () => {
      // Witness saw delete, agent logged write -- creates target_discrepancy
      const witness = makeFileWitness({ id: "WIT_1", path: "/tmp/test.txt", eventType: "file_deleted" });
      const exec = makeExecEntry({ id: "EXEC_1", actionType: "file.write", target: "/tmp/test.txt" });

      const report = correlate([witness], [exec]);
      expect(report.summary.mismatchedPairs).toBeGreaterThanOrEqual(1);
    });
  });

  describe("findUnwitnessed", () => {
    it("finds exec entries without witness matches", () => {
      const exec1 = makeExecEntry({ id: "EXEC_1", actionType: "file.write" });
      const exec2 = makeExecEntry({ id: "EXEC_2", actionType: "exec.command" });
      const correlatedIds = new Set(["EXEC_1"]);

      const result = findUnwitnessed([exec1, exec2], correlatedIds);
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("EXEC_2");
    });

    it("does not flag non-witnessable action types", () => {
      const exec = makeExecEntry({ id: "EXEC_1", actionType: "message.send", target: "someone" });
      const correlatedIds = new Set<string>();

      const result = findUnwitnessed([exec], correlatedIds);
      expect(result).toHaveLength(0);
    });

    it("returns empty for empty executions", () => {
      const result = findUnwitnessed([], new Set());
      expect(result).toEqual([]);
    });
  });

  describe("findUnlogged", () => {
    it("finds witness entries without exec matches", () => {
      const w1 = makeFileWitness({ id: "WIT_1" });
      const w2 = makeFileWitness({ id: "WIT_2" });
      const correlatedIds = new Set(["WIT_1"]);

      const result = findUnlogged([w1, w2], correlatedIds);
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("WIT_2");
    });

    it("returns empty when all are correlated", () => {
      const w1 = makeFileWitness({ id: "WIT_1" });
      const result = findUnlogged([w1], new Set(["WIT_1"]));
      expect(result).toEqual([]);
    });
  });

  describe("generateFindings", () => {
    it("generates phantom_process for unmatched exec.command", () => {
      const exec = makeExecEntry({
        id: "EXEC_CMD",
        actionType: "exec.command",
        target: "rm -rf /tmp/important",
      });

      const findings = generateFindings([], [exec], []);
      const phantoms = findings.filter((f) => f.type === "phantom_process");
      expect(phantoms).toHaveLength(1);
      expect(phantoms[0]!.severity).toBe("critical");
      expect(phantoms[0]!.execution).toBeDefined();
    });

    it("generates phantom_process for unmatched exec.script", () => {
      const exec = makeExecEntry({
        id: "EXEC_SCRIPT",
        actionType: "exec.script",
        target: "/home/user/deploy.sh",
      });

      const findings = generateFindings([], [exec], []);
      const phantoms = findings.filter((f) => f.type === "phantom_process");
      expect(phantoms).toHaveLength(1);
      expect(phantoms[0]!.severity).toBe("critical");
    });

    it("generates unwitnessed_execution for unmatched file.write", () => {
      const exec = makeExecEntry({
        id: "EXEC_FILE",
        actionType: "file.write",
        target: "/tmp/output.txt",
        riskScore: 3,
      });

      const findings = generateFindings([], [exec], []);
      const unwitnessed = findings.filter((f) => f.type === "unwitnessed_execution");
      expect(unwitnessed).toHaveLength(1);
      expect(unwitnessed[0]!.severity).toBe("warning");
    });

    it("escalates unwitnessed_execution to critical for high risk score", () => {
      const exec = makeExecEntry({
        id: "EXEC_RISKY",
        actionType: "file.write",
        target: "/tmp/important.dat",
        riskScore: 8,
      });

      const findings = generateFindings([], [exec], []);
      const unwitnessed = findings.filter((f) => f.type === "unwitnessed_execution");
      expect(unwitnessed).toHaveLength(1);
      expect(unwitnessed[0]!.severity).toBe("critical");
    });

    it("generates silent_network for unmatched connection events", () => {
      const witness = makeNetworkWitness({
        id: "WIT_NET",
        remoteHost: "suspicious.example.com",
        remotePort: 8443,
      });

      const findings = generateFindings([], [], [witness]);
      const silentNet = findings.filter((f) => f.type === "silent_network");
      expect(silentNet).toHaveLength(1);
      expect(silentNet[0]!.severity).toBe("warning");
      expect(silentNet[0]!.witnessEvent).toBeDefined();
    });

    it("generates silent_file_access for sensitive unmatched files", () => {
      const witness = makeFileWitness({
        id: "WIT_SSH",
        path: "/home/user/.ssh/id_rsa",
        eventType: "file_accessed",
      });

      const findings = generateFindings([], [], [witness]);
      const silentFile = findings.filter((f) => f.type === "silent_file_access");
      expect(silentFile).toHaveLength(1);
      expect(silentFile[0]!.severity).toBe("warning");
    });

    it("does not generate silent_file_access for non-sensitive files", () => {
      const witness = makeFileWitness({
        id: "WIT_NORMAL",
        path: "/tmp/benign.txt",
        eventType: "file_accessed",
      });

      const findings = generateFindings([], [], [witness]);
      const silentFile = findings.filter((f) => f.type === "silent_file_access");
      expect(silentFile).toHaveLength(0);
    });

    it("generates unlogged_observation for unmatched process_spawned", () => {
      const witness = makeProcessWitness({
        id: "WIT_PROC",
        command: "curl http://evil.com",
        pid: 9999,
        eventType: "process_spawned",
      });

      const findings = generateFindings([], [], [witness]);
      const unlogged = findings.filter((f) => f.type === "unlogged_observation");
      expect(unlogged).toHaveLength(1);
      expect(unlogged[0]!.severity).toBe("info");
    });

    it("does not generate unlogged_observation for process_exited events", () => {
      const witness = makeProcessWitness({
        id: "WIT_EXIT",
        command: "npm test",
        eventType: "process_exited",
      });

      const findings = generateFindings([], [], [witness]);
      const unlogged = findings.filter((f) => f.type === "unlogged_observation");
      expect(unlogged).toHaveLength(0);
    });

    it("includes discrepancies from matched pairs", () => {
      const exec = makeExecEntry({ id: "EXEC_1" });
      const witness = makeFileWitness({ id: "WIT_1" });
      const matchWithDiscrepancy: CorrelationMatch = {
        witnessEntry: witness,
        executionEntry: exec,
        confidence: 70,
        discrepancies: [
          {
            type: "target_discrepancy",
            severity: "critical",
            description: "Mismatch",
            details: {},
          },
        ],
      };

      const findings = generateFindings([matchWithDiscrepancy], [], []);
      expect(findings.some((f) => f.type === "target_discrepancy")).toBe(true);
    });

    it("returns empty findings for all empty inputs", () => {
      const findings = generateFindings([], [], []);
      expect(findings).toHaveLength(0);
    });
  });
});

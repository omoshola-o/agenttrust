import { describe, it, expect } from "vitest";
import { commandMatches, correlateProcessEvents } from "../../src/correlation/process-correlator.js";
import type { ATFEntry } from "../../src/ledger/entry.js";
import type { WitnessEntry, ProcessWitnessEvent } from "../../src/witness/types.js";

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
      type: "exec.command" as ATFEntry["action"]["type"],
      target: "ls -la",
      detail: "Listed files",
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

function makeProcessWitness(overrides?: {
  id?: string;
  ts?: string;
  eventType?: ProcessWitnessEvent["type"];
  command?: string;
  pid?: number;
  ppid?: number;
}): WitnessEntry {
  return {
    id: overrides?.id ?? "WIT_" + Math.random().toString(36).slice(2, 10).toUpperCase(),
    v: 1,
    ts: overrides?.ts ?? BASE_TS,
    prevHash: "",
    hash: "witnhash123",
    source: "process",
    event: {
      type: overrides?.eventType ?? "process_spawned",
      command: overrides?.command ?? "ls -la",
      pid: overrides?.pid ?? 12345,
      ppid: overrides?.ppid ?? 1,
      observedAt: overrides?.ts ?? BASE_TS,
    } as ProcessWitnessEvent,
    correlated: false,
  };
}

describe("process-correlator", () => {
  describe("commandMatches", () => {
    it("returns true for exact match", () => {
      expect(commandMatches("ls -la", "ls -la")).toBe(true);
    });

    it("returns true with path prefix stripping", () => {
      expect(commandMatches("/usr/bin/node script.js", "node script.js")).toBe(true);
    });

    it("returns true for fuzzy match (one contains the other)", () => {
      expect(commandMatches("git push origin main", "git push")).toBe(true);
    });

    it("returns false for completely different commands", () => {
      expect(commandMatches("npm install", "docker build")).toBe(false);
    });

    it("returns true for base command match after path strip", () => {
      expect(commandMatches("/usr/local/bin/python3 -m pytest", "/opt/bin/python3 run.py")).toBe(true);
    });

    it("normalizes whitespace before comparison", () => {
      expect(commandMatches("ls   -la   /tmp", "ls -la /tmp")).toBe(true);
    });
  });

  describe("correlateProcessEvents", () => {
    it("matches process_spawned with exec.command entry by command and time", () => {
      const witness = makeProcessWitness({ command: "ls -la" });
      const exec = makeExecEntry({ action: { type: "exec.command" as ATFEntry["action"]["type"], target: "ls -la", detail: "Listed files" } });

      const matches = correlateProcessEvents([witness], [exec]);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.witnessEntry.id).toBe(witness.id);
      expect(matches[0]!.executionEntry.id).toBe(exec.id);
      expect(matches[0]!.confidence).toBe(100);
    });

    it("does not match when time difference exceeds 5s window", () => {
      const witnessTs = "2026-02-13T14:32:00.000Z";
      const execTs = "2026-02-13T14:32:06.000Z"; // 6s apart
      const witness = makeProcessWitness({ ts: witnessTs, command: "ls -la" });
      const exec = makeExecEntry({
        ts: execTs,
        action: { type: "exec.command" as ATFEntry["action"]["type"], target: "ls -la", detail: "Listed files" },
      });

      const matches = correlateProcessEvents([witness], [exec]);
      expect(matches).toHaveLength(0);
    });

    it("matches within the 5s window", () => {
      const witnessTs = "2026-02-13T14:32:00.000Z";
      const execTs = "2026-02-13T14:32:04.000Z"; // 4s apart
      const witness = makeProcessWitness({ ts: witnessTs, command: "ls -la" });
      const exec = makeExecEntry({
        ts: execTs,
        action: { type: "exec.command" as ATFEntry["action"]["type"], target: "ls -la", detail: "Listed files" },
      });

      const matches = correlateProcessEvents([witness], [exec]);
      expect(matches).toHaveLength(1);
    });

    it("detects PID evidence mismatch", () => {
      const witness = makeProcessWitness({ command: "npm test", pid: 5555 });
      const exec = makeExecEntry({
        action: { type: "exec.command" as ATFEntry["action"]["type"], target: "npm test", detail: "Ran tests" },
        meta: { processEvidence: { pid: 9999, exitCode: 0 } },
      });

      const matches = correlateProcessEvents([witness], [exec]);
      expect(matches).toHaveLength(1);
      const evidenceFindings = matches[0]!.discrepancies.filter((d) => d.type === "evidence_mismatch");
      expect(evidenceFindings).toHaveLength(1);
      expect(evidenceFindings[0]!.severity).toBe("warning");
      expect(matches[0]!.confidence).toBeLessThan(100);
    });

    it("only correlates process_spawned events, not process_exited", () => {
      const exitWitness = makeProcessWitness({
        command: "ls -la",
        eventType: "process_exited",
      });
      const exec = makeExecEntry({
        action: { type: "exec.command" as ATFEntry["action"]["type"], target: "ls -la", detail: "Listed files" },
      });

      const matches = correlateProcessEvents([exitWitness], [exec]);
      expect(matches).toHaveLength(0);
    });

    it("returns empty matches for empty inputs", () => {
      expect(correlateProcessEvents([], [])).toEqual([]);
      expect(correlateProcessEvents([], [makeExecEntry()])).toEqual([]);
      expect(correlateProcessEvents([makeProcessWitness()], [])).toEqual([]);
    });

    it("ignores non-process witness entries", () => {
      const fileWitness: WitnessEntry = {
        id: "WIT_FILE",
        v: 1,
        ts: BASE_TS,
        prevHash: "",
        hash: "filehash",
        source: "filesystem",
        event: {
          type: "file_modified",
          path: "/tmp/test.txt",
          observedAt: BASE_TS,
        },
        correlated: false,
      };
      const exec = makeExecEntry();
      const matches = correlateProcessEvents([fileWitness], [exec]);
      expect(matches).toHaveLength(0);
    });

    it("ignores non-exec execution entries", () => {
      const witness = makeProcessWitness({ command: "ls -la" });
      const exec = makeExecEntry({
        action: { type: "file.write" as ATFEntry["action"]["type"], target: "/tmp/test.txt", detail: "Wrote file" },
      });

      const matches = correlateProcessEvents([witness], [exec]);
      expect(matches).toHaveLength(0);
    });

    it("detects timing discrepancy when diff exceeds 2s", () => {
      const witnessTs = "2026-02-13T14:32:00.000Z";
      const execTs = "2026-02-13T14:32:03.000Z"; // 3s apart
      const witness = makeProcessWitness({ ts: witnessTs, command: "ls -la" });
      const exec = makeExecEntry({
        ts: execTs,
        action: { type: "exec.command" as ATFEntry["action"]["type"], target: "ls -la", detail: "Listed files" },
      });

      const matches = correlateProcessEvents([witness], [exec]);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.discrepancies.some((d) => d.type === "timing_discrepancy")).toBe(true);
    });
  });
});

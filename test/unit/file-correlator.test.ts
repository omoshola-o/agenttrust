import { describe, it, expect } from "vitest";
import { pathMatches, correlateFileEvents } from "../../src/correlation/file-correlator.js";
import type { ATFEntry } from "../../src/ledger/entry.js";
import type { WitnessEntry, FileWitnessEvent } from "../../src/witness/types.js";

const BASE_TS = "2026-02-13T14:32:00.000Z";

function makeExecEntry(overrides?: Partial<ATFEntry> & { action?: Partial<ATFEntry["action"]>; risk?: Partial<ATFEntry["risk"]>; meta?: Record<string, unknown> }): ATFEntry {
  return {
    id: "EXEC_" + Math.random().toString(36).slice(2, 10).toUpperCase(),
    v: 1,
    ts: BASE_TS,
    prevHash: "",
    hash: "exechash123",
    agent: "default",
    session: "ses_test",
    action: {
      type: "file.write" as ATFEntry["action"]["type"],
      target: "/tmp/test.txt",
      detail: "Wrote test file",
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
    ...Object.fromEntries(
      Object.entries(overrides ?? {}).filter(([k]) => !["action", "risk"].includes(k)),
    ),
  } as ATFEntry;
}

function makeFileWitness(overrides?: {
  id?: string;
  ts?: string;
  eventType?: FileWitnessEvent["type"];
  path?: string;
  stat?: FileWitnessEvent["stat"];
}): WitnessEntry {
  return {
    id: overrides?.id ?? "WIT_" + Math.random().toString(36).slice(2, 10).toUpperCase(),
    v: 1,
    ts: overrides?.ts ?? BASE_TS,
    prevHash: "",
    hash: "witnhash123",
    source: "filesystem",
    event: {
      type: overrides?.eventType ?? "file_modified",
      path: overrides?.path ?? "/tmp/test.txt",
      observedAt: overrides?.ts ?? BASE_TS,
      ...(overrides?.stat ? { stat: overrides.stat } : {}),
    } as FileWitnessEvent,
    correlated: false,
  };
}

describe("file-correlator", () => {
  describe("pathMatches", () => {
    it("returns true for exact match", () => {
      expect(pathMatches("/tmp/test.txt", "/tmp/test.txt")).toBe(true);
    });

    it("returns true for suffix match (witness is absolute, exec is relative)", () => {
      expect(pathMatches("/home/user/project/src/main.ts", "src/main.ts")).toBe(true);
    });

    it("returns true for suffix match (exec is absolute, witness is relative)", () => {
      expect(pathMatches("src/main.ts", "/home/user/project/src/main.ts")).toBe(true);
    });

    it("returns true for basename match", () => {
      expect(pathMatches("/var/data/config.yaml", "/home/user/config.yaml")).toBe(true);
    });

    it("returns false for completely different paths", () => {
      expect(pathMatches("/tmp/foo.txt", "/var/bar.csv")).toBe(false);
    });

    it("returns false for partial basename mismatch", () => {
      expect(pathMatches("/tmp/foo.txt", "/tmp/foobar.txt")).toBe(false);
    });
  });

  describe("correlateFileEvents", () => {
    it("matches file witness event with execution entry by path and time", () => {
      const witness = makeFileWitness({ path: "/tmp/test.txt" });
      const exec = makeExecEntry({ action: { type: "file.write" as ATFEntry["action"]["type"], target: "/tmp/test.txt", detail: "Wrote file" } });

      const matches = correlateFileEvents([witness], [exec]);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.witnessEntry.id).toBe(witness.id);
      expect(matches[0]!.executionEntry.id).toBe(exec.id);
      expect(matches[0]!.confidence).toBe(100);
    });

    it("does not match when time difference exceeds 10s window", () => {
      const witnessTs = "2026-02-13T14:32:00.000Z";
      const execTs = "2026-02-13T14:32:11.000Z"; // 11s apart
      const witness = makeFileWitness({ ts: witnessTs, path: "/tmp/test.txt" });
      const exec = makeExecEntry({
        ts: execTs,
        action: { type: "file.write" as ATFEntry["action"]["type"], target: "/tmp/test.txt", detail: "Wrote file" },
      });

      const matches = correlateFileEvents([witness], [exec]);
      expect(matches).toHaveLength(0);
    });

    it("matches within 10s window", () => {
      const witnessTs = "2026-02-13T14:32:00.000Z";
      const execTs = "2026-02-13T14:32:09.000Z"; // 9s apart, within window
      const witness = makeFileWitness({ ts: witnessTs, path: "/tmp/test.txt" });
      const exec = makeExecEntry({
        ts: execTs,
        action: { type: "file.write" as ATFEntry["action"]["type"], target: "/tmp/test.txt", detail: "Wrote file" },
      });

      const matches = correlateFileEvents([witness], [exec]);
      expect(matches).toHaveLength(1);
    });

    it("detects content hash evidence mismatch", () => {
      const witness = makeFileWitness({
        path: "/tmp/test.txt",
        eventType: "file_modified",
        stat: {
          sizeBytes: 1024,
          mode: "0o644",
          mtime: BASE_TS,
          contentHashPrefix: "aabbccdd11223344",
        },
      });
      const exec = makeExecEntry({
        action: { type: "file.write" as ATFEntry["action"]["type"], target: "/tmp/test.txt", detail: "Wrote file" },
        meta: {
          fileEvidence: { contentHashPrefix: "ffffffff00000000", sizeBytes: 1024 },
        },
      });

      const matches = correlateFileEvents([witness], [exec]);
      expect(matches).toHaveLength(1);
      const discrepancies = matches[0]!.discrepancies;
      expect(discrepancies.some((d) => d.type === "evidence_mismatch")).toBe(true);
      // Confidence should be reduced
      expect(matches[0]!.confidence).toBeLessThan(100);
    });

    it("does not flag evidence mismatch when hashes match", () => {
      const hashPrefix = "aabbccdd11223344";
      const witness = makeFileWitness({
        path: "/tmp/test.txt",
        eventType: "file_modified",
        stat: {
          sizeBytes: 1024,
          mode: "0o644",
          mtime: BASE_TS,
          contentHashPrefix: hashPrefix,
        },
      });
      const exec = makeExecEntry({
        action: { type: "file.write" as ATFEntry["action"]["type"], target: "/tmp/test.txt", detail: "Wrote file" },
        meta: {
          fileEvidence: { contentHashPrefix: hashPrefix, sizeBytes: 1024 },
        },
      });

      const matches = correlateFileEvents([witness], [exec]);
      expect(matches).toHaveLength(1);
      const evidenceFindings = matches[0]!.discrepancies.filter((d) => d.type === "evidence_mismatch");
      expect(evidenceFindings).toHaveLength(0);
      expect(matches[0]!.confidence).toBe(100);
    });

    it("detects timing discrepancy when diff exceeds 5s", () => {
      const witnessTs = "2026-02-13T14:32:00.000Z";
      const execTs = "2026-02-13T14:32:06.000Z"; // 6s apart
      const witness = makeFileWitness({ ts: witnessTs, path: "/tmp/test.txt" });
      const exec = makeExecEntry({
        ts: execTs,
        action: { type: "file.write" as ATFEntry["action"]["type"], target: "/tmp/test.txt", detail: "Wrote file" },
      });

      const matches = correlateFileEvents([witness], [exec]);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.discrepancies.some((d) => d.type === "timing_discrepancy")).toBe(true);
      expect(matches[0]!.confidence).toBeLessThan(100);
    });

    it("detects target discrepancy (witness saw delete, agent logged write)", () => {
      const witness = makeFileWitness({
        path: "/tmp/test.txt",
        eventType: "file_deleted",
      });
      const exec = makeExecEntry({
        action: { type: "file.write" as ATFEntry["action"]["type"], target: "/tmp/test.txt", detail: "Wrote file" },
      });

      const matches = correlateFileEvents([witness], [exec]);
      expect(matches).toHaveLength(1);
      const targetDisc = matches[0]!.discrepancies.filter((d) => d.type === "target_discrepancy");
      expect(targetDisc).toHaveLength(1);
      expect(targetDisc[0]!.severity).toBe("critical");
      expect(matches[0]!.confidence).toBeLessThanOrEqual(70);
    });

    it("returns empty matches for empty inputs", () => {
      expect(correlateFileEvents([], [])).toEqual([]);
      expect(correlateFileEvents([], [makeExecEntry()])).toEqual([]);
    });

    it("ignores non-filesystem witness entries", () => {
      const processWitness: WitnessEntry = {
        id: "WIT_PROC",
        v: 1,
        ts: BASE_TS,
        prevHash: "",
        hash: "prochash",
        source: "process",
        event: {
          type: "process_spawned",
          command: "ls -la",
          pid: 1234,
          ppid: 1,
          observedAt: BASE_TS,
        },
        correlated: false,
      };
      const exec = makeExecEntry({
        action: { type: "file.write" as ATFEntry["action"]["type"], target: "/tmp/test.txt", detail: "Wrote" },
      });

      const matches = correlateFileEvents([processWitness], [exec]);
      expect(matches).toHaveLength(0);
    });

    it("ignores non-file execution entries", () => {
      const witness = makeFileWitness({ path: "/tmp/test.txt" });
      const exec = makeExecEntry({
        action: { type: "exec.command" as ATFEntry["action"]["type"], target: "ls -la", detail: "Listed files" },
      });

      const matches = correlateFileEvents([witness], [exec]);
      expect(matches).toHaveLength(0);
    });

    it("matches file.read execution with file_accessed witness", () => {
      const witness = makeFileWitness({
        path: "/tmp/data.csv",
        eventType: "file_accessed",
      });
      const exec = makeExecEntry({
        action: { type: "file.read" as ATFEntry["action"]["type"], target: "/tmp/data.csv", detail: "Read data" },
      });

      const matches = correlateFileEvents([witness], [exec]);
      expect(matches).toHaveLength(1);
      // No target discrepancy since file_accessed maps to file.read
      expect(matches[0]!.discrepancies.filter((d) => d.type === "target_discrepancy")).toHaveLength(0);
    });
  });
});

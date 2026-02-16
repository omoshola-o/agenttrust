import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LedgerWatcher } from "../../src/watch/watcher.js";
import type { WatchOptions, WatchEvent } from "../../src/watch/watcher.js";
import type { ATFEntry } from "../../src/ledger/entry.js";

function makeEntry(overrides: Partial<ATFEntry> = {}): ATFEntry {
  return {
    id: "01TESTENTRY000000000000001",
    v: 1,
    ts: "2026-02-15T18:32:05.000Z",
    prevHash: "",
    hash: "testhash",
    agent: "default",
    session: "ses_test",
    action: {
      type: "file.read" as ATFEntry["action"]["type"],
      target: "/home/user/test.txt",
      detail: "Read test file",
    },
    context: {
      goal: "Test goal",
      trigger: "test",
    },
    outcome: {
      status: "success",
      durationMs: 12,
    },
    risk: {
      score: 1,
      labels: [],
      autoFlagged: false,
    },
    ...overrides,
  };
}

function createTempDirs(): { ledgerDir: string; claimsDir: string } {
  const base = mkdtempSync(join(tmpdir(), "agenttrust-watcher-test-"));
  const ledgerDir = join(base, "ledger");
  const claimsDir = join(base, "claims");
  mkdirSync(ledgerDir, { recursive: true });
  mkdirSync(claimsDir, { recursive: true });
  return { ledgerDir, claimsDir };
}

function todayFilename(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}.agenttrust.jsonl`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const defaultOptions: WatchOptions = {
  riskOnly: false,
  showClaims: false,
  compact: true,
};

let activeWatcher: LedgerWatcher | null = null;

afterEach(() => {
  if (activeWatcher) {
    activeWatcher.stop();
    activeWatcher = null;
  }
});

describe("LedgerWatcher", () => {
  describe("constructor", () => {
    it("creates instance", () => {
      const { ledgerDir, claimsDir } = createTempDirs();
      const watcher = new LedgerWatcher({ ledgerDir, claimsDir });
      activeWatcher = watcher;
      expect(watcher).toBeInstanceOf(LedgerWatcher);
    });
  });

  describe("getSummary", () => {
    it("returns initial zeros", () => {
      const { ledgerDir, claimsDir } = createTempDirs();
      const watcher = new LedgerWatcher({ ledgerDir, claimsDir });
      activeWatcher = watcher;
      const summary = watcher.getSummary();
      expect(summary.entriesSeen).toBe(0);
      expect(summary.claimsSeen).toBe(0);
      expect(summary.rulesTriggered).toBe(0);
      expect(summary.bySeverity.critical).toBe(0);
      expect(summary.bySeverity.high).toBe(0);
      expect(summary.bySeverity.medium).toBe(0);
      expect(summary.bySeverity.low).toBe(0);
    });
  });

  describe("stop", () => {
    it("returns summary", () => {
      const { ledgerDir, claimsDir } = createTempDirs();
      const watcher = new LedgerWatcher({ ledgerDir, claimsDir, pollIntervalMs: 50 });
      activeWatcher = watcher;

      // Start without awaiting (watch() blocks until stop is called)
      void watcher.watch(defaultOptions, () => {});
      const summary = watcher.stop();
      activeWatcher = null;

      expect(summary.entriesSeen).toBe(0);
      expect(summary.claimsSeen).toBe(0);
      expect(summary.rulesTriggered).toBe(0);
    });

    it("sets durationMs", async () => {
      const { ledgerDir, claimsDir } = createTempDirs();
      const watcher = new LedgerWatcher({ ledgerDir, claimsDir, pollIntervalMs: 50 });
      activeWatcher = watcher;

      void watcher.watch(defaultOptions, () => {});

      // Wait a brief moment so durationMs is non-zero
      await delay(80);

      const summary = watcher.stop();
      activeWatcher = null;

      expect(summary.durationMs).toBeGreaterThan(0);
    });
  });

  describe("file watching", () => {
    it("processes new entries from ledger file", async () => {
      const { ledgerDir, claimsDir } = createTempDirs();
      const watcher = new LedgerWatcher({
        ledgerDir,
        claimsDir,
        pollIntervalMs: 50,
      });
      activeWatcher = watcher;

      const events: WatchEvent[] = [];

      // Fire and forget -- watch() blocks until stop
      void watcher.watch(defaultOptions, (event) => {
        events.push(event);
      });

      // Give initialization time to complete
      await delay(100);

      // Write an entry after watching has started
      const entry = makeEntry({
        ts: new Date().toISOString(),
      });
      const filePath = join(ledgerDir, todayFilename());
      appendFileSync(filePath, JSON.stringify(entry) + "\n");

      // Wait for poll to pick it up
      await delay(200);

      const summary = watcher.stop();
      activeWatcher = null;

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].type).toBe("entry");
      expect(summary.entriesSeen).toBeGreaterThanOrEqual(1);
    });

    it("tracks entries seen count", async () => {
      const { ledgerDir, claimsDir } = createTempDirs();
      const watcher = new LedgerWatcher({
        ledgerDir,
        claimsDir,
        pollIntervalMs: 50,
      });
      activeWatcher = watcher;

      void watcher.watch(defaultOptions, () => {});

      // Give initialization time to complete
      await delay(100);

      const now = new Date();
      const filePath = join(ledgerDir, todayFilename());

      // Write two entries
      const entry1 = makeEntry({
        id: "01TESTENTRY000000000000001",
        ts: now.toISOString(),
      });
      const entry2 = makeEntry({
        id: "01TESTENTRY000000000000002",
        ts: new Date(now.getTime() + 1000).toISOString(),
      });
      appendFileSync(filePath, JSON.stringify(entry1) + "\n" + JSON.stringify(entry2) + "\n");

      // Wait for poll to pick them up
      await delay(200);

      const summary = watcher.stop();
      activeWatcher = null;

      expect(summary.entriesSeen).toBeGreaterThanOrEqual(2);
    });

    it("tracks rule matches count", async () => {
      const { ledgerDir, claimsDir } = createTempDirs();
      const watcher = new LedgerWatcher({
        ledgerDir,
        claimsDir,
        pollIntervalMs: 50,
      });
      activeWatcher = watcher;

      void watcher.watch(defaultOptions, () => {});

      // Give initialization time to complete
      await delay(100);

      // Write a risky entry that should trigger rules (payment.initiate)
      const entry = makeEntry({
        ts: new Date().toISOString(),
        action: {
          type: "payment.initiate" as ATFEntry["action"]["type"],
          target: "stripe:checkout_abc",
          detail: "Initiated payment",
        },
      });
      const filePath = join(ledgerDir, todayFilename());
      appendFileSync(filePath, JSON.stringify(entry) + "\n");

      // Wait for poll to pick it up
      await delay(200);

      const summary = watcher.stop();
      activeWatcher = null;

      // payment.initiate should trigger at least fin-001
      expect(summary.rulesTriggered).toBeGreaterThanOrEqual(1);
    });

    it("handles missing file gracefully", async () => {
      const { ledgerDir, claimsDir } = createTempDirs();
      const watcher = new LedgerWatcher({
        ledgerDir,
        claimsDir,
        pollIntervalMs: 50,
      });
      activeWatcher = watcher;

      // Start watching without creating any ledger file
      void watcher.watch(defaultOptions, () => {});

      // Wait a couple poll cycles
      await delay(200);

      const summary = watcher.stop();
      activeWatcher = null;

      // Should not throw, and should report zero entries
      expect(summary.entriesSeen).toBe(0);
      expect(summary.claimsSeen).toBe(0);
    });
  });
});

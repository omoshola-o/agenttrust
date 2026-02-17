import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  logAction,
  declareIntent,
  initWorkspace,
  getDefaultLedger,
  setDefaultLedger,
  resetDefaultLedger,
  Ledger,
} from "../../src/index.js";
import type { LogActionInput, DeclareIntentInput } from "../../src/index.js";

describe("helpers", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agenttrust-helpers-"));
    resetDefaultLedger();
  });

  afterEach(async () => {
    resetDefaultLedger();
    await rm(tempDir, { recursive: true, force: true });
  });

  // ─── initWorkspace ──────────────────────────────────────────────

  describe("initWorkspace", () => {
    it("creates .agenttrust/ledger/ and .agenttrust/claims/", async () => {
      const result = await initWorkspace(tempDir);
      expect(result.ok).toBe(true);

      const dirs = await readdir(join(tempDir, ".agenttrust"));
      expect(dirs).toContain("ledger");
      expect(dirs).toContain("claims");
    });

    it("sets the default ledger to the workspace path", async () => {
      await initWorkspace(tempDir);
      const ledger = getDefaultLedger();
      expect(ledger).toBeInstanceOf(Ledger);
    });

    it("is idempotent", async () => {
      const r1 = await initWorkspace(tempDir);
      const r2 = await initWorkspace(tempDir);
      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
    });
  });

  // ─── logAction ──────────────────────────────────────────────────

  describe("logAction", () => {
    let ledger: Ledger;

    beforeEach(async () => {
      ledger = new Ledger({ workspacePath: tempDir });
      await ledger.init();
    });

    it("logs an action with minimal fields", async () => {
      const result = await logAction(
        { type: "file.read", target: "/tmp/test.txt", detail: "Read test file" },
        ledger,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.action.type).toBe("file.read");
      expect(result.value.action.target).toBe("/tmp/test.txt");
      expect(result.value.action.detail).toBe("Read test file");
      expect(result.value.agent).toBe("default");
      expect(result.value.session).toBe("default");
      expect(result.value.outcome.status).toBe("success");
      expect(result.value.risk.score).toBe(0);
      expect(result.value.risk.labels).toEqual([]);
      expect(result.value.risk.autoFlagged).toBe(false);
      expect(result.value.context.goal).toBe("Agent action");
      expect(result.value.context.trigger).toBe("chain");
    });

    it("logs an action with all optional fields", async () => {
      const input: LogActionInput = {
        type: "api.call",
        target: "https://api.example.com/data",
        detail: "Called external API",
        status: "partial",
        durationMs: 542,
        outcomeDetail: "Rate limited",
        risk: 5,
        riskLabels: ["communication", "unknown_target"],
        goal: "Fetch user data",
        trigger: "user_request",
        parentAction: "01PARENT000000000000000000",
        agent: "my-agent",
        session: "ses_xyz",
        meta: { requestId: "req_123" },
      };

      const result = await logAction(input, ledger);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.action.type).toBe("api.call");
      expect(result.value.action.target).toBe("https://api.example.com/data");
      expect(result.value.agent).toBe("my-agent");
      expect(result.value.session).toBe("ses_xyz");
      expect(result.value.outcome.status).toBe("partial");
      expect(result.value.outcome.durationMs).toBe(542);
      expect(result.value.outcome.detail).toBe("Rate limited");
      expect(result.value.risk.score).toBe(5);
      expect(result.value.risk.labels).toEqual(["communication", "unknown_target"]);
      expect(result.value.risk.autoFlagged).toBe(false);
      expect(result.value.context.goal).toBe("Fetch user data");
      expect(result.value.context.trigger).toBe("user_request");
      expect(result.value.context.parentAction).toBe("01PARENT000000000000000000");
      expect(result.value.meta).toEqual({ requestId: "req_123" });
    });

    it("auto-flags when risk >= 7", async () => {
      const result = await logAction(
        {
          type: "file.read",
          target: "/root/.ssh/id_rsa",
          detail: "Read SSH key",
          risk: 9,
          riskLabels: ["data_access", "escalation"],
        },
        ledger,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.risk.autoFlagged).toBe(true);
    });

    it("does not auto-flag when risk < 7", async () => {
      const result = await logAction(
        { type: "file.read", target: "readme.md", detail: "Read readme", risk: 6 },
        ledger,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.risk.autoFlagged).toBe(false);
    });

    it("exactly at risk 7 is auto-flagged", async () => {
      const result = await logAction(
        { type: "exec.command", target: "sudo rm -rf /", detail: "Danger", risk: 7 },
        ledger,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.risk.autoFlagged).toBe(true);
    });

    it("produces valid hash-chained entries", async () => {
      await logAction({ type: "file.read", target: "a.txt", detail: "First" }, ledger);
      await logAction({ type: "file.read", target: "b.txt", detail: "Second" }, ledger);
      await logAction({ type: "file.read", target: "c.txt", detail: "Third" }, ledger);

      const entries = await ledger.read();
      expect(entries.ok).toBe(true);
      if (!entries.ok) return;
      expect(entries.value.length).toBe(3);

      // Verify hash chain
      expect(entries.value[0].prevHash).toBe("");
      expect(entries.value[1].prevHash).toBe(entries.value[0].hash);
      expect(entries.value[2].prevHash).toBe(entries.value[1].hash);

      // Verify integrity
      const integrity = await ledger.verify();
      expect(integrity.valid).toBe(true);
    });

    it("uses default ledger when none provided", async () => {
      await initWorkspace(tempDir);

      const result = await logAction({
        type: "file.read",
        target: "test.txt",
        detail: "Using default ledger",
      });

      expect(result.ok).toBe(true);

      // Verify entry was written
      const defaultLedger = getDefaultLedger();
      const entries = await defaultLedger.read();
      expect(entries.ok).toBe(true);
      if (!entries.ok) return;
      expect(entries.value.length).toBe(1);
    });

    it("writes to JSONL file on disk", async () => {
      await logAction(
        { type: "web.fetch", target: "https://example.com", detail: "Fetched page" },
        ledger,
      );

      const ledgerDir = join(tempDir, ".agenttrust", "ledger");
      const files = await readdir(ledgerDir);
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.agenttrust\.jsonl$/);

      const content = await readFile(join(ledgerDir, files[0]), "utf-8");
      const parsed = JSON.parse(content.trim());
      expect(parsed.action.type).toBe("web.fetch");
    });

    it("handles all outcome statuses", async () => {
      for (const status of ["success", "failure", "partial", "blocked"] as const) {
        const result = await logAction(
          { type: "file.read", target: `test-${status}.txt`, detail: `Status: ${status}`, status },
          ledger,
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.outcome.status).toBe(status);
        }
      }
    });
  });

  // ─── declareIntent ──────────────────────────────────────────────

  describe("declareIntent", () => {
    let ledger: Ledger;

    beforeEach(async () => {
      ledger = new Ledger({ workspacePath: tempDir });
      await ledger.init();
    });

    it("declares intent with minimal fields", async () => {
      const result = await declareIntent(
        {
          type: "exec.command",
          target: "npm install express",
          goal: "Install HTTP framework",
        },
        ledger,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.intent.plannedAction).toBe("exec.command");
      expect(result.value.intent.plannedTarget).toBe("npm install express");
      expect(result.value.intent.goal).toBe("Install HTTP framework");
      expect(result.value.intent.expectedOutcome).toBe("success");
      expect(result.value.intent.selfAssessedRisk).toBe(0);
      expect(result.value.agent).toBe("default");
      expect(result.value.session).toBe("default");
      expect(result.value.constraints.withinScope).toBe(true);
      expect(result.value.constraints.requiresElevation).toBe(false);
      expect(result.value.constraints.involvesExternalComms).toBe(false);
      expect(result.value.constraints.involvesFinancial).toBe(false);
    });

    it("declares intent with all optional fields", async () => {
      const input: DeclareIntentInput = {
        type: "payment.initiate",
        target: "stripe:payment_intent_123",
        goal: "Process user subscription",
        expectedOutcome: "partial",
        risk: 8,
        withinScope: true,
        requiresElevation: false,
        involvesExternalComms: true,
        involvesFinancial: true,
        agent: "billing-agent",
        session: "ses_billing_001",
        meta: { subscriptionId: "sub_abc" },
      };

      const result = await declareIntent(input, ledger);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.intent.plannedAction).toBe("payment.initiate");
      expect(result.value.intent.expectedOutcome).toBe("partial");
      expect(result.value.intent.selfAssessedRisk).toBe(8);
      expect(result.value.agent).toBe("billing-agent");
      expect(result.value.session).toBe("ses_billing_001");
      expect(result.value.constraints.involvesExternalComms).toBe(true);
      expect(result.value.constraints.involvesFinancial).toBe(true);
      expect(result.value.meta).toEqual({ subscriptionId: "sub_abc" });
    });

    it("produces hash-chained claims", async () => {
      await declareIntent(
        { type: "file.write", target: "a.ts", goal: "Create file A" },
        ledger,
      );
      await declareIntent(
        { type: "file.write", target: "b.ts", goal: "Create file B" },
        ledger,
      );

      const claims = await ledger.readClaims();
      expect(claims.ok).toBe(true);
      if (!claims.ok) return;
      expect(claims.value.length).toBe(2);

      expect(claims.value[0].prevHash).toBe("");
      expect(claims.value[1].prevHash).toBe(claims.value[0].hash);

      // Verify claims chain integrity
      const integrity = await ledger.verifyClaims();
      expect(integrity.valid).toBe(true);
    });

    it("writes to claims JSONL file on disk", async () => {
      await declareIntent(
        { type: "api.call", target: "https://api.example.com", goal: "Call API" },
        ledger,
      );

      const claimsDir = join(tempDir, ".agenttrust", "claims");
      const files = await readdir(claimsDir);
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.claims\.jsonl$/);
    });

    it("uses default ledger when none provided", async () => {
      await initWorkspace(tempDir);

      const result = await declareIntent({
        type: "file.read",
        target: "test.txt",
        goal: "Test default ledger",
      });

      expect(result.ok).toBe(true);
    });
  });

  // ─── Declare-then-log pattern ───────────────────────────────────

  describe("declare-then-log pattern", () => {
    let ledger: Ledger;

    beforeEach(async () => {
      ledger = new Ledger({ workspacePath: tempDir });
      await ledger.init();
    });

    it("links claim to execution via meta.claimId", async () => {
      // Declare intent
      const claim = await declareIntent(
        {
          type: "exec.command",
          target: "npm install express",
          goal: "Install express",
        },
        ledger,
      );
      expect(claim.ok).toBe(true);
      if (!claim.ok) return;

      // Log execution linked to claim
      const execution = await logAction(
        {
          type: "exec.command",
          target: "npm install express",
          detail: "Installed express v4.18.2",
          meta: { claimId: claim.value.id },
        },
        ledger,
      );
      expect(execution.ok).toBe(true);
      if (!execution.ok) return;

      // Verify the link
      expect(execution.value.meta?.claimId).toBe(claim.value.id);

      // Both ledgers should be valid
      const ledgerIntegrity = await ledger.verify();
      expect(ledgerIntegrity.valid).toBe(true);
      const claimsIntegrity = await ledger.verifyClaims();
      expect(claimsIntegrity.valid).toBe(true);
    });

    it("can declare and execute multiple actions in sequence", async () => {
      const actions = [
        { type: "file.read" as const, target: "package.json", goal: "Check deps" },
        { type: "exec.command" as const, target: "npm install", goal: "Install deps" },
        { type: "file.write" as const, target: "config.ts", goal: "Write config" },
      ];

      for (const action of actions) {
        const claim = await declareIntent(action, ledger);
        expect(claim.ok).toBe(true);
        if (!claim.ok) continue;

        await logAction(
          {
            type: action.type,
            target: action.target,
            detail: `Completed: ${action.goal}`,
            meta: { claimId: claim.value.id },
          },
          ledger,
        );
      }

      const entries = await ledger.read();
      const claims = await ledger.readClaims();
      expect(entries.ok).toBe(true);
      expect(claims.ok).toBe(true);
      if (entries.ok) expect(entries.value.length).toBe(3);
      if (claims.ok) expect(claims.value.length).toBe(3);
    });
  });

  // ─── setDefaultLedger / resetDefaultLedger ──────────────────────

  describe("ledger management", () => {
    it("setDefaultLedger replaces the default", async () => {
      const custom = new Ledger({ workspacePath: tempDir });
      setDefaultLedger(custom);
      expect(getDefaultLedger()).toBe(custom);
    });

    it("resetDefaultLedger clears the singleton", () => {
      const first = getDefaultLedger();
      resetDefaultLedger();
      const second = getDefaultLedger();
      expect(first).not.toBe(second);
    });

    it("getDefaultLedger returns same instance on repeated calls", () => {
      const a = getDefaultLedger();
      const b = getDefaultLedger();
      expect(a).toBe(b);
    });
  });
});

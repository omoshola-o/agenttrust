import type { Command } from "commander";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Ledger, resolveWorkspace } from "../../src/ledger/ledger.js";
import { listLedgerFiles } from "../../src/ledger/storage.js";
import { listClaimFiles } from "../../src/ledger/claims-storage.js";
import {
  readWitnessEntries,
  listWitnessFiles,
} from "../../src/witness/witness-storage.js";
import type { WitnessStorageConfig } from "../../src/witness/witness-storage.js";
import type { WitnessEntry } from "../../src/witness/types.js";
import { correlate } from "../../src/correlation/engine.js";
import { loadInfrastructurePatterns } from "../../src/correlation/config.js";
import { computeTrustVerdict } from "../../src/correlation/trust.js";
import {
  matchClaimsToExecutions,
  detectDivergences,
  computeConsistencyScore,
} from "../../src/consistency/index.js";
import {
  formatStatusDashboard,
  formatStatusJson,
  renderNoWorkspace,
} from "../formatters/dashboard.js";
import type { StatusData } from "../formatters/dashboard.js";
import { parseDuration } from "../utils/duration.js";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Dashboard with trust score, activity, and health summary")
    .option("--last <duration>", "Time range for activity (e.g., 1h, 24h, 7d)", "24h")
    .option("--json", "Output as JSON for scripting")
    .option("-w, --workspace <path>", "Workspace path")
    .action(
      async (opts: { last: string; json?: boolean; workspace?: string }) => {
        const workspace = await resolveWorkspace(opts.workspace);
        const atDir = join(workspace, ".agenttrust");
        const ledgerDir = join(atDir, "ledger");
        const claimsDir = join(atDir, "claims");
        const witnessDir = join(atDir, "witness");

        // Check if workspace is initialized
        let workspaceValid = false;
        try {
          const s = await stat(atDir);
          workspaceValid = s.isDirectory();
        } catch {
          // Not initialized
        }

        if (!workspaceValid) {
          console.log(renderNoWorkspace());
          return;
        }

        // Parse time range
        const now = Date.now();
        const { cutoff } = parseDuration(opts.last);
        const from = new Date(cutoff);
        const to = new Date(now);

        const ledger = new Ledger({ workspacePath: workspace });

        // ── Integrity ──────────────────────────────────
        let integrity = 100;
        let chainIntact: boolean | null = null;
        let lastVerified: string | null = null;
        try {
          const integrityReport = await ledger.verify();
          integrity = integrityReport.valid ? 100 : 0;
          chainIntact = integrityReport.valid;
          lastVerified = new Date().toISOString();
        } catch {
          chainIntact = null;
        }

        // ── Entries + Claims ───────────────────────────
        const execResult = await ledger.read({ timeRange: { from, to } });
        const executions = execResult.ok ? execResult.value : [];
        const claimsResult = await ledger.readClaims({ timeRange: { from, to } });
        const claims = claimsResult.ok ? claimsResult.value : [];

        // ── Consistency ────────────────────────────────
        let consistency = 100;
        if (claims.length > 0 || executions.length > 0) {
          const matchResults = matchClaimsToExecutions(claims, executions);
          const findings = detectDivergences(matchResults);
          consistency = computeConsistencyScore(findings);
        }

        // ── Witness ────────────────────────────────────
        const storageConfig: WitnessStorageConfig = { witnessDir };
        const witnessFileList = await listWitnessFiles(storageConfig);
        let witnessEntries: WitnessEntry[] = [];
        let witnessFiles = 0;
        if (witnessFileList.ok) {
          witnessFiles = witnessFileList.value.length;
          for (const file of witnessFileList.value) {
            const entries = await readWitnessEntries(file);
            if (entries.ok) {
              witnessEntries.push(...entries.value);
            }
          }
        }

        // Filter to time range
        const allWitnessToday = witnessEntries.length;
        witnessEntries = witnessEntries.filter((e) => {
          const entryTime = new Date(e.ts).getTime();
          return entryTime >= cutoff;
        });

        // Correlation + confidence
        const configPath = join(workspace, ".agenttrust", "config.yaml");
        const customInfraPatterns = await loadInfrastructurePatterns(configPath);

        let witnessConfidence = 100;
        let findingsCount = 0;
        if (witnessEntries.length > 0 || executions.length > 0) {
          const report = correlate(witnessEntries, executions, {
            timeRange: { from: from.toISOString(), to: to.toISOString() },
            customInfrastructurePatterns: customInfraPatterns.length > 0 ? customInfraPatterns : undefined,
          });
          witnessConfidence = report.witnessConfidence;
          findingsCount = report.findings.length;
        }

        // ── Trust Verdict ──────────────────────────────
        const hasData = executions.length > 0 || claims.length > 0 || witnessEntries.length > 0;
        const trust = hasData
          ? computeTrustVerdict(integrity, consistency, witnessConfidence)
          : null;

        // ── Activity Stats ─────────────────────────────
        let critical = 0;
        let high = 0;
        let medium = 0;
        let low = 0;
        for (const e of executions) {
          const s = e.risk.score;
          if (s >= 9) critical++;
          else if (s >= 7) high++;
          else if (s >= 4) medium++;
          else low++;
        }

        // ── Ledger + Claim file counts ─────────────────
        const ledgerFilesResult = await listLedgerFiles({ ledgerDir });
        const ledgerFileCount = ledgerFilesResult.ok ? ledgerFilesResult.value.length : 0;
        const allEntries = await ledger.read();
        const ledgerEntryCount = allEntries.ok ? allEntries.value.length : 0;

        const claimFilesResult = await listClaimFiles({ claimsDir });
        const claimFileCount = claimFilesResult.ok ? claimFilesResult.value.length : 0;
        const allClaims = await ledger.readClaims();
        const claimCount = allClaims.ok ? allClaims.value.length : 0;

        // ── Build StatusData ───────────────────────────
        const findingsSummary = findingsCount > 0
          ? `${findingsCount} correlation finding${findingsCount === 1 ? "" : "s"} in last ${opts.last}`
          : null;

        const data: StatusData = {
          workspace,
          trust,
          activity: {
            total: executions.length,
            critical,
            high,
            medium,
            low,
            period: opts.last,
          },
          health: {
            workspaceValid,
            ledgerFiles: ledgerFileCount,
            ledgerEntries: ledgerEntryCount,
            chainIntact,
            claimFiles: claimFileCount,
            claimCount,
            witnessFiles,
            witnessEventsToday: allWitnessToday,
          },
          lastVerified,
          findingsCount,
          findingsSummary,
        };

        if (opts.json) {
          console.log(formatStatusJson(data));
        } else {
          console.log(formatStatusDashboard(data));
        }
      },
    );
}


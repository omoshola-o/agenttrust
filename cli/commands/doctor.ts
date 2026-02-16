import type { Command } from "commander";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Ledger, resolveWorkspace } from "../../src/ledger/ledger.js";
import { listLedgerFiles } from "../../src/ledger/storage.js";
import { listClaimFiles } from "../../src/ledger/claims-storage.js";
import { icons } from "../formatters/color.js";

interface Check {
  label: string;
  pass: boolean;
  detail?: string;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Run health checks on AgentTrust setup")
    .option("-w, --workspace <path>", "Workspace path")
    .action(async (opts: { workspace?: string }) => {
      const workspace = await resolveWorkspace(opts.workspace);
      const atDir = join(workspace, ".agenttrust");
      const ledgerDir = join(atDir, "ledger");
      const checks: Check[] = [];

      // Check 1: .agenttrust/ exists
      try {
        const s = await stat(atDir);
        checks.push({
          label: ".agenttrust directory exists",
          pass: s.isDirectory(),
        });
      } catch {
        checks.push({
          label: ".agenttrust directory exists",
          pass: false,
          detail: "Run 'agenttrust init' to create it",
        });
      }

      // Check 2: ledger/ exists
      try {
        const s = await stat(ledgerDir);
        checks.push({
          label: "Ledger directory exists",
          pass: s.isDirectory(),
        });
      } catch {
        checks.push({
          label: "Ledger directory exists",
          pass: false,
          detail: "Run 'agenttrust init' to create it",
        });
      }

      // Check 3: claims/ exists
      const claimsDir = join(atDir, "claims");
      try {
        const s = await stat(claimsDir);
        checks.push({
          label: "Claims directory exists",
          pass: s.isDirectory(),
        });
      } catch {
        checks.push({
          label: "Claims directory exists",
          pass: false,
          detail: "Run 'agenttrust init' to create it",
        });
      }

      // Check 4: digests/ exists
      const digestsDir = join(atDir, "digests");
      try {
        const s = await stat(digestsDir);
        checks.push({
          label: "Digests directory exists",
          pass: s.isDirectory(),
        });
      } catch {
        checks.push({
          label: "Digests directory exists",
          pass: false,
          detail: "Run 'agenttrust init' to create it",
        });
      }

      // Check 5: witness/ exists
      const witnessDir = join(atDir, "witness");
      try {
        const s = await stat(witnessDir);
        checks.push({
          label: "Witness directory exists",
          pass: s.isDirectory(),
        });
      } catch {
        checks.push({
          label: "Witness directory exists",
          pass: false,
          detail: "Run 'agenttrust init' to create it",
        });
      }

      // Check 6: ledger files exist
      const filesResult = await listLedgerFiles({ ledgerDir });
      if (filesResult.ok) {
        checks.push({
          label: "Ledger files found",
          pass: filesResult.value.length > 0,
          detail:
            filesResult.value.length > 0
              ? `${filesResult.value.length} file(s)`
              : "No ledger files yet",
        });
      }

      // Check 5: claims files
      const claimFilesResult = await listClaimFiles({ claimsDir });
      if (claimFilesResult.ok) {
        checks.push({
          label: "Claim files found",
          pass: claimFilesResult.value.length > 0,
          detail:
            claimFilesResult.value.length > 0
              ? `${claimFilesResult.value.length} file(s)`
              : "No claim files yet",
        });
      }

      // Check 6: integrity
      const ledger = new Ledger({ workspacePath: workspace });
      const report = await ledger.verify();
      checks.push({
        label: "Hash chain integrity",
        pass: report.valid,
        detail: report.valid
          ? `${report.totalEntries} entries verified`
          : `${report.errors.length} error(s) found`,
      });

      // Print results
      console.log("\nAgentTrust Health Check");
      console.log(`Workspace: ${workspace}\n`);

      let allPass = true;
      for (const check of checks) {
        const icon = check.pass ? icons.pass : icons.fail;
        const detail = check.detail ? ` — ${check.detail}` : "";
        console.log(`  ${icon} ${check.label}${detail}`);
        if (!check.pass) allPass = false;
      }

      console.log("");
      if (allPass) {
        console.log(`${icons.pass} All checks passed`);
      } else {
        console.log(`${icons.fail} Some checks failed`);
        process.exitCode = 1;
      }
    });
}

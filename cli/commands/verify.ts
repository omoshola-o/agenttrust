import type { Command } from "commander";
import { Ledger, resolveWorkspace } from "../../src/ledger/ledger.js";
import { formatIntegrityTable } from "../formatters/table.js";
import { formatStatsTable } from "../formatters/table.js";

export function registerVerifyCommand(program: Command): void {
  program
    .command("verify")
    .description("Verify hash chain integrity")
    .option("-w, --workspace <path>", "Workspace path")
    .option("--deep", "Include detailed statistics")
    .option("--json", "Output as JSON for scripting")
    .action(async (opts: { workspace?: string; deep?: boolean; json?: boolean }) => {
      const workspace = await resolveWorkspace(opts.workspace);
      const ledger = new Ledger({ workspacePath: workspace });

      const start = Date.now();
      const report = await ledger.verify();
      const elapsed = Date.now() - start;

      if (opts.json) {
        const json: Record<string, unknown> = {
          valid: report.valid,
          filesChecked: report.filesChecked,
          totalEntries: report.totalEntries,
          errors: report.errors,
          elapsed,
        };
        if (opts.deep) {
          const stats = await ledger.getStats();
          json["stats"] = stats;
        }
        console.log(JSON.stringify(json, null, 2));
      } else {
        console.log(formatIntegrityTable(report));
        console.log(`\nCompleted in ${elapsed}ms`);

        if (opts.deep) {
          console.log("\nLedger Statistics:");
          const stats = await ledger.getStats();
          console.log(formatStatsTable(stats));
        }
      }

      if (!report.valid) process.exitCode = 1;
    });
}

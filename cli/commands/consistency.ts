import type { Command } from "commander";
import { Ledger, resolveWorkspace } from "../../src/ledger/ledger.js";
import { parseTimeRange } from "../../src/query/filters.js";
import { generateReport } from "../../src/consistency/report.js";
import { formatConsistencyReport } from "../formatters/table.js";
import { icons } from "../formatters/color.js";

export function registerConsistencyCommand(program: Command): void {
  program
    .command("consistency")
    .description("Check if agent actions match declared intent; highlight mismatches")
    .option("-l, --last <time>", "Time range (e.g. 24h, 7d, 4w)", "24h")
    .option("-a, --agent <name>", "Filter by agent name")
    .option("-s, --session <id>", "Filter by session ID")
    .option("--json", "Output as JSON for scripting")
    .option("-w, --workspace <path>", "Workspace path")
    .action(
      async (opts: {
        last: string;
        agent?: string;
        session?: string;
        json?: boolean;
        workspace?: string;
      }) => {
        const workspace = await resolveWorkspace(opts.workspace);
        const ledger = new Ledger({ workspacePath: workspace });

        const timeRange = parseTimeRange(opts.last);
        const filters = {
          ...(timeRange ? { timeRange } : {}),
          ...(opts.agent ? { agent: opts.agent } : {}),
          ...(opts.session ? { session: opts.session } : {}),
        };

        const claimsResult = await ledger.readClaims(filters);
        if (!claimsResult.ok) {
          console.error(`${icons.fail} Failed to read claims: ${claimsResult.error}`);
          process.exitCode = 1;
          return;
        }

        const execResult = await ledger.read(filters);
        if (!execResult.ok) {
          console.error(`${icons.fail} Failed to read executions: ${execResult.error}`);
          process.exitCode = 1;
          return;
        }

        if (claimsResult.value.length === 0 && execResult.value.length === 0) {
          console.log(`${icons.info} No claims or executions found in the last ${opts.last}.`);
          console.log(`  Use 'agenttrust log' to check activity or 'agenttrust claim' to declare intent.`);
          return;
        }

        const from = timeRange?.from?.toISOString() ?? new Date(0).toISOString();
        const to = timeRange?.to?.toISOString() ?? new Date().toISOString();

        const report = generateReport(
          claimsResult.value,
          execResult.value,
          { from, to },
        );

        if (opts.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(formatConsistencyReport(report));
        }

        if (report.consistencyScore < 70) {
          process.exitCode = 1;
        }
      },
    );
}

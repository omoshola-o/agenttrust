import type { Command } from "commander";
import { Ledger, resolveWorkspace } from "../../src/ledger/ledger.js";
import { parseTimeRange } from "../../src/query/filters.js";
import type { QueryFilters } from "../../src/query/filters.js";
import { isActionType } from "../../src/schema/action-types.js";
import { formatEntriesTable, formatClaimsTable, formatPairedTable } from "../formatters/table.js";
import { icons } from "../formatters/color.js";

export function registerLogCommand(program: Command): void {
  program
    .command("log")
    .description("Show recent agent actions")
    .option("-l, --last <time>", "Time range (e.g. 24h, 7d, 4w)", "24h")
    .option("-t, --type <type>", "Filter by action type (e.g. api.call)")
    .option("-a, --agent <name>", "Filter by agent name")
    .option("-s, --session <id>", "Filter by session ID")
    .option("--above <score>", "Filter by minimum risk score")
    .option("--claims", "Show claims instead of execution entries")
    .option("--paired", "Show claims paired with execution entries")
    .option("--json", "Output as JSON for scripting")
    .option("-w, --workspace <path>", "Workspace path")
    .action(
      async (opts: {
        last: string;
        type?: string;
        agent?: string;
        session?: string;
        above?: string;
        claims?: boolean;
        paired?: boolean;
        json?: boolean;
        workspace?: string;
      }) => {
        const workspace = await resolveWorkspace(opts.workspace);
        const ledger = new Ledger({ workspacePath: workspace });

        const filters: QueryFilters = {};

        const timeRange = parseTimeRange(opts.last);
        if (timeRange) filters.timeRange = timeRange;

        if (opts.type) {
          if (!isActionType(opts.type)) {
            console.error(`${icons.fail} Unknown action type: ${opts.type}`);
            console.error(`  Run 'agenttrust rules list' to see valid action types.`);
            process.exitCode = 1;
            return;
          }
          filters.actionTypes = [opts.type];
        }

        if (opts.agent) filters.agent = opts.agent;
        if (opts.session) filters.session = opts.session;
        if (opts.above) filters.riskScoreMin = parseInt(opts.above, 10);

        if (opts.claims) {
          const result = await ledger.readClaims(filters);
          if (!result.ok) {
            console.error(`${icons.fail} Failed to read claims: ${result.error}`);
            process.exitCode = 1;
            return;
          }
          if (opts.json) {
            console.log(JSON.stringify(result.value, null, 2));
          } else {
            console.log(formatClaimsTable(result.value));
            console.log(`\n${result.value.length} claims (last ${opts.last})`);
          }
          return;
        }

        if (opts.paired) {
          const claimsResult = await ledger.readClaims(filters);
          const execResult = await ledger.read(filters);
          if (!claimsResult.ok) {
            console.error(`${icons.fail} Failed to read claims: ${claimsResult.error}`);
            process.exitCode = 1;
            return;
          }
          if (!execResult.ok) {
            console.error(`${icons.fail} Failed to read executions: ${execResult.error}`);
            process.exitCode = 1;
            return;
          }
          if (opts.json) {
            console.log(JSON.stringify({ claims: claimsResult.value, executions: execResult.value }, null, 2));
          } else {
            console.log(formatPairedTable(claimsResult.value, execResult.value));
          }
          return;
        }

        const result = await ledger.read(filters);
        if (!result.ok) {
          console.error(`${icons.fail} Failed to read ledger: ${result.error}`);
          process.exitCode = 1;
          return;
        }

        if (opts.json) {
          console.log(JSON.stringify(result.value, null, 2));
        } else {
          console.log(formatEntriesTable(result.value));
          console.log(`\n${result.value.length} entries (last ${opts.last})`);
        }
      },
    );
}

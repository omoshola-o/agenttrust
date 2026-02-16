import type { Command } from "commander";
import { join } from "node:path";
import { resolveWorkspace } from "../../src/ledger/ledger.js";
import { LedgerWatcher } from "../../src/watch/watcher.js";
import type { WatchOptions, WatchEvent } from "../../src/watch/watcher.js";
import type { RuleCategory } from "../../src/analyzer/types.js";
import {
  renderCompact,
  renderDetailed,
  renderClaimArrival,
  renderWatchSummary,
} from "../../src/watch/renderer.js";
import { icons } from "../formatters/color.js";

export function registerWatchCommand(program: Command): void {
  program
    .command("watch")
    .description("Live-stream agent actions as they happen (like tail -f for trust)")
    .option("--risk-only", "Only show entries that trigger rules")
    .option("--severity <level>", "Minimum severity to show (low/medium/high/critical)")
    .option("--category <cats>", "Comma-separated list of rule categories")
    .option("--show-claims", "Also show claims as they arrive")
    .option("--verbose", "Detailed output per entry")
    .option("-w, --workspace <path>", "Workspace path")
    .action(
      async (opts: {
        riskOnly?: boolean;
        severity?: string;
        category?: string;
        showClaims?: boolean;
        verbose?: boolean;
        workspace?: string;
      }) => {
        const workspace = await resolveWorkspace(opts.workspace);
        const ledgerDir = join(workspace, ".agenttrust", "ledger");
        const claimsDir = join(workspace, ".agenttrust", "claims");

        const categories = opts.category
          ? (opts.category.split(",").map((s) => s.trim()) as RuleCategory[])
          : undefined;

        const watchOptions: WatchOptions = {
          riskOnly: opts.riskOnly ?? false,
          showClaims: opts.showClaims ?? false,
          compact: !opts.verbose,
          minSeverity: opts.severity as WatchOptions["minSeverity"],
          categories,
        };

        const watcher = new LedgerWatcher({
          ledgerDir,
          claimsDir,
        });

        console.log(`${icons.info} Watching ${ledgerDir}`);
        console.log(`${icons.info} Press Ctrl+C to stop\n`);

        const callback = (event: WatchEvent): void => {
          if (event.type === "claim" && event.claim) {
            console.log(renderClaimArrival(event.claim));
          } else if (event.type === "entry" && event.entry) {
            if (watchOptions.compact) {
              console.log(renderCompact(event.entry, event.ruleMatches));
            } else {
              console.log(renderDetailed(event.entry, event.ruleMatches));
            }
          }
        };

        // Handle Ctrl+C gracefully
        const cleanup = (): void => {
          const summary = watcher.stop();
          console.log(renderWatchSummary(summary));
          process.exit(0);
        };

        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);

        await watcher.watch(watchOptions, callback);
      },
    );
}

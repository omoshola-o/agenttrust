import type { Command } from "commander";
import { join } from "node:path";
import { Ledger, resolveWorkspace } from "../../src/ledger/ledger.js";
import {
  readWitnessEntries,
  listWitnessFiles,
} from "../../src/witness/witness-storage.js";
import type { WitnessStorageConfig } from "../../src/witness/witness-storage.js";
import type { WitnessEntry, WitnessSource } from "../../src/witness/types.js";
import { correlate } from "../../src/correlation/engine.js";
import { loadInfrastructurePatterns } from "../../src/correlation/config.js";
import { formatCorrelationReport } from "../formatters/table.js";
import { icons } from "../formatters/color.js";
import { parseDuration } from "../utils/duration.js";

export function registerCorrelateCommand(program: Command): void {
  program
    .command("correlate")
    .description("Cross-check agent logs against independent witness observations")
    .option("--last <duration>", "Time range (e.g., 1h, 24h, 7d)", "24h")
    .option("--source <source>", "Only correlate specific source (filesystem, process, network)")
    .option("--show-matches", "Show all matched pairs (not just findings)")
    .option("--json", "Output as JSON for scripting")
    .option("-w, --workspace <path>", "Workspace path")
    .action(
      async (opts: {
        last: string;
        source?: string;
        showMatches?: boolean;
        json?: boolean;
        workspace?: string;
      }) => {
        const workspace = await resolveWorkspace(opts.workspace);
        const witnessDir = join(workspace, ".agenttrust", "witness");
        const storageConfig: WitnessStorageConfig = { witnessDir };

        // Parse time range
        const now = Date.now();
        const { cutoff } = parseDuration(opts.last);
        const from = new Date(cutoff).toISOString();
        const to = new Date(now).toISOString();

        // Load witness entries
        const files = await listWitnessFiles(storageConfig);
        if (!files.ok) {
          console.log(`${icons.fail} Could not read witness directory: ${files.error}`);
          process.exitCode = 1;
          return;
        }

        let witnessEntries: WitnessEntry[] = [];
        for (const file of files.value) {
          const entries = await readWitnessEntries(file);
          if (entries.ok) {
            witnessEntries.push(...entries.value);
          }
        }

        // Filter by time and source
        const sourceFilter = opts.source as WitnessSource | undefined;
        witnessEntries = witnessEntries.filter((e) => {
          const entryTime = new Date(e.ts).getTime();
          if (entryTime < cutoff) return false;
          if (sourceFilter && e.source !== sourceFilter) return false;
          return true;
        });

        // Load execution entries
        const ledger = new Ledger({ workspacePath: workspace });
        const execResult = await ledger.read({
          timeRange: { from: new Date(cutoff), to: new Date(now) },
        });
        const executions = execResult.ok ? execResult.value : [];

        if (witnessEntries.length === 0 && executions.length === 0) {
          console.log(`${icons.info} No witness events or execution entries in the specified range.`);
          return;
        }

        // Load user-defined infrastructure patterns
        const configPath = join(workspace, ".agenttrust", "config.yaml");
        const customInfraPatterns = await loadInfrastructurePatterns(configPath);

        // Run correlation
        const report = correlate(witnessEntries, executions, {
          timeRange: { from, to },
          customInfrastructurePatterns: customInfraPatterns.length > 0 ? customInfraPatterns : undefined,
        });

        // Display report
        if (opts.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(formatCorrelationReport(report, opts.showMatches ?? false));
        }
      },
    );
}


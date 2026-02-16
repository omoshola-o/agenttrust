import type { Command } from "commander";
import { join } from "node:path";
import { Ledger, resolveWorkspace } from "../../src/ledger/ledger.js";
import {
  readWitnessEntries,
  listWitnessFiles,
} from "../../src/witness/witness-storage.js";
import type { WitnessStorageConfig } from "../../src/witness/witness-storage.js";
import type { WitnessEntry } from "../../src/witness/types.js";
import { correlate } from "../../src/correlation/engine.js";
import { loadInfrastructurePatterns } from "../../src/correlation/config.js";
import { computeTrustVerdict } from "../../src/correlation/trust.js";
import { matchClaimsToExecutions, detectDivergences, computeConsistencyScore } from "../../src/consistency/index.js";
import { formatTrustVerdict } from "../formatters/table.js";
import { parseDuration } from "../utils/duration.js";

export function registerTrustCommand(program: Command): void {
  program
    .command("trust")
    .description("Run all three engines and produce combined trust score")
    .option("--last <duration>", "Time range (e.g., 1h, 24h, 7d)", "24h")
    .option("--json", "Output as JSON for scripting")
    .option("-w, --workspace <path>", "Workspace path")
    .action(
      async (opts: { last: string; json?: boolean; workspace?: string }) => {
        const workspace = await resolveWorkspace(opts.workspace);
        const witnessDir = join(workspace, ".agenttrust", "witness");
        const storageConfig: WitnessStorageConfig = { witnessDir };

        // Parse time range
        const now = Date.now();
        const { cutoff } = parseDuration(opts.last);
        const from = new Date(cutoff);
        const to = new Date(now);

        // 1. Integrity check
        const ledger = new Ledger({ workspacePath: workspace });
        const integrityReport = await ledger.verify();
        const integrity = integrityReport.valid ? 100 : 0;

        // 2. Consistency check
        const execResult = await ledger.read({ timeRange: { from, to } });
        const executions = execResult.ok ? execResult.value : [];
        const claimsResult = await ledger.readClaims({ timeRange: { from, to } });
        const claims = claimsResult.ok ? claimsResult.value : [];

        let consistency = 100;
        if (claims.length > 0 || executions.length > 0) {
          const matchResults = matchClaimsToExecutions(claims, executions);
          const findings = detectDivergences(matchResults);
          consistency = computeConsistencyScore(findings);
        }

        // 3. Witness correlation
        const files = await listWitnessFiles(storageConfig);
        let witnessEntries: WitnessEntry[] = [];
        if (files.ok) {
          for (const file of files.value) {
            const entries = await readWitnessEntries(file);
            if (entries.ok) {
              witnessEntries.push(...entries.value);
            }
          }
        }

        witnessEntries = witnessEntries.filter((e) => {
          const entryTime = new Date(e.ts).getTime();
          return entryTime >= cutoff;
        });

        // Load user-defined infrastructure patterns
        const configPath = join(workspace, ".agenttrust", "config.yaml");
        const customInfraPatterns = await loadInfrastructurePatterns(configPath);

        let witnessConfidence = 100;
        if (witnessEntries.length > 0 || executions.length > 0) {
          const report = correlate(
            witnessEntries,
            executions,
            {
              timeRange: { from: from.toISOString(), to: to.toISOString() },
              customInfrastructurePatterns: customInfraPatterns.length > 0 ? customInfraPatterns : undefined,
            },
          );
          witnessConfidence = report.witnessConfidence;
        }

        // 4. Compute trust verdict
        const verdict = computeTrustVerdict(integrity, consistency, witnessConfidence);

        // Display
        if (opts.json) {
          const json = {
            trust: {
              score: verdict.trustScore,
              level: verdict.level,
              components: {
                integrity: verdict.components.integrity,
                consistency: verdict.components.consistency,
                witnessConfidence: verdict.components.witnessConfidence,
              },
            },
            period: opts.last,
          };
          console.log(JSON.stringify(json, null, 2));
        } else {
          const period = opts.last;
          console.log(formatTrustVerdict(verdict, period));
        }
      },
    );
}


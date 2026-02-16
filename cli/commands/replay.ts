import type { Command } from "commander";
import { Ledger, resolveWorkspace } from "../../src/ledger/ledger.js";
import { parseTimeRange } from "../../src/query/filters.js";
import { RuleEngine } from "../../src/analyzer/engine.js";
import type { RuleMatch } from "../../src/analyzer/types.js";
import type { ConsistencyFinding } from "../../src/consistency/types.js";
import { matchClaimsToExecutions, detectDivergences } from "../../src/consistency/index.js";
import { buildGraph, getChain, analyzeBlame } from "../../src/replay/index.js";
import { formatChainSummary } from "../../src/replay/narrative.js";
import { colorizeSeverity, colorizeRisk, icons } from "../formatters/color.js";

function formatTs(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function registerReplayCommand(program: Command): void {
  program
    .command("replay [entry-id]")
    .description("Trace why something happened \u2014 follow the causal chain from any action")
    .option("--session <id>", "Build full causal graph for a session")
    .option("--last-incident", "Find and trace the most recent high-risk entry")
    .option("-l, --last <time>", "Time range (e.g. 24h, 7d)", "24h")
    .option("-w, --workspace <path>", "Workspace path")
    .action(
      async (
        entryId: string | undefined,
        opts: {
          session?: string;
          lastIncident?: boolean;
          last: string;
          workspace?: string;
        },
      ) => {
        const workspace = await resolveWorkspace(opts.workspace);
        const ledger = new Ledger({ workspacePath: workspace });
        const timeRange = parseTimeRange(opts.last);

        // Read entries
        const result = await ledger.read({
          timeRange: timeRange ?? undefined,
        });

        if (!result.ok) {
          console.error(`${icons.fail} Failed to read ledger: ${result.error}`);
          process.exitCode = 1;
          return;
        }

        let entries = result.value;

        // Filter by session if specified
        if (opts.session) {
          entries = entries.filter((e) => e.session === opts.session);
          if (entries.length === 0) {
            console.error(`${icons.fail} No entries found for session: ${opts.session}`);
            process.exitCode = 1;
            return;
          }
        }

        // Read claims
        let claims;
        try {
          const claimsResult = await ledger.readClaims({
            timeRange: timeRange ?? undefined,
          });
          if (claimsResult.ok) {
            claims = claimsResult.value;
          }
        } catch {
          // Claims are optional
        }

        // Run rules engine on all entries
        const engine = new RuleEngine();
        const report = engine.evaluateBatch(entries, claims);

        // Build rule matches map
        const ruleMatchesByEntry = new Map<string, RuleMatch[]>();
        for (const match of report.matches) {
          ruleMatchesByEntry.set(match.entry.id, match.ruleMatches);
        }

        // Build consistency findings map
        const findingsByEntry = new Map<string, ConsistencyFinding>();
        if (claims && claims.length > 0) {
          try {
            const matchResults = matchClaimsToExecutions(claims, entries);
            const findings = detectDivergences(matchResults);
            for (const finding of findings) {
              if (finding.execution) {
                findingsByEntry.set(finding.execution.id, finding);
              }
            }
          } catch {
            // Consistency analysis is optional
          }
        }

        // Build causal graph
        const graph = buildGraph(entries, {
          claims,
          ruleMatchesByEntry,
          findingsByEntry,
        });

        // Determine which entry to analyze
        let targetEntryId = entryId;

        if (opts.lastIncident) {
          // Find most recent high-risk entry
          const riskyEntries = entries
            .filter((e) => ruleMatchesByEntry.has(e.id))
            .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

          if (riskyEntries.length === 0) {
            console.log(`${icons.pass} No high-risk entries found in the time range.`);
            return;
          }
          targetEntryId = riskyEntries[0]!.id;
        }

        // Session mode: show full causal graph
        if (opts.session && !targetEntryId) {
          console.log(`\nCausal Graph for session: ${opts.session}`);
          console.log(`Entries: ${graph.totalNodes} | Max depth: ${graph.maxDepth}\n`);

          for (const root of graph.roots) {
            printTree(root, ruleMatchesByEntry, 0);
          }

          // Summary
          const riskyNodes = [...graph.nodeIndex.values()].filter(
            (n) => n.ruleMatches.length > 0,
          );
          if (riskyNodes.length > 0) {
            console.log(`\nBlame Roots (${riskyNodes.length}):`);
            for (const node of riskyNodes) {
              const ruleNames = node.ruleMatches.map((m) => m.ruleId).join(", ");
              console.log(
                `  ${icons.fail} ${node.entry.id.slice(0, 9)}... ${node.entry.action.type} \u2014 ${ruleNames}`,
              );
            }
          }
          return;
        }

        if (!targetEntryId) {
          console.error(
            `${icons.fail} Please specify an entry ID, --session <id>, or --last-incident`,
          );
          process.exitCode = 1;
          return;
        }

        // Single entry blame analysis
        const targetEntry = entries.find((e) => e.id === targetEntryId || e.id.startsWith(targetEntryId!));
        if (!targetEntry) {
          console.error(`${icons.fail} Entry not found: ${targetEntryId}`);
          process.exitCode = 1;
          return;
        }

        const blameReport = analyzeBlame(
          targetEntry,
          graph,
          ruleMatchesByEntry,
          findingsByEntry,
        );

        // Output
        console.log(
          `\nBlame Analysis for: ${targetEntry.action.type} ${targetEntry.action.target} (${targetEntry.id.slice(0, 9)}...)`,
        );
        console.log("");

        console.log(`Causal Chain (${blameReport.chain.length} actions):`);
        console.log(formatChainSummary(blameReport.chain));
        console.log("");

        console.log(
          `Blame Root: Step [${blameReport.chain.indexOf(blameReport.blameRoot)}] \u2014 ${blameReport.blameRoot.entry.action.type}`,
        );
        console.log("");

        if (blameReport.factors.length > 0) {
          console.log("Contributing Factors:");
          for (const factor of blameReport.factors) {
            console.log(`  \u2022 ${factor.type} \u2014 ${factor.description}`);
          }
          console.log("");
        }

        console.log("Narrative:");
        console.log(`  ${blameReport.narrative}`);
        console.log("");

        console.log("Recommendation:");
        console.log(`  ${blameReport.recommendation}`);
      },
    );
}

function printTree(
  node: import("../../src/replay/types.js").CausalNode,
  ruleMatchesByEntry: Map<string, RuleMatch[]>,
  indent: number,
): void {
  const prefix = indent > 0 ? "  ".repeat(indent) + "\u2514\u2500 " : "";
  const riskStr = node.ruleMatches.length > 0
    ? ` \uD83D\uDD34 ${node.ruleMatches.map((m) => m.ruleId).join(", ")}`
    : "";
  console.log(
    `${prefix}${node.entry.action.type} ${node.entry.action.target.slice(0, 30)}${riskStr}`,
  );
  for (const child of node.children) {
    printTree(child, ruleMatchesByEntry, indent + 1);
  }
}

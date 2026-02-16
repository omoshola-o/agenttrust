import type { Command } from "commander";
import { join } from "node:path";
import { Ledger, resolveWorkspace } from "../../src/ledger/ledger.js";
import { collectDailyData, collectWeeklyData } from "../../src/digest/collector.js";
import { generateDailyDigest } from "../../src/digest/daily.js";
import { generateWeeklyDigest } from "../../src/digest/weekly.js";
import { writeDigestForDate, getDigestPath } from "../../src/digest/writer.js";
import type { DigestConfig } from "../../src/digest/types.js";
import { DEFAULT_DIGEST_CONFIG } from "../../src/digest/types.js";
import { icons } from "../formatters/color.js";
import { existsSync } from "node:fs";

export function registerDigestCommand(program: Command): void {
  program
    .command("digest")
    .description("Generate activity digests (daily/weekly markdown summaries)")
    .option("--date <date>", "Date for the digest (YYYY-MM-DD, default: today)")
    .option("--weekly", "Generate weekly digest instead of daily")
    .option("--auto", "Generate all pending digests (days without digest files)")
    .option("--json", "Output as JSON for scripting")
    .option("-w, --workspace <path>", "Workspace path")
    .action(
      async (opts: {
        date?: string;
        weekly?: boolean;
        auto?: boolean;
        json?: boolean;
        workspace?: string;
      }) => {
        const workspace = await resolveWorkspace(opts.workspace);
        const digestDir = join(workspace, ".agenttrust", "digests");
        const ledger = new Ledger({ workspacePath: workspace });

        const config: DigestConfig = {
          ...DEFAULT_DIGEST_CONFIG,
          outputDir: digestDir,
        };

        const targetDate = opts.date ? new Date(opts.date + "T00:00:00Z") : new Date();

        if (opts.auto) {
          await generateAutoDigests(ledger, config);
          return;
        }

        if (opts.weekly) {
          if (!opts.json) console.log(`${icons.info} Generating weekly digest...`);
          const data = await collectWeeklyData(targetDate, ledger, config);
          const content = generateWeeklyDigest(data);
          const path = await writeDigestForDate(config, content, "weekly", targetDate);
          if (opts.json) {
            console.log(JSON.stringify({ type: "weekly", path, period: data.period.label, actions: data.activity.totalActions, alerts: data.highlights.ruleMatches.length }, null, 2));
          } else {
            console.log(`${icons.pass} Weekly digest written to: ${path}`);
            console.log(`  Period: ${data.period.label}`);
            console.log(`  Actions: ${data.activity.totalActions}`);
            console.log(`  Risk alerts: ${data.highlights.ruleMatches.length}`);
          }
        } else {
          if (!opts.json) console.log(`${icons.info} Generating daily digest...`);
          const data = await collectDailyData(targetDate, ledger, config);
          const content = generateDailyDigest(data);
          const path = await writeDigestForDate(config, content, "daily", targetDate);
          if (opts.json) {
            console.log(JSON.stringify({ type: "daily", path, date: data.period.label, actions: data.activity.totalActions, alerts: data.highlights.ruleMatches.length }, null, 2));
          } else {
            console.log(`${icons.pass} Daily digest written to: ${path}`);
            console.log(`  Date: ${data.period.label}`);
            console.log(`  Actions: ${data.activity.totalActions}`);
            console.log(`  Risk alerts: ${data.highlights.ruleMatches.length}`);
          }
        }
      },
    );
}

async function generateAutoDigests(
  ledger: Ledger,
  config: DigestConfig,
): Promise<void> {
  const stats = await ledger.getStats();
  if (!stats.oldestEntry) {
    console.log(`${icons.info} No entries found. Nothing to generate.`);
    return;
  }

  const startDate = new Date(stats.oldestEntry);
  const endDate = new Date();
  const generated: string[] = [];

  const current = new Date(startDate);
  current.setUTCHours(0, 0, 0, 0);

  while (current <= endDate) {
    const digestPath = getDigestPath(config, "daily", current);
    if (!existsSync(digestPath)) {
      try {
        const data = await collectDailyData(current, ledger, config);
        if (data.activity.totalActions > 0) {
          const content = generateDailyDigest(data);
          const path = await writeDigestForDate(config, content, "daily", current);
          generated.push(path);
        }
      } catch {
        // Skip dates that fail
      }
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  if (generated.length > 0) {
    console.log(`${icons.pass} Generated ${generated.length} digest(s):`);
    for (const path of generated) {
      console.log(`  ${path}`);
    }
  } else {
    console.log(`${icons.pass} All digests are up to date.`);
  }
}

import type { Command } from "commander";
import { join } from "node:path";
import { resolveWorkspace } from "../../src/ledger/ledger.js";
import { WitnessDaemon } from "../../src/witness/daemon.js";
import { DEFAULT_WITNESS_CONFIG } from "../../src/witness/types.js";
import type { WitnessConfig, WitnessSource } from "../../src/witness/types.js";
import {
  readWitnessEntries,
  listWitnessFiles,
  appendWitnessEntry,
} from "../../src/witness/witness-storage.js";
import type { WitnessStorageConfig } from "../../src/witness/witness-storage.js";
import type { WitnessEntry } from "../../src/witness/types.js";
import { canonicalize, hashEntry } from "../../src/ledger/hash-chain.js";
import { createHash } from "node:crypto";
import { ulid } from "ulid";
import { icons } from "../formatters/color.js";
import { parseDuration } from "../utils/duration.js";

function hashWitnessEntry(entry: Omit<WitnessEntry, "hash">, prevHash: string): string {
  const withPrev = { ...entry, prevHash };
  const sorted = canonicalize(withPrev);
  return createHash("sha256").update(sorted).digest("hex");
}

export function registerWitnessCommand(program: Command): void {
  const witness = program
    .command("witness")
    .description("Independent system observer \u2014 start, stop, and inspect witness data");

  witness
    .command("start")
    .description("Start the witness daemon (foreground)")
    .option("-w, --workspace <path>", "Workspace path")
    .action(async (opts: { workspace?: string }) => {
      const workspace = await resolveWorkspace(opts.workspace);
      const witnessDir = join(workspace, ".agenttrust", "witness");

      const config: WitnessConfig = {
        ...DEFAULT_WITNESS_CONFIG,
      };

      const storageConfig: WitnessStorageConfig = { witnessDir };
      let lastHash = "";

      // Get the last hash for chain continuity
      const files = await listWitnessFiles(storageConfig);
      if (files.ok && files.value.length > 0) {
        const lastFile = files.value[files.value.length - 1]!;
        const entries = await readWitnessEntries(lastFile);
        if (entries.ok && entries.value.length > 0) {
          lastHash = entries.value[entries.value.length - 1]!.hash;
        }
      }

      const daemon = new WitnessDaemon(config);

      console.log(`${icons.pass} Witness daemon starting...`);
      console.log(`  Workspace: ${workspace}`);
      console.log(`  Witness dir: ${witnessDir}`);
      console.log(`  Watch paths: ${config.watchPaths.join(", ")}`);
      console.log("");

      await daemon.start(async (events) => {
        for (const { source, event } of events) {
          const id = ulid();
          const ts = new Date().toISOString();
          const partial: Omit<WitnessEntry, "hash"> = {
            id,
            v: 1,
            ts,
            prevHash: lastHash,
            source,
            event,
            correlated: false,
          };
          const hash = hashWitnessEntry(partial, lastHash);
          const entry: WitnessEntry = { ...partial, hash };

          await appendWitnessEntry(storageConfig, entry);
          lastHash = hash;
        }
      });

      // Keep running until interrupted
      console.log(`${icons.info} Witness daemon running. Press Ctrl+C to stop.\n`);

      const handleShutdown = async () => {
        console.log(`\n${icons.info} Shutting down witness daemon...`);
        await daemon.stop();
        const stats = daemon.getStats();
        console.log(`${icons.pass} Witness daemon stopped.`);
        console.log(
          `  Events: ${stats.events.file} file, ${stats.events.process} process, ${stats.events.network} network`,
        );
        process.exit(0);
      };

      process.on("SIGINT", () => void handleShutdown());
      process.on("SIGTERM", () => void handleShutdown());
    });

  witness
    .command("status")
    .description("Show witness daemon status and event counts")
    .option("--json", "Output as JSON for scripting")
    .option("-w, --workspace <path>", "Workspace path")
    .action(async (opts: { json?: boolean; workspace?: string }) => {
      const workspace = await resolveWorkspace(opts.workspace);
      const witnessDir = join(workspace, ".agenttrust", "witness");
      const storageConfig: WitnessStorageConfig = { witnessDir };

      const files = await listWitnessFiles(storageConfig);
      if (!files.ok) {
        console.log(`${icons.fail} Could not read witness directory: ${files.error}`);
        return;
      }

      let totalEvents = 0;
      let fileCounts = { file: 0, process: 0, network: 0 };

      for (const file of files.value) {
        const entries = await readWitnessEntries(file);
        if (entries.ok) {
          totalEvents += entries.value.length;
          for (const entry of entries.value) {
            if (entry.source === "filesystem") fileCounts.file++;
            else if (entry.source === "process") fileCounts.process++;
            else if (entry.source === "network") fileCounts.network++;
          }
        }
      }

      if (opts.json) {
        console.log(JSON.stringify({
          witnessDir,
          files: files.value.length,
          totalEvents,
          events: fileCounts,
        }, null, 2));
      } else {
        console.log("\nWitness Status");
        console.log(`  Witness dir: ${witnessDir}`);
        console.log(`  Files: ${files.value.length}`);
        console.log(`  Total events: ${totalEvents}`);
        console.log(
          `  Events: ${fileCounts.file} file, ${fileCounts.process} process, ${fileCounts.network} network`,
        );
      }
    });

  witness
    .command("log")
    .description("Show recent witness events")
    .option("--last <duration>", "Time range (e.g., 1h, 24h, 7d)", "24h")
    .option("--source <source>", "Filter by source (filesystem, process, network)")
    .option("--json", "Output as JSON for scripting")
    .option("-w, --workspace <path>", "Workspace path")
    .action(
      async (opts: { last: string; source?: string; json?: boolean; workspace?: string }) => {
        const workspace = await resolveWorkspace(opts.workspace);
        const witnessDir = join(workspace, ".agenttrust", "witness");
        const storageConfig: WitnessStorageConfig = { witnessDir };

        const files = await listWitnessFiles(storageConfig);
        if (!files.ok || files.value.length === 0) {
          console.log(`${icons.info} No witness events found.`);
          return;
        }

        // Parse time range
        const { cutoff } = parseDuration(opts.last);
        const sourceFilter = opts.source as WitnessSource | undefined;

        let allEntries: WitnessEntry[] = [];
        for (const file of files.value) {
          const entries = await readWitnessEntries(file);
          if (entries.ok) {
            allEntries.push(...entries.value);
          }
        }

        // Filter by time and source
        allEntries = allEntries.filter((e) => {
          const entryTime = new Date(e.ts).getTime();
          if (entryTime < cutoff) return false;
          if (sourceFilter && e.source !== sourceFilter) return false;
          return true;
        });

        if (allEntries.length === 0) {
          if (opts.json) {
            console.log("[]");
          } else {
            console.log(`${icons.info} No witness events in the specified range.`);
            console.log(`  Start the daemon with 'agenttrust witness start'.`);
          }
          return;
        }

        if (opts.json) {
          console.log(JSON.stringify(allEntries, null, 2));
          return;
        }

        console.log(`\nWitness Events (${allEntries.length})\n`);
        for (const entry of allEntries.slice(-50)) {
          const event = entry.event;
          const ts = new Date(entry.ts).toLocaleString("en-US", {
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          });

          let detail: string;
          if ("path" in event) {
            detail = `${event.type} ${event.path}`;
          } else if ("command" in event) {
            detail = `${event.type} ${event.command} (PID ${event.pid})`;
          } else if ("remoteHost" in event) {
            detail = `${event.type} ${event.remoteHost}:${event.remotePort ?? "?"}`;
          } else {
            detail = JSON.stringify(event);
          }

          const sourceIcon =
            entry.source === "filesystem" ? "📁" : entry.source === "process" ? "⚙️" : "🌐";
          console.log(`  ${sourceIcon} ${ts}  [${entry.source}] ${detail}`);
        }

        if (allEntries.length > 50) {
          console.log(`\n  ... and ${allEntries.length - 50} more events`);
        }
      },
    );

  witness
    .command("config")
    .description("Show current witness configuration")
    .action(() => {
      const config = DEFAULT_WITNESS_CONFIG;
      console.log("\nWitness Configuration\n");
      console.log(`  Enabled: ${config.enabled}`);
      console.log(`  Watch paths:`);
      for (const p of config.watchPaths) {
        console.log(`    - ${p}`);
      }
      console.log(`  Exclude paths:`);
      for (const p of config.excludePaths) {
        console.log(`    - ${p}`);
      }
      console.log(`  Process polling: ${config.processPollingMs}ms`);
      console.log(`  Network polling: ${config.networkPollingMs}ms`);
      console.log(`  Buffer size: ${config.bufferSize}`);
      console.log(`  Gateway PID file: ${config.gateway.pidFile}`);
      console.log(`  Gateway process name: ${config.gateway.processName}`);
    });
}


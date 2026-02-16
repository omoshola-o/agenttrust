import type { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveWorkspace } from "../../src/ledger/ledger.js";
import { icons } from "../formatters/color.js";

const DEFAULT_CONFIG = `# AgentTrust configuration
riskThreshold: 7
logRetentionDays: 90

# Witness daemon settings
# witness:
#   infrastructurePatterns:
#     - host: "api.mycompany.com"
#       label: "internal-api"
#     - host: "*.internal.mycompany.com"
#       port: 443
#       label: "internal-services"
`;

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize AgentTrust in a workspace")
    .option("-w, --workspace <path>", "Workspace path")
    .action(async (opts: { workspace?: string }) => {
      const workspace = await resolveWorkspace(opts.workspace);
      const atDir = join(workspace, ".agenttrust");
      const ledgerDir = join(atDir, "ledger");
      const claimsDir = join(atDir, "claims");
      const digestsDir = join(atDir, "digests");
      const witnessDir = join(atDir, "witness");
      const configPath = join(atDir, "config.yaml");

      try {
        await mkdir(ledgerDir, { recursive: true, mode: 0o700 });
        await mkdir(claimsDir, { recursive: true, mode: 0o700 });
        await mkdir(digestsDir, { recursive: true, mode: 0o700 });
        await mkdir(witnessDir, { recursive: true, mode: 0o700 });
        await writeFile(configPath, DEFAULT_CONFIG, { mode: 0o600, flag: "wx" }).catch(() => {
          // config already exists, skip
        });

        console.log(`${icons.pass} AgentTrust initialized at ${atDir}`);
        console.log("");
        console.log(`  Ledger   ${ledgerDir}`);
        console.log(`  Claims   ${claimsDir}`);
        console.log(`  Digests  ${digestsDir}`);
        console.log(`  Witness  ${witnessDir}`);
        console.log(`  Config   ${configPath}`);
        console.log("");
        console.log("Next steps:");
        console.log(`  agenttrust status    — dashboard overview`);
        console.log(`  agenttrust log       — view recent actions`);
        console.log(`  agenttrust verify    — check ledger integrity`);
        console.log(`  agenttrust doctor    — run health check`);
      } catch (err) {
        console.error(`${icons.fail} Failed to initialize: ${err}`);
        process.exitCode = 1;
      }
    });
}

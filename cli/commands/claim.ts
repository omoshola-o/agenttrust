import type { Command } from "commander";
import { Ledger, resolveWorkspace } from "../../src/ledger/ledger.js";
import { isActionType } from "../../src/schema/action-types.js";
import { icons } from "../formatters/color.js";

export function registerClaimCommand(program: Command): void {
  program
    .command("claim")
    .description("Declare intent before acting (agent calls this before side effects)")
    .option("--quiet", "Only output the claim ID (for scripts)")
    .requiredOption("--action <type>", "Planned action type (e.g. file.read)")
    .requiredOption("--target <target>", "Planned target")
    .requiredOption("--goal <text>", "Why the agent plans to do this")
    .option("--risk <score>", "Self-assessed risk score (0-10)", "0")
    .option("--within-scope <bool>", "Is this within the original user request?", "true")
    .option("--requires-elevation <bool>", "Requires elevated permissions?", "false")
    .option("--external-comms <bool>", "Involves external communication?", "false")
    .option("--financial <bool>", "Involves financial actions?", "false")
    .option("--expected-outcome <outcome>", "Expected outcome (success|partial|unknown)", "success")
    .option("--agent <name>", "Agent identifier", "default")
    .option("--session <id>", "Session identifier", "default")
    .option("-w, --workspace <path>", "Workspace path")
    .action(
      async (opts: {
        action: string;
        target: string;
        goal: string;
        risk: string;
        withinScope: string;
        requiresElevation: string;
        externalComms: string;
        financial: string;
        expectedOutcome: string;
        agent: string;
        session: string;
        quiet?: boolean;
        workspace?: string;
      }) => {
        if (!isActionType(opts.action)) {
          console.error(`${icons.fail} Unknown action type: ${opts.action}`);
          console.error(`  Run 'agenttrust rules list' to see valid action types.`);
          process.exitCode = 1;
          return;
        }

        const risk = parseInt(opts.risk, 10);
        if (isNaN(risk) || risk < 0 || risk > 10) {
          console.error(`${icons.fail} Risk score must be 0-10`);
          process.exitCode = 1;
          return;
        }

        const expectedOutcome = opts.expectedOutcome;
        if (expectedOutcome !== "success" && expectedOutcome !== "partial" && expectedOutcome !== "unknown") {
          console.error(`${icons.fail} Expected outcome must be success, partial, or unknown`);
          process.exitCode = 1;
          return;
        }

        const workspace = await resolveWorkspace(opts.workspace);
        const ledger = new Ledger({ workspacePath: workspace });

        const result = await ledger.appendClaim({
          agent: opts.agent,
          session: opts.session,
          intent: {
            plannedAction: opts.action,
            plannedTarget: opts.target,
            goal: opts.goal,
            expectedOutcome,
            selfAssessedRisk: risk,
          },
          constraints: {
            withinScope: opts.withinScope === "true",
            requiresElevation: opts.requiresElevation === "true",
            involvesExternalComms: opts.externalComms === "true",
            involvesFinancial: opts.financial === "true",
          },
        });

        if (!result.ok) {
          console.error(`${icons.fail} Failed to write claim: ${result.error}`);
          process.exitCode = 1;
          return;
        }

        if (opts.quiet) {
          console.log(result.value.id);
        } else {
          console.log(`${icons.pass} Claim recorded: ${result.value.id}`);
          console.log(`  Action   ${opts.action}`);
          console.log(`  Target   ${opts.target}`);
          console.log(`  Risk     ${risk}/10`);
          console.log(`  Goal     ${opts.goal}`);
        }
      },
    );
}

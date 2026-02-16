#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";

// ── Overview ────────────────────────────────────
import { registerStatusCommand } from "./commands/status.js";
import { registerTrustCommand } from "./commands/trust.js";

// ── Observe ─────────────────────────────────────
import { registerLogCommand } from "./commands/log.js";
import { registerClaimCommand } from "./commands/claim.js";
import { registerWitnessCommand } from "./commands/witness.js";

// ── Verify ──────────────────────────────────────
import { registerVerifyCommand } from "./commands/verify.js";
import { registerConsistencyCommand } from "./commands/consistency.js";
import { registerCorrelateCommand } from "./commands/correlate.js";

// ── Investigate ─────────────────────────────────
import { registerAuditCommand } from "./commands/audit.js";
import { registerReplayCommand } from "./commands/replay.js";
import { registerDigestCommand } from "./commands/digest.js";

// ── Manage ──────────────────────────────────────
import { registerInitCommand } from "./commands/init.js";
import { registerRulesCommand } from "./commands/rules.js";
import { registerWatchCommand } from "./commands/watch.js";
import { registerDoctorCommand } from "./commands/doctor.js";

const program = new Command();

program
  .name("agenttrust")
  .description("Trust & audit layer for AI agents")
  .version("0.1.0");

program.addHelpText("beforeAll", chalk.bold("AgentTrust") + "  Trust & audit layer for AI agents\n");

// Overview — top-level status at a glance
registerStatusCommand(program);
registerTrustCommand(program);

// Observe — what the agent is doing
registerLogCommand(program);
registerClaimCommand(program);
registerWitnessCommand(program);

// Verify — is the data trustworthy?
registerVerifyCommand(program);
registerConsistencyCommand(program);
registerCorrelateCommand(program);

// Investigate — dig deeper
registerAuditCommand(program);
registerReplayCommand(program);
registerDigestCommand(program);

// Manage — setup & configuration
registerInitCommand(program);
registerRulesCommand(program);
registerWatchCommand(program);
registerDoctorCommand(program);

program.parse();

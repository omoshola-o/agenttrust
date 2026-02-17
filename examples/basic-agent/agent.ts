/**
 * Example: Wiring AgentTrust into a basic AI agent.
 *
 * This shows the three integration patterns:
 *   1. logAction()      — Log what the agent did (one-liner)
 *   2. declareIntent()  — Declare what the agent plans to do (before acting)
 *   3. Full Ledger API  — Direct access for advanced use cases
 *
 * Run with:
 *   npx tsx examples/basic-agent/agent.ts
 */

import {
  initWorkspace,
  logAction,
  declareIntent,
  Ledger,
} from "agenttrust";

// ─── Setup ─────────────────────────────────────────────────────────

async function main() {
  // Initialize AgentTrust in the current directory.
  // This creates .agenttrust/ledger/ and .agenttrust/claims/ if they don't exist.
  const initResult = await initWorkspace(process.cwd());
  if (!initResult.ok) {
    console.error("Failed to init workspace:", initResult.error);
    process.exit(1);
  }
  console.log("AgentTrust workspace initialized.\n");

  // ─── Pattern 1: Simple one-liner logging ───────────────────────

  console.log("Pattern 1: Simple logging\n");

  // Log a file read — just type, target, detail. Everything else defaults.
  await logAction({
    type: "file.read",
    target: "./package.json",
    detail: "Read package.json to check dependencies",
  });
  console.log("  Logged: file.read → ./package.json");

  // Log an API call with more context
  await logAction({
    type: "api.call",
    target: "https://api.openai.com/v1/chat/completions",
    detail: "Called GPT-4 to summarize user request",
    risk: 2,
    riskLabels: ["communication"],
    goal: "Summarize the user's document",
    durationMs: 1340,
    session: "ses_abc123",
  });
  console.log("  Logged: api.call → openai.com");

  // Log a command execution
  await logAction({
    type: "exec.command",
    target: "npm install express",
    detail: "Installed express for the user's project",
    risk: 4,
    riskLabels: ["execution"],
    status: "success",
    durationMs: 8200,
  });
  console.log("  Logged: exec.command → npm install express");

  // ─── Pattern 2: Declare intent, then act ───────────────────────

  console.log("\nPattern 2: Declare-then-act\n");

  // Step 1: Declare what you're about to do
  const claim = await declareIntent({
    type: "file.write",
    target: "./src/config.ts",
    goal: "Create configuration file for the user",
    risk: 1,
  });

  if (claim.ok) {
    console.log(`  Declared intent: ${claim.value.id}`);

    // Step 2: Perform the action
    // ... (your agent does the actual work here) ...

    // Step 3: Log the execution, linking back to the claim
    await logAction({
      type: "file.write",
      target: "./src/config.ts",
      detail: "Created config.ts with default settings",
      risk: 1,
      meta: { claimId: claim.value.id },
    });
    console.log("  Logged execution with claimId link");
  }

  // ─── Pattern 3: Sensitive action with full risk info ───────────

  console.log("\nPattern 3: High-risk action\n");

  // Reading SSH keys — risk score 9, auto-flagged
  await logAction({
    type: "file.read",
    target: "/home/user/.ssh/id_rsa",
    detail: "Read SSH private key for server deployment",
    risk: 9,
    riskLabels: ["data_access", "escalation"],
    goal: "Deploy code to production server",
    trigger: "user_request",
    session: "ses_deploy_001",
  });
  console.log("  Logged: file.read → ~/.ssh/id_rsa (risk: 9, auto-flagged)");

  // ─── Pattern 4: Direct Ledger API ──────────────────────────────

  console.log("\nPattern 4: Direct Ledger API\n");

  const ledger = new Ledger({ workspacePath: process.cwd() });

  // Read all logged actions
  const result = await ledger.read();
  if (result.ok) {
    console.log(`  Total entries in ledger: ${result.value.length}`);
  }

  // Verify integrity
  const integrity = await ledger.verify();
  console.log(`  Hash chain integrity: ${integrity.valid ? "PASS" : "FAIL"}`);
  console.log(`  Files verified: ${integrity.filesChecked}`);

  // Get stats
  const stats = await ledger.getStats();
  console.log(`  Risk breakdown: ${JSON.stringify(stats.riskyCounts)}`);

  console.log("\nDone. Run 'agenttrust status' to see the dashboard.");
}

main().catch(console.error);

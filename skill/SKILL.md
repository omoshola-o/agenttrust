---
name: agenttrust
description: "Trust & audit layer that logs every agent action to a tamper-evident local ledger. Tracks what the agent did, why, and whether it should have. Use after tool calls that have side effects. Supports claim-before-act pattern for intent verification."
emoji: 🛡️
metadata:
  openclaw:
    requires:
      bins:
        - agenttrust
    primaryEnv: null
    homepage: "https://github.com/omoshola-o/agenttrust"
user-invocable: true
disable-model-invocation: false
---

# AgentTrust — Trust & Audit Layer

## What This Is

AgentTrust logs your actions to a tamper-evident local ledger so the user can review what you did, why, and whether any actions were risky. Logs are hash-chained JSONL files stored at `<workspace>/.agenttrust/ledger/`. Claims (declared intent) are stored at `<workspace>/.agenttrust/claims/`.

## When to Log

Log after **every tool call that produces a side effect**. This includes:

- Sending messages (`message`, `email`)
- Writing, creating, or deleting files (`write`, `create`, `delete`)
- Making API calls to external services
- Executing shell commands or scripts (`exec`)
- Browsing or interacting with web pages (`browser`)
- Making payments or financial transactions
- Creating or modifying calendar events
- Spawning sub-sessions
- Enabling elevated mode or running elevated commands

**Do NOT log:**
- Internal reasoning, planning, or thinking steps
- Reading skill documentation or reference files
- Pure read operations on non-sensitive local files (e.g., reading a config to decide what to do)
- Reading your own memory files

When in doubt: if the action changes state outside your context (sends data, modifies files, executes code), log it.

## How to Log Actions

### Two-Step Pattern (preferred)

Before every side-effect tool call:

**Step 1: Declare intent**
Call via exec:
```bash
agenttrust claim --action <type> --target <target> --goal "<why>" --risk <0-10> --within-scope <true|false>
```

This returns a claim ID. Remember it. Use `--quiet` to get only the ID for scripting.

**Step 2: Execute the action**
Perform the side-effect tool call as normal. The execution ledger records it automatically when integrated via the AgentTrust library. The consistency engine will match your claim to the execution entry.

### One-Step Pattern (fallback)

If you cannot claim before acting (e.g. the action is reactive/immediate), the execution is still logged by the ledger. The consistency engine will note it as an "unclaimed execution" — this is acceptable for reactive actions but should be avoided for planned ones.

### What to Log (side-effect tool calls only)
- exec (shell commands)
- file read/write/delete
- message send
- web fetch/search/browse
- api calls
- calendar modifications
- payment actions
- session spawning
- elevated mode usage

### What NOT to Log
- Internal reasoning or planning steps
- Reading the SKILL.md itself
- Checking the current time
- Pure computation with no side effects

## Logging Workflow

After performing a side-effect action:

1. Determine the **action type** from the taxonomy (see `references/action-types.md`)
2. Identify the **target** (file path, URL, contact, etc.)
3. Write a brief **detail** describing what you did
4. Record the **goal** you were pursuing and what **triggered** this action
5. Note the **outcome** (success/failure) and duration
6. Assess the **risk score** (0-10) and apply relevant **risk labels** (see `references/risk-levels.md`)
7. Set `autoFlagged: true` if risk score >= 7 or the action involves payments, elevated mode, or sensitive file access

## User Commands

When the user asks about your activity, use these commands:

- "Quick overview" -> `agenttrust status`
- "What did you do?" -> `agenttrust log --last 24h`
- "Show risky actions" -> `agenttrust audit --flag-risky`
- "Did anything suspicious happen?" -> `agenttrust audit --above 7`
- "Is the log intact?" -> `agenttrust verify`
- "Do I trust you?" -> `agenttrust trust --last 24h`
- "Health check" -> `agenttrust doctor`
- "Show your claims" -> `agenttrust log --claims`
- "Show paired claims and actions" -> `agenttrust log --paired`
- "How consistent were you?" -> `agenttrust consistency --last 24h`
- "What did the witness see?" -> `agenttrust witness log --last 24h`
- "Cross-check logs" -> `agenttrust correlate --last 24h`

## Risk Assessment Quick Guide

| Score | When |
|---|---|
| 0-3 | Reading files, web searches, memory reads |
| 4-6 | Sending messages to known contacts, writing files, API calls |
| 7-8 | Accessing credentials, executing commands, new contacts |
| 9-10 | Payments, SSH keys, elevated mode, deleting files |

## Witness Daemon

AgentTrust includes an independent witness that observes system-level activity.
The witness daemon watches file changes, process spawns, and network connections
independently of your self-reported logs.

### For the agent:
You do NOT need to interact with the witness daemon. It runs independently.
Continue using the claim-then-log pattern as before. The witness provides
an independent verification layer that the user can consult.

### For the user:
Start the witness before your agent session:
```bash
agenttrust witness start
```

After your session, check the three-way verification:
```bash
agenttrust trust --last 24h
```

Run correlation analysis:
```bash
agenttrust correlate --last 24h
```

Stop the witness when not needed:
```bash
agenttrust witness stop
```

## References

- `references/action-types.md` — Full action type taxonomy
- `references/risk-levels.md` — Risk scoring and label guide
- `references/log-format.md` — ATF entry schema details

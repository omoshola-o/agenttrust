# Basic Agent Example

Shows how to wire AgentTrust into an AI agent using three patterns:

1. **`logAction()`** — One-liner to log what the agent did
2. **`declareIntent()` + `logAction()`** — Declare intent before acting, then log
3. **Direct `Ledger` API** — Full control for advanced use cases

## Run

```bash
# From the repo root
pnpm build
npx tsx examples/basic-agent/agent.ts

# Then inspect
agenttrust status
agenttrust log --last 1h
agenttrust verify
```

# ATF Entry Format (AgentTrust Format)

Each ledger entry is a single JSON object on one line in a JSONL file.

## Field Reference

| Field | Type | Description |
|---|---|---|
| `id` | string | ULID (time-sortable unique ID) |
| `v` | number | Schema version (always `1`) |
| `ts` | string | ISO-8601 timestamp with milliseconds |
| `prevHash` | string | SHA-256 hash of previous entry (`""` for first entry in file) |
| `hash` | string | SHA-256 hash of this entry |
| `agent` | string | Agent identifier (default: `"default"`) |
| `session` | string | Session identifier |
| `action` | object | What the agent did |
| `action.type` | string | Action type from taxonomy (see `action-types.md`) |
| `action.target` | string | What was acted upon (file path, URL, contact, etc.) |
| `action.detail` | string | Human-readable description |
| `context` | object | Why the agent did it |
| `context.goal` | string | The goal the agent was pursuing |
| `context.trigger` | string | What triggered this action |
| `context.parentAction` | string? | ULID of parent action (if part of a chain) |
| `outcome` | object | What happened |
| `outcome.status` | string | `"success"`, `"failure"`, `"partial"`, or `"blocked"` |
| `outcome.detail` | string? | Additional outcome detail |
| `outcome.durationMs` | number? | How long the action took in milliseconds |
| `risk` | object | Risk assessment |
| `risk.score` | number | 0-10 scale |
| `risk.labels` | string[] | Risk labels (see `risk-levels.md`) |
| `risk.autoFlagged` | boolean | Whether this was automatically flagged |
| `meta` | object? | Extensible metadata |

## Hash Chain

Entries are hash-chained for tamper evidence:

1. First entry in a file: `prevHash = ""`
2. Each subsequent entry: `prevHash = previous entry's hash`
3. Hash is SHA-256 of all fields except `hash` itself, with keys sorted alphabetically

## Example Entry

```json
{"id":"01HQXG5K7R3M0N2P4Q6S8T0V","v":1,"ts":"2026-02-13T14:32:01.847Z","prevHash":"","hash":"a1b2c3...","agent":"default","session":"ses_abc","action":{"type":"exec.command","target":"ls -la /tmp","detail":"Listed directory contents"},"context":{"goal":"Inspect temporary files","trigger":"user_request"},"outcome":{"status":"success","durationMs":42},"risk":{"score":3,"labels":["execution"],"autoFlagged":false}}
```

## Logging via CLI

```bash
# The agent logs by running:
agenttrust log  # to view entries

# Entries are appended programmatically via the AgentTrust library
```

## File Location

Ledger files are stored at `<workspace>/.agenttrust/ledger/YYYY-MM-DD.agenttrust.jsonl`.
Files rotate daily (UTC).

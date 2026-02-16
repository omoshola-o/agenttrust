# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in AgentTrust, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email: **omoshola.o@gmail.com** with the subject line `[AgentTrust Security]`.

We will:
- Acknowledge your report within 48 hours
- Provide a timeline for a fix within 7 days
- Credit you in the release notes (unless you prefer anonymity)

## Scope

AgentTrust is an audit and observation tool. By design, it does **not**:

- Control or modify agent behavior
- Store credentials, secrets, or API keys
- Make outbound network requests
- Execute commands on behalf of the agent
- Send data to any external service

### What IS in scope

Security concerns most relevant to AgentTrust:

| Concern | Description |
|---|---|
| **Ledger tampering** | Bypassing hash chain integrity checks |
| **Hash collision** | Crafting entries that pass verification despite modification |
| **Information leakage** | Sensitive data exposed through log entries or CLI output |
| **File permissions** | Improper permissions on ledger or config files |
| **Path traversal** | Reading/writing files outside the workspace directory |
| **Witness evasion** | Performing actions that bypass the witness observer |

### What is NOT in scope

- Vulnerabilities in Node.js, npm, or system dependencies (report those upstream)
- Issues that require physical access to the machine
- Social engineering attacks against users

## Supported Versions

| Version | Supported |
|---|---|
| 0.x (current) | Yes |

## Security Design

AgentTrust follows these security principles:

1. **Local-only** — All data stays on the user's machine. No cloud, no telemetry.
2. **Append-only** — Ledger files are designed to be written but never modified.
3. **Hash-chained** — SHA-256 chains make tampering detectable.
4. **Least privilege** — AgentTrust only reads/writes within its own data directory.
5. **Non-blocking** — Storage errors are swallowed. AgentTrust never crashes the agent.

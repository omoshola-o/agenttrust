# Changelog

All notable changes to AgentTrust will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-02-16

### Added

#### Core Ledger
- Append-only, SHA-256 hash-chained JSONL log engine
- 24 canonical action types across 12 categories
- ULID-based entry IDs (time-sortable, universally unique)
- Daily file rotation (`YYYY-MM-DD.agenttrust.jsonl`)
- Risk scoring (0–10) with 7 risk label categories
- Full integrity verification with tamper detection

#### Claims & Consistency
- Claims ledger for declaring intent before acting
- Consistency engine matching claims to executions
- Consistency scoring (0–100) with penalty breakdown
- Divergence detection (target mismatch, unfulfilled claims, unclaimed executions)

#### Witness System
- Independent system observer daemon
- Filesystem monitor (create, modify, delete events)
- Network connection monitor (open/close with process attribution)
- Process monitor (spawn/exit with command-line capture)
- Infrastructure allowlist filtering (OS noise reduction)
- System process filtering (background noise reduction)

#### Correlation Engine
- Cross-check agent logs against witness observations
- File, network, and process correlators
- Proportional confidence scoring with calibrated weights
- Combined trust score from integrity + consistency + witness

#### Evidence & Proof
- Evidence receipt generation for file, network, message, and process actions
- Cryptographic receipt chaining

#### Risk Analysis
- Configurable rule engine with 14 built-in rules
- Rule categories: credential, escalation, financial, communication, destructive, data exfiltration, frequency, scope drift
- Rule presets: default, strict, minimal
- Custom rule support via YAML configuration

#### Replay & Investigation
- Causal chain tracing from any action
- Blame analysis (who triggered what)
- Human-readable narrative generation

#### Digest & Reports
- Daily and weekly markdown summary generation
- Activity statistics, risk highlights, and trend analysis

#### CLI
- `agenttrust status` — Dashboard with trust score, activity, and health
- `agenttrust trust` — Combined trust score from all three engines
- `agenttrust log` — View recent actions with filtering
- `agenttrust claim` — Declare intent before acting
- `agenttrust verify` — Hash chain integrity verification
- `agenttrust consistency` — Claims vs. executions analysis
- `agenttrust correlate` — Cross-check with witness observations
- `agenttrust audit` — Risk detection rule scanning
- `agenttrust replay` — Causal chain tracing
- `agenttrust watch` — Live-stream actions
- `agenttrust witness` — Manage independent system observer
- `agenttrust digest` — Generate summary reports
- `agenttrust rules` — Manage risk detection rules
- `agenttrust init` — Workspace initialization
- `agenttrust doctor` — Health checks
- `--json` flag on all commands for scripting and CI

#### OpenClaw Integration
- SKILL.md with YAML frontmatter for skill discovery
- Reference docs for action types, risk levels, and log format
- Quick audit script for agent use

#### Infrastructure
- One-line curl installer (`scripts/install.sh`)
- GitHub Actions CI (lint, typecheck, test, build)
- GitHub Actions release workflow (npm publish on tag)
- 1,000+ unit tests across 58 test files

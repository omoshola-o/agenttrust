# Contributing to AgentTrust

Thank you for your interest in contributing to AgentTrust! This document covers the development setup, coding standards, and contribution workflow.

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) >= 22
- [pnpm](https://pnpm.io/) >= 9

### Getting Started

```bash
git clone https://github.com/omoshola-o/agenttrust.git
cd agenttrust
pnpm install
pnpm test
```

### Available Scripts

| Command | Description |
|---|---|
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm test` | Run all tests |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm test:coverage` | Run tests with coverage report |
| `pnpm lint` | Lint with oxlint |
| `pnpm typecheck` | Type check without emitting |
| `pnpm format` | Format with Prettier |
| `pnpm format:check` | Check formatting without writing |

## Code Standards

### TypeScript

- **Strict mode** — No `any` types unless absolutely necessary.
- **ES Modules** — The project uses `"type": "module"`. All imports must use `.js` extensions.
- **Async/await** — No callbacks. Use async file operations.
- **Named exports** — No default exports.
- **Const over let** — Prefer immutability.

### Testing

- **Framework**: Vitest
- **Requirement**: Every PR must include tests for new functionality.
- **Coverage target**: >90% for `src/`.
- **Pattern**: Use `beforeEach`/`afterEach` with temp directories for filesystem tests.

```bash
# Run a specific test file
pnpm exec vitest run test/unit/ledger.test.ts

# Run tests matching a pattern
pnpm exec vitest run -t "hash chain"
```

### Linting & Formatting

- **Linter**: oxlint (`.oxlintrc.json`)
- **Formatter**: Prettier (`.prettierrc`)

Both run in CI. Check before pushing:

```bash
pnpm lint && pnpm format:check
```

## Contribution Workflow

1. **Fork** the repository.
2. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
3. **Make your changes** with tests.
4. **Verify locally**:
   ```bash
   pnpm typecheck && pnpm lint && pnpm test && pnpm build
   ```
5. **Commit** using conventional commit messages.
6. **Open a pull request** against `main`.

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add hash chain verification
fix: handle empty ledger file on first read
test: add tamper detection tests
docs: update risk level reference
chore: update dependencies
refactor: extract duration parser to shared utility
```

### Pull Request Guidelines

- **One concern per PR** — Keep changes focused.
- **Include tests** — New functionality needs test coverage.
- **Update docs** — If your change affects the CLI or public API, update the relevant docs.
- **Describe the change** — Explain what and why in the PR description.

## Project Architecture

```
src/
├── ledger/         # Core: append-only hash-chained JSONL engine
├── schema/         # Types: action taxonomy, risk labels, outcomes
├── query/          # Query: filtering and timeline reconstruction
├── analyzer/       # Rules: risk detection engine
├── consistency/    # Verify: claims vs. executions matching
├── correlation/    # Verify: cross-check with witness data
├── proof/          # Evidence: receipt generation
├── witness/        # Observer: filesystem, network, process monitors
├── replay/         # Investigate: causal chain tracing
├── digest/         # Reports: daily/weekly summary generation
└── watch/          # Live: real-time streaming renderer

cli/                # CLI tool (Commander.js)
skill/              # OpenClaw skill definition
configs/            # Risk rule presets
test/               # Unit tests (Vitest)
```

### Key Design Rule

AgentTrust is **alongside, not inside**. It observes the agent — it never modifies, blocks, or controls agent behavior. Any contribution that breaks this principle will not be accepted.

## Code of Conduct

Be respectful. Be constructive. We're building trust infrastructure — let's start with trust in each other.

## Questions?

Open a [GitHub Discussion](https://github.com/omoshola-o/agenttrust/discussions) or file an issue.

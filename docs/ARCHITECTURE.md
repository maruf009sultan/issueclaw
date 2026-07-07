# Architecture

## Overview

IssueClaw is a serverless AI assistant that runs entirely in GitHub Actions. It has no external dependencies beyond the GitHub infrastructure and your LLM provider of choice.

## Components

### 1. Lifecycle Layer (`src/lifecycle/`)

The entry points invoked by GitHub Actions:

- **`preinstall.ts`** — Runs before the agent. Adds 👀 reaction, validates permissions.
- **`main.ts`** — Runs the agent, commits state, posts comment, cleans up reaction.

### 2. Configuration Layer (`src/config.ts`)

Zod-validated configuration system. Loads from:
- Environment variables (`ISSUECLAW_*`)
- Config file (`issueclaw.config.json`)
- Legacy file (`.pi/settings.json`)
- Built-in defaults

### 3. Provider Layer (`src/providers/`)

LLM provider abstraction. Each provider knows how to:
- Build CLI args for pi
- Set environment variables for authentication
- Validate its own configuration

Supported: anthropic, openai, openrouter, ollama, custom (any OpenAI-compatible).

### 4. GitHub Layer (`src/github/`)

- **`client.ts`** — Wraps `gh` CLI with retry logic and typed responses.
- **`events.ts`** — Parses GitHub webhook payloads into a normalized `ParsedEvent`.

### 5. Agent Layer (`src/agent/`)

- **`runner.ts`** — Orchestrates pi execution with provider fallback chain.
- Builds prompts that inject memory, personality, and user context.

### 6. Memory Layer (`src/memory/`)

Persistent state management:
- `memory.md` — Append-only fact log
- `personality.md` — Mutable agent identity
- `user.md` — User profile
- `audit.log` — JSON audit trail
- `issues/<n>.json` — Issue → session mappings
- `sessions/*.jsonl` — Conversation transcripts

All writes are atomic (write to temp file, rename).

### 7. Utils Layer (`src/utils/`)

- **`log.ts`** — Structured logger with levels, JSON output, colorization.
- **`retry.ts`** — Exponential backoff with jitter, retryable error detection.
- **`git.ts`** — Git operations with retry on network errors.
- **`fs.ts`** — Atomic file writes, safe reads, JSON helpers.

## Data Flow

```
GitHub Webhook
       │
       ▼
┌─────────────────────┐
│  agent.yml workflow │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   preinstall.ts     │  ← parseEvent, shouldProcessEvent, addReaction
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│      main.ts        │
│                     │
│  1. MemoryStore.init│  ← Seeds memory.md, personality.md, user.md
│  2. GitClient.config│  ← Sets git identity
│  3. runAgent        │  ← Builds prompt, runs pi with fallback
│  4. MemoryStore.save│  ← Saves session mapping
│  5. GitClient.commit│  ← Commits state changes
│  6. GitClient.push  │  ← Pushes to remote (with retry)
│  7. GithubClient.comment│ ← Posts comment
│  8. (finally) cleanup│ ← Removes 👀 reaction
└─────────────────────┘
```

## Concurrency Model

The workflow uses `concurrency` groups to prevent overlapping runs on the same issue:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.event.issue.number }}
  cancel-in-progress: false
```

This ensures that if multiple comments arrive on the same issue, they're processed sequentially, not in parallel. State commits won't conflict.

## Error Handling

### Retry Strategy

- **Network operations** (git push, gh API): 3 retries with exponential backoff
- **Agent execution**: Provider fallback chain (try primary, then alternates)
- **Reaction cleanup**: Best-effort in `finally` block

### Failure Modes

1. **All providers fail** → Returns error message as comment
2. **Git push fails** → Retries with rebase up to 3 times
3. **Comment post fails** → Logged but doesn't fail the workflow
4. **Preinstall fails** → Workflow exits with code 78 (config error)

## State Management

All state lives in `state/` directory, committed to git:

```
state/
├── memory.md           # Append-only memory log
├── personality.md      # Mutable identity
├── user.md             # User profile
├── audit.log           # JSON audit trail
├── issues/
│   └── 1.json          # Issue #1 → session mapping
└── sessions/
    └── 2026-01-01T...jsonl  # Conversation transcripts
```

### Atomic Writes

All file writes use atomic write (write to `.tmp`, rename). This prevents:
- Partial writes from being observed
- Race conditions between concurrent readers
- Corruption from killed processes

## Testing Strategy

### Unit Tests

Test individual modules in isolation:
- `config.test.ts` — Config schema, loading, env var resolution
- `providers.test.ts` — Each provider's args/env building
- `memory.test.ts` — Memory store CRUD, atomic writes
- `github.test.ts` — Event parsing, permission checks
- `agent.test.ts` — Prompt building, message extraction
- `utils.test.ts` — Retry, timeout, error helpers

### Integration Tests

Test the full lifecycle with mocked external dependencies:
- `lifecycle.test.ts` — End-to-end with `executable: false` (no real pi invocation)

### Manual Testing

```bash
# Diagnose environment
bun run src/cli.ts doctor

# Generate test event
bun run src/cli.ts test event issues.opened

# Run lifecycle against test event
bun run src/cli.ts test lifecycle

# Show prompt that would be sent
bun run src/cli.ts test prompt
```

## Security Model

### Authentication

- Only `OWNER`, `MEMBER`, `COLLABORATOR` author associations can trigger
- `github-actions[bot]` and other bots are rejected
- GitHub Actions auto-provisions `GITHUB_TOKEN` with repo-scoped permissions

### Permissions

```yaml
permissions:
  contents: write    # Commit & push state
  issues: write      # Comment, react
  actions: write     # Read workflow info
  pull-requests: write  # If PR support enabled
```

### Network

- Agent only has access to: repo (via git), LLM API (via HTTPS)
- No other outbound network by default
- For sensitive data: **make repo private**

## Performance

- **Session artifacts**: Uploaded to GitHub Actions, retained 30 days
- **Bun cache**: Cached across workflow runs
- **Concurrent runs**: Per-issue serialization via concurrency groups
- **Session compaction**: Scheduled daily, oversized sessions flagged

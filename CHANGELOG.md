# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-07-07 — THE REBRAND

### 🦃 IssueClaw is born!

Complete rebrand from "gitclaw-enterprise" to **IssueClaw**. New name, same powerful engine.

### Changed
- **Project renamed**: gitclaw-enterprise → IssueClaw
- **All identifiers renamed**:
  - `gitclaw` → `issueclaw` (everywhere — code, config, CLI, logs)
  - `GITCLAW_*` env vars → `ISSUECLAW_*` env vars
  - `gitclaw.config.json` → `issueclaw.config.json`
  - `gitclaw[bot]` → `issueclaw[bot]` (git identity)
  - `gitclaw-session-*` → `issueclaw-session-*` (artifact names)
  - `gitclaw-agent` → `issueclaw-agent` (concurrency group)
- **CLI command**: `gitclaw` → `issueclaw`
- **Log component**: `gitclaw` → `issueclaw`
- **GitHub repo**: https://github.com/maruf009sultan/issueclaw
- **Package name**: `issueclaw` (was `gitclaw-enterprise`)
- **Version**: 2.0.0 (major version bump for rebrand)

### Added
- **New minimal community-focused README** — quick start, story, marketing
- **Original technical README preserved** — stitched at the bottom in a collapsible section
- **Best of both worlds**: catchy top + complete docs bottom

### No Breaking Feature Changes
- All 122 tests still pass
- All 29 live tests still pass
- Lint clean, typecheck clean
- Same two modes (chat + agent)
- Same 8 providers
- Same fallback chain
- Same everything — just a new name

## [1.7.0] - 2026-07-07

### Added
- **Gemini provider** (first-class support) — RECOMMENDED DEFAULT
  - 1,000,000 TPM free tier (83x higher than Groq's 12K TPM)
  - Perfect for AI agents with large system prompts + tool definitions (~120K tokens)
  - Models: gemini-2.0-flash, gemini-2.5-flash, gemini-1.5-flash, gemini-2.5-pro
  - Get free key: https://aistudio.google.com/app/apikey
- **Cerebras provider** (first-class support)
  - 60,000 TPM free tier, ultra-fast (1000+ tokens/sec)
  - Models: llama-3.3-70b, llama-3.1-8b, gpt-oss-120b
  - Get free key: https://inference.cerebras.ai/
- **OpenRouter free models** — added `nvidia/nemotron-3-nano-30b-a3b:free` as reliably-available free model
- `GEMINI_API_KEY` and `CEREBRAS_API_KEY` added to GitHub Actions workflow

### Changed
- **Default provider changed from Groq to Gemini** — solves the TPM limit issue
- Provider fallback chain priority: Gemini → Cerebras → OpenRouter → Groq → Anthropic → OpenAI
- `autoGenerateConfig()` now prioritizes Gemini first (1M TPM), then Cerebras, then OpenRouter, then Groq
- README updated with Gemini-first quick start guide
- Provider comparison table now includes TPM limits

### Fixed
- **413 TPM error** — pi's system prompt + tools = ~120K tokens, which blew past Groq's 12K TPM.
  Gemini's 1M TPM handles this easily. Fallback chain ensures at least one provider works.

## [1.3.0] - 2026-07-07

### Added
- **Groq provider** (first-class support) — free tier, recommended default
  - Native pi integration via `--provider groq` (reads `GROQ_API_KEY`, uses correct base URL)
  - Models: llama-3.3-70b-versatile, llama-3.1-8b-instant, mixtral-8x7b-32768, gemma2-9b-it
  - Free API key at https://console.groq.com/keys
- **Auto-config generation** (`issueclaw config auto`)
  - Auto-detects GROQ_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY
  - Builds config with correct providers + fallback chain
  - Defaults to Groq (free tier) if no keys found
  - Runs automatically on first run if no config exists
- **Mock LLM server** (`scripts/mock-llm.ts`) for testing without real API keys
- **Live test harness** (`scripts/live-test.ts`) — full end-to-end pipeline test
- **Pi extensions support** (`.pi/extensions/`) for custom provider registration
- `GROQ_API_KEY` added to GitHub Actions workflow secrets

### Fixed (critical bugs found via live testing)
- **`bunx pi` resolved to wrong npm package** (pi-decimals instead of pi-coding-agent)
  - Fixed by resolving to local `node_modules/.bin/pi` binary, falling back to `bunx @earendil-works/pi-coding-agent`
- **Pi hung waiting for trust confirmation** in non-interactive mode
  - Fixed by adding `--approve` flag to bypass interactive trust prompt
- **`OPENAI_BASE_URL` env var not respected by pi** (pi uses hardcoded provider URLs)
  - Fixed by using pi extensions to register custom providers with custom base URLs
  - Groq now uses pi's native `--provider groq` which has the correct base URL built-in
- **Leftover `try` block** in invokePi caused syntax error
  - Removed orphaned try/finally after refactoring
- **Dry-run mode git commit assertion** was wrong (dry-run correctly skips commits)
  - Fixed test to verify dry-run skips commits

### Changed
- Default provider changed from Anthropic to **Groq** (free tier)
- Default config (`issueclaw.config.json`) now uses Groq as primary, Anthropic + OpenAI as fallbacks
- README updated with Groq-first quick start guide
- `config init` command now aliases to `config auto` (auto-detection)

## [1.0.0] - 2026-07-06

### Added — Enterprise Upgrade

#### Multi-Provider LLM Support
- **Anthropic provider** with Claude models (claude-opus-4-6, claude-sonnet-4-5, etc.)
- **OpenAI provider** with GPT models (gpt-4o, gpt-4o-mini, o1, o3, etc.)
- **OpenRouter provider** routing to any model
- **Ollama provider** for local LLMs (llama3.1, qwen2.5, deepseek-r1, etc.)
- **Custom provider** for any OpenAI-compatible endpoint (Azure, Together, Groq, vLLM, LM Studio)
- **Provider fallback chain** — automatic failover to backup providers
- **Per-provider config**: API key, base URL, custom headers, thinking level, temperature, max tokens

#### Persistent Memory System
- `state/memory.md` — append-only memory log with timestamped entries
- `state/personality.md` — mutable agent identity (name, vibe, emoji, hatch date)
- `state/user.md` — user profile (name, preferences, communication style)
- `state/audit.log` — JSON audit trail of all agent runs
- `state/issues/<n>.json` — issue-to-session mappings
- **Atomic writes** (write to temp file, rename) to prevent corruption
- **Auto-seeding** of default files on first run

#### Configuration System
- **Zod-validated config schema** for runtime type safety
- **`issueclaw.config.json`** as primary config file
- **Environment variable overrides** (`ISSUECLAW_PROVIDER`, `ISSUECLAW_MODEL`, `ISSUECLAW_BASE_URL`, etc.)
- **Legacy compatibility** with `.pi/settings.json`
- **Config validation command** (`issueclaw config validate`)

#### GitHub Integration
- **Concurrency control** — prevents overlapping runs on same issue (race condition safe)
- **Pull request support** — agent can respond to PR opens
- **Permission checks** — only OWNER/MEMBER/COLLABORATOR can trigger
- **Bot rejection** — github-actions[bot] and other bots ignored
- **Retry with backoff** — all gh API calls retry on rate limit / 5xx
- **Session artifacts** — full JSONL uploaded to Actions, retained 30 days

#### CLI Tool
- `issueclaw run` — run the agent lifecycle
- `issueclaw run --dry-run` — no commits, no comments
- `issueclaw run --offline` — mock pi invocation for testing
- `issueclaw config show|validate|init` — config management
- `issueclaw memory show|search|append|clear` — memory management
- `issueclaw personality show|set|reset` — personality management
- `issueclaw user show|set` — user profile management
- `issueclaw test event|lifecycle|prompt` — testing utilities
- `issueclaw doctor` — diagnose environment & config

#### Reliability & Observability
- **Structured logging** with levels (trace/debug/info/warn/error/fatal)
- **JSON log output** mode for log aggregation
- **Component-based logging** with child loggers
- **Exponential backoff** with jitter for retries
- **Timeout handling** for agent runs (default 15 min)
- **30-minute job timeout** in workflow
- **Error recovery** — provider fallback, git push retry, reaction cleanup in `finally`

#### Testing
- **Vitest test framework** with 80%+ coverage of core modules
- **Unit tests** for config, providers, memory, github, agent, utils
- **Integration tests** for full lifecycle with mock mode
- **CI workflow** — lint, typecheck, test on every PR
- **Coverage reports** uploaded as artifacts

#### Developer Experience
- **TypeScript** with strict mode
- **Biome** for linting and formatting
- **Docker support** — `Dockerfile` + `docker-compose.yml`
- **Comprehensive docs** — Configuration, Providers, Architecture, Deployment, Troubleshooting
- **Issue templates** — Hatch, Task, Bug
- **Scheduled maintenance** — daily cleanup of orphaned sessions

#### Pi-mono Upgrade
- Upgraded from `@mariozechner/pi-coding-agent@^0.52.5` to `@earendil-works/pi-coding-agent@^0.80.3`
- Pi-mono was renamed and significantly upgraded since original issueclaw

### Changed
- Package name: `issueclaw` → `issueclaw`
- Lifecycle files: `lifecycle/main.ts` → `src/lifecycle/main.ts`
- State directory: implicit → explicit `state/` with documented files
- Default behavior: hardcoded Anthropic → configurable multi-provider with fallback

### Fixed (vs original issueclaw)
- **Race condition**: Session detection via `ls -t | head -1` replaced with explicit mapping
- **No error handling**: All operations now have try/catch with structured logging
- **No retry**: Network operations retry with exponential backoff
- **Hardcoded provider**: Now configurable via `issueclaw.config.json`
- **No tests**: Comprehensive unit + integration test suite added
- **No CLI**: Full CLI for local testing and management
- **No audit trail**: `state/audit.log` tracks every action
- **Fragile session resume**: Now uses explicit issue→session mapping files
- **Comment truncation silent**: Now adds visible truncation notice with link to session
- **Git push retry without backoff**: Now uses exponential backoff with jitter
- **Reaction state in /tmp only**: Still uses /tmp but with proper cleanup in `finally`
- **No concurrency control**: Workflow now uses concurrency groups per issue
- **No PR support**: Now supports `pull_request.opened` events
- **No structured logging**: Now has leveled structured logging with JSON option
- **No config validation**: Zod schema validates config at load time
- **No Docker**: Now has Dockerfile + docker-compose for local dev
- **No maintenance**: Scheduled workflow for cleanup
- **No docs**: Comprehensive docs added

### Security
- Permission checks enforced in both workflow `if:` and `shouldProcessEvent()`
- Bot rejection prevents infinite loops
- Concurrency groups prevent race conditions in state commits
- Atomic file writes prevent corruption
- No secrets logged (API keys redacted in logs)

## [0.1.0] - 2026-02-06

### Original issueclaw by SawyerHood
- Initial release
- Basic issue → agent → comment flow
- Anthropic-only via `ANTHROPIC_API_KEY`
- Session resume via `ls -t` (fragile)
- Eyes reaction while processing
- Git-backed state in `state/issues/` and `state/sessions/`
- Hatch flow via `hatch` label
- Built on pi-mono v0.52.5

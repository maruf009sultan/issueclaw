# Configuration Guide

IssueClaw is configured via `issueclaw.config.json` (or env vars for overrides).

## Auto-Config (Recommended)

Run this to auto-generate a working config based on which API keys you have:

```bash
bun run src/cli.ts config auto
```

This detects `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` in your environment and builds a config with the right providers + fallback chain. If no keys are found, it defaults to Groq (free tier) with a placeholder.

**On first run** (in GitHub Actions or locally), if no config file exists, one is auto-generated automatically.

## Config Sources (Priority Order)

1. **Environment variables** (`ISSUECLAW_*`) — highest priority
2. **Config file** (`issueclaw.config.json` or `ISSUECLAW_CONFIG_PATH`)
3. **Legacy** (`.pi/settings.json`) — backward compatibility
4. **Auto-generated** (on first run if no config exists)
5. **Built-in defaults**

## Full Schema

```json
{
  "version": 1,
  "providers": [
    {
      "type": "anthropic" | "openai" | "openrouter" | "ollama" | "groq" | "custom",
      "model": "string",
      "apiKey": "string or ${ENV_VAR}",
      "baseUrl": "https://...",
      "headers": { "X-Custom": "value" },
      "thinking": "off|minimal|low|medium|high|xhigh",
      "maxTokens": 8192,
      "temperature": 0.7,
      "default": true
    }
  ],
  "memory": {
    "stateDir": "./state",
    "memoryFile": "memory.md",
    "personalityFile": "personality.md",
    "userFile": "user.md",
    "auditFile": "audit.log",
    "maxSessionSize": 10485760,
    "autoCompact": true
  },
  "github": {
    "repo": "owner/name",
    "onIssueOpened": true,
    "onIssueComment": true,
    "onPullRequest": false,
    "allowedAssociations": ["OWNER", "MEMBER", "COLLABORATOR"],
    "hatchLabel": "hatch",
    "reactionWhileProcessing": true,
    "maxCommentLength": 60000,
    "concurrencyGroup": "issueclaw-agent"
  },
  "agent": {
    "tools": ["read", "bash", "edit"],
    "excludeTools": [],
    "systemPrompt": "optional override",
    "appendSystemPrompt": ".pi/APPEND_SYSTEM.md",
    "agentsFile": "AGENTS.md",
    "piCommand": "bunx pi",
    "timeoutMs": 900000,
    "skills": true,
    "extensions": true
  },
  "runtime": {
    "dryRun": false,
    "logLevel": "info",
    "logJson": false,
    "offline": false
  }
}
```

## Environment Variable Overrides

| Variable | Description |
|----------|-------------|
| `ISSUECLAW_PROVIDER` | Override provider type |
| `ISSUECLAW_MODEL` | Override model |
| `ISSUECLAW_BASE_URL` | Override base URL (for custom providers) |
| `ISSUECLAW_THINKING` | Override thinking level |
| `ISSUECLAW_LOG_LEVEL` | Log level: `trace`/`debug`/`info`/`warn`/`error`/`fatal` |
| `ISSUECLAW_LOG_JSON` | `true` for JSON log output |
| `ISSUECLAW_DRY_RUN` | `true` to skip commits/comments |
| `ISSUECLAW_CONFIG_PATH` | Custom config file path |

## Examples

### Groq (recommended — free tier)

```json
{
  "version": 1,
  "providers": [
    {
      "type": "groq",
      "model": "llama-3.3-70b-versatile",
      "apiKey": "${GROQ_API_KEY}",
      "default": true
    }
  ]
}
```

Get a free API key at https://console.groq.com/keys.

### Anthropic (default)

```json
{
  "version": 1,
  "providers": [
    {
      "type": "anthropic",
      "model": "claude-opus-4-6",
      "apiKey": "${ANTHROPIC_API_KEY}",
      "thinking": "high",
      "default": true
    }
  ]
}
```

### OpenAI with Anthropic fallback

```json
{
  "version": 1,
  "providers": [
    {
      "type": "openai",
      "model": "gpt-4o",
      "apiKey": "${OPENAI_API_KEY}",
      "default": true
    },
    {
      "type": "anthropic",
      "model": "claude-sonnet-4-5",
      "apiKey": "${ANTHROPIC_API_KEY}"
    }
  ]
}
```

### Local Ollama

```json
{
  "version": 1,
  "providers": [
    {
      "type": "ollama",
      "model": "llama3.1:70b",
      "baseUrl": "http://localhost:11434",
      "default": true
    }
  ]
}
```

### Custom OpenAI-compatible (Azure, Together, Groq, vLLM)

```json
{
  "version": 1,
  "providers": [
    {
      "type": "custom",
      "model": "my-model",
      "baseUrl": "https://api.together.xyz/v1",
      "apiKey": "${TOGETHER_API_KEY}",
      "headers": {
        "X-Custom-Header": "value"
      },
      "default": true
    }
  ]
}
```

### OpenRouter (any model)

```json
{
  "version": 1,
  "providers": [
    {
      "type": "openrouter",
      "model": "anthropic/claude-opus-4",
      "apiKey": "${OPENROUTER_API_KEY}",
      "default": true
    }
  ]
}
```

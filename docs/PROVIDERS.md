# Providers Guide

IssueClaw supports any OpenAI-compatible LLM provider via a unified provider abstraction.

## Supported Providers

| Provider | Type | API Key Env | Free Tier? | Notes |
|----------|------|-------------|------------|-------|
| **Groq** | `groq` | `GROQ_API_KEY` | ✅ Yes | Recommended default. Ultra-fast inference. |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` | ❌ | Claude models |
| OpenAI | `openai` | `OPENAI_API_KEY` | ❌ | GPT-4o, o1, o3, etc. |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | ❌ | Routes to any provider |
| Ollama | `ollama` | (none) | ✅ Self-hosted | Local LLMs |
| Custom | `custom` | `OPENAI_API_KEY` | varies | Any OpenAI-compatible endpoint |

## Groq (Recommended — Free Tier)

Groq offers a generous free tier with ultra-fast inference (500x faster than typical APIs). Perfect for getting started without cost.

**Get a free API key**: https://console.groq.com/keys

**Default config**:

```json
{
  "type": "groq",
  "model": "llama-3.3-70b-versatile",
  "apiKey": "${GROQ_API_KEY}",
  "default": true
}
```

**Available models**:
- `llama-3.3-70b-versatile` (default, 70B params, 131K context)
- `llama-3.1-8b-instant` (fast, 8B params, 131K context)
- `llama3-70b-8192` (70B, 8K context)
- `llama3-8b-8192` (8B, 8K context)
- `mixtral-8x7b-32768` (Mixture of Experts, 32K context)
- `gemma2-9b-it` (Google's Gemma 2, 9B params)

**Free tier limits** (as of 2026): 30 requests/min, 14,400 requests/day. Plenty for personal use.

Pi has **native Groq support** — it uses `--provider groq` which reads `GROQ_API_KEY` and uses the correct base URL automatically.

## Provider Fallback Chain

Providers are tried in order. The first one marked `default: true` is the primary; others are fallbacks.

```json
{
  "providers": [
    {
      "type": "anthropic",
      "model": "claude-opus-4-6",
      "apiKey": "${ANTHROPIC_API_KEY}",
      "default": true
    },
    {
      "type": "openai",
      "model": "gpt-4o",
      "apiKey": "${OPENAI_API_KEY}"
    },
    {
      "type": "openrouter",
      "model": "anthropic/claude-opus-4",
      "apiKey": "${OPENROUTER_API_KEY}"
    }
  ]
}
```

If Anthropic fails, OpenAI is tried. If OpenAI fails, OpenRouter is tried. If all fail, the agent returns an error response.

## Custom OpenAI-Compatible Endpoints

Any OpenAI-compatible API can be used via the `custom` provider type:

### Together AI

```json
{
  "type": "custom",
  "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  "baseUrl": "https://api.together.xyz/v1",
  "apiKey": "${TOGETHER_API_KEY}"
}
```

### Groq

```json
{
  "type": "custom",
  "model": "llama-3.3-70b-versatile",
  "baseUrl": "https://api.groq.com/openai/v1",
  "apiKey": "${GROQ_API_KEY}"
}
```

### Azure OpenAI

```json
{
  "type": "custom",
  "model": "gpt-4o",
  "baseUrl": "https://your-resource.openai.azure.com/openai/deployments/your-deployment",
  "apiKey": "${AZURE_OPENAI_API_KEY}",
  "headers": {
    "api-key": "${AZURE_OPENAI_API_KEY}"
  }
}
```

### vLLM (local)

```json
{
  "type": "custom",
  "model": "meta-llama/Meta-Llama-3.1-70B",
  "baseUrl": "http://localhost:8000/v1",
  "apiKey": "dummy"
}
```

### LM Studio

```json
{
  "type": "custom",
  "model": "local-model",
  "baseUrl": "http://localhost:1234/v1",
  "apiKey": "lm-studio"
}
```

## Thinking Levels

For reasoning models (Claude, o1, etc.):

| Level | Description |
|-------|-------------|
| `off` | No extended thinking |
| `minimal` | Quick check |
| `low` | Light reasoning |
| `medium` | Balanced |
| `high` | Deep reasoning (default) |
| `xhigh` | Maximum reasoning |

## Adding Custom Providers

You can register custom providers at runtime:

```typescript
import { registerProvider } from "./src/providers/index.ts";

registerProvider({
  type: "my-provider",
  buildArgs(config) {
    return {
      args: ["--provider", "my-provider", "--model", config.model],
      env: { MY_API_KEY: config.apiKey },
    };
  },
  validate(config) {
    return config.apiKey ? null : "Missing API key";
  },
});
```

## Validation

The CLI can validate your provider config:

```bash
bun run src/cli.ts config validate
```

Output:

```
✓ Configuration is valid
```

Or:

```
✗ Configuration has errors:
  - Provider anthropic: Anthropic provider requires ANTHROPIC_API_KEY
```

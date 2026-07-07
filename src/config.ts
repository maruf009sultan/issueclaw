/**
 * Configuration system with schema validation.
 *
 * Configuration is loaded from (in priority order):
 * 1. Environment variables (ISSUECLAW_*)
 * 2. Config file (issueclaw.config.json or ISSUECLAW_CONFIG_PATH)
 * 3. .pi/settings.json (legacy compatibility)
 * 4. Built-in defaults
 *
 * All settings are validated via Zod schemas for runtime safety.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { log } from "./utils/log.ts";

// ============================================================================
// Provider Configuration
// ============================================================================

export const ProviderSchema = z.object({
  /** Provider type. "custom" allows any OpenAI-compatible endpoint. */
  type: z.enum([
    "anthropic",
    "openai",
    "openrouter",
    "ollama",
    "groq",
    "gemini",
    "cerebras",
    "custom",
  ]),
  /** Model identifier (e.g. "gpt-4o", "claude-opus-4-6", "llama3.1:70b"). */
  model: z.string().min(1),
  /** API key. Can be a literal value or ${ENV_VAR} reference. */
  apiKey: z.string().optional(),
  /** Base URL for OpenAI-compatible APIs. Required for "custom" type. */
  baseUrl: z.string().url().optional(),
  /** Custom headers to send with API requests. */
  headers: z.record(z.string()).optional(),
  /** Thinking level for reasoning models. */
  thinking: z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]).optional(),
  /** Max output tokens. */
  maxTokens: z.number().int().positive().optional(),
  /** Temperature. */
  temperature: z.number().min(0).max(2).optional(),
  /** Whether this is the default provider. */
  default: z.boolean().optional(),
});
export type ProviderConfig = z.infer<typeof ProviderSchema>;

// ============================================================================
// Memory Configuration
// ============================================================================

export const MemoryConfigSchema = z.object({
  /** Directory for state files. */
  stateDir: z.string().default("./state"),
  /** Memory log file (append-only). */
  memoryFile: z.string().default("memory.md"),
  /** Personality file (mutable). */
  personalityFile: z.string().default("personality.md"),
  /** User profile file. */
  userFile: z.string().default("user.md"),
  /** Audit log file. */
  auditFile: z.string().default("audit.log"),
  /** Maximum session file size in bytes before compaction. */
  maxSessionSize: z
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),
  /** Whether to auto-compact long sessions. */
  autoCompact: z.boolean().default(true),
});
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

// ============================================================================
// GitHub Configuration
// ============================================================================

export const GithubConfigSchema = z.object({
  /** Repository in owner/name format. Auto-detected from GITHUB_REPOSITORY. */
  repo: z.string().optional(),
  /** Trigger on issue open. */
  onIssueOpened: z.boolean().default(true),
  /** Trigger on issue comment. */
  onIssueComment: z.boolean().default(true),
  /** Trigger on PR open. */
  onPullRequest: z.boolean().default(false),
  /** Allowed author associations. */
  allowedAssociations: z.array(z.string()).default(["OWNER", "MEMBER", "COLLABORATOR"]),
  /** Label that triggers bootstrap/hatch flow. */
  hatchLabel: z.string().default("hatch"),
  /** Whether to add eyes reaction while processing. */
  reactionWhileProcessing: z.boolean().default(true),
  /** Max comment length (GitHub limit is 65536). */
  maxCommentLength: z.number().int().positive().max(65536).default(60000),
  /** Concurrency group to prevent overlapping runs on same issue. */
  concurrencyGroup: z.string().default("issueclaw-agent"),
});
export type GithubConfig = z.infer<typeof GithubConfigSchema>;

// ============================================================================
// Agent Configuration
// ============================================================================

export const AgentConfigSchema = z.object({
  /** Tools to enable (passed to pi). */
  tools: z.array(z.string()).optional(),
  /** Tools to exclude. */
  excludeTools: z.array(z.string()).optional(),
  /** System prompt override. */
  systemPrompt: z.string().optional(),
  /** Append system prompt path. */
  appendSystemPrompt: z.string().default(".pi/APPEND_SYSTEM.md"),
  /** Agent instructions file. */
  agentsFile: z.string().default("AGENTS.md"),
  /** Pi binary command. */
  piCommand: z.string().default("bunx pi"),
  /** Max agent runtime in ms. */
  timeoutMs: z
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  /** Whether to enable skills. */
  skills: z.boolean().default(true),
  /** Whether to enable extensions. */
  extensions: z.boolean().default(true),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// ============================================================================
// Runtime Configuration
// ============================================================================

export const RuntimeConfigSchema = z.object({
  /** Dry-run mode: no commits, no comments. */
  dryRun: z.boolean().default(false),
  /** Log level. */
  logLevel: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  /** JSON log output. */
  logJson: z.boolean().default(false),
  /** Whether to skip network calls (for testing). */
  offline: z.boolean().default(false),
});
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

// ============================================================================
// Root Configuration
// ============================================================================

export const IssueClawConfigSchema = z.object({
  /** Schema version. */
  version: z.literal(1).default(1),
  /** Provider fallback chain. First one is primary. */
  providers: z.array(ProviderSchema).min(1),
  /** Memory settings. */
  memory: MemoryConfigSchema.default({}),
  /** GitHub settings. */
  github: GithubConfigSchema.default({}),
  /** Agent settings. */
  agent: AgentConfigSchema.default({}),
  /** Runtime settings. */
  runtime: RuntimeConfigSchema.default({}),
});
export type IssueClawConfig = z.infer<typeof IssueClawConfigSchema>;

// ============================================================================
// Config Loader
// ============================================================================

const DEFAULT_CONFIG: IssueClawConfig = {
  version: 1,
  providers: [
    {
      type: "anthropic",
      model: "claude-opus-4-6",
      apiKey: "${ANTHROPIC_API_KEY}",
      thinking: "high",
      default: true,
    },
  ],
  memory: MemoryConfigSchema.parse({}),
  github: GithubConfigSchema.parse({}),
  agent: AgentConfigSchema.parse({}),
  runtime: RuntimeConfigSchema.parse({}),
};

/**
 * Resolve a value that may be a ${ENV_VAR} reference.
 */
export function resolveEnv(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^\$\{(.+)\}$/);
  if (match) {
    return process.env[match[1]] ?? "";
  }
  return value;
}

/**
 * Resolve all env references in a provider config.
 */
function resolveProviderEnv(provider: ProviderConfig): ProviderConfig {
  return {
    ...provider,
    apiKey: resolveEnv(provider.apiKey),
    headers: provider.headers
      ? Object.fromEntries(
          Object.entries(provider.headers).map(([k, v]) => [k, resolveEnv(v) ?? v]),
        )
      : undefined,
  };
}

/**
 * Find the config file. Searches in order:
 * 1. ISSUECLAW_CONFIG_PATH env var
 * 2. issueclaw.config.json in cwd
 * 3. .pi/settings.json (legacy)
 */
function findConfigPath(): string | null {
  const envPath = process.env.ISSUECLAW_CONFIG_PATH;
  if (envPath && existsSync(envPath)) return envPath;

  const candidates = [
    "issueclaw.config.json",
    "./issueclaw.config.json",
    ".pi/settings.json",
    "./.pi/settings.json",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return resolve(c);
  }
  return null;
}

/**
 * Convert legacy .pi/settings.json to IssueClawConfig.
 */
function legacyToConfig(legacy: unknown): Partial<IssueClawConfig> {
  const result: Partial<IssueClawConfig> = {};
  if (typeof legacy !== "object" || legacy === null) return result;
  const l = legacy as Record<string, unknown>;

  if (l.defaultProvider && l.defaultModel) {
    result.providers = [
      {
        type: l.defaultProvider as ProviderConfig["type"],
        model: l.defaultModel as string,
        apiKey: `\${${providerToApiKeyEnv(l.defaultProvider as string)}}`,
        thinking: l.defaultThinkingLevel as ProviderConfig["thinking"],
        default: true,
      },
    ];
  }
  return result;
}

function providerToApiKeyEnv(provider: string): string {
  const map: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    ollama: "OLLAMA_API_KEY",
    groq: "GROQ_API_KEY",
    gemini: "GEMINI_API_KEY",
    cerebras: "CEREBRAS_API_KEY",
    custom: "OPENAI_API_KEY",
  };
  return map[provider] ?? "API_KEY";
}

/**
 * Auto-generate a working config file with sensible defaults.
 * Detects which API keys are available in env and configures providers accordingly.
 * Writes to issueclaw.config.json if it doesn't exist.
 */
export function autoGenerateConfig(targetPath?: string): string {
  const path = targetPath ?? "issueclaw.config.json";
  const providers: ProviderConfig[] = [];

  // Detect available API keys and build provider list in priority order.
  // Priority is based on what works best with the DEFAULT mode (simple chat):
  //   1. Groq     — 12,000 TPM, but chat mode only needs ~500 tokens, so it works great
  //   2. Gemini  — 1,000,000 TPM (BEST for agent mode with tools)
  //   3. Cerebras — 60,000 TPM (fast, good fallback)
  //   4. OpenRouter — varies (has free models, good fallback)
  //   5. Anthropic / OpenAI — paid (good fallbacks if you have keys)

  if (process.env.GROQ_API_KEY) {
    providers.push({
      type: "groq",
      model: "llama-3.3-70b-versatile",
      apiKey: "${GROQ_API_KEY}",
      default: providers.length === 0,
    });
    // Add 8b model as second Groq fallback (smaller, faster)
    providers.push({
      type: "groq",
      model: "llama-3.1-8b-instant",
      apiKey: "${GROQ_API_KEY}",
      default: false,
    });
  }
  if (process.env.GEMINI_API_KEY) {
    providers.push({
      type: "gemini",
      model: "gemini-2.0-flash",
      apiKey: "${GEMINI_API_KEY}",
      default: providers.length === 0,
    });
  }
  if (process.env.CEREBRAS_API_KEY) {
    providers.push({
      type: "cerebras",
      model: "llama-3.3-70b",
      apiKey: "${CEREBRAS_API_KEY}",
      default: providers.length === 0,
    });
  }
  if (process.env.OPENROUTER_API_KEY) {
    // Use a working free model (nvidia nemotron is reliably available on free tier)
    providers.push({
      type: "openrouter",
      model: "nvidia/nemotron-3-nano-30b-a3b:free",
      apiKey: "${OPENROUTER_API_KEY}",
      default: providers.length === 0,
    });
  }
  if (process.env.ANTHROPIC_API_KEY) {
    providers.push({
      type: "anthropic",
      model: "claude-opus-4-6",
      apiKey: "${ANTHROPIC_API_KEY}",
      thinking: "high",
      default: providers.length === 0,
    });
  }
  if (process.env.OPENAI_API_KEY) {
    providers.push({
      type: "openai",
      model: "gpt-4o",
      apiKey: "${OPENAI_API_KEY}",
      default: providers.length === 0,
    });
  }

  // If no API keys detected, default to Groq (free tier) with placeholder
  if (providers.length === 0) {
    log.warn("no API keys detected in env; defaulting to Groq (free tier)");
    log.warn("get a free Groq API key at https://console.groq.com/keys");
    providers.push({
      type: "groq",
      model: "llama-3.3-70b-versatile",
      apiKey: "${GROQ_API_KEY}",
      default: true,
    });
  }

  const agentDefaults = AgentConfigSchema.parse({});
  // Restrict tools to reduce token count (Groq free tier has 12K TPM limit)
  agentDefaults.tools = ["read", "bash", "edit", "write", "grep", "glob", "ls"];
  agentDefaults.skills = false; // Skills add tokens; disable by default

  const config: IssueClawConfig = {
    version: 1,
    providers,
    memory: MemoryConfigSchema.parse({}),
    github: GithubConfigSchema.parse({}),
    agent: agentDefaults,
    runtime: RuntimeConfigSchema.parse({}),
  };

  const content = `${JSON.stringify(config, null, 2)}\n`;
  try {
    writeFileSync(path, content, "utf-8");
    log.info("auto-generated config", { path, providers: providers.map((p) => p.type) });
  } catch (err) {
    log.warn("failed to write auto config", {
      path,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return path;
}

/**
 * Load configuration from all sources.
 */
export function loadConfig(explicitPath?: string): IssueClawConfig {
  let configData: unknown = DEFAULT_CONFIG;
  let source = "defaults";

  const configPath = explicitPath ?? findConfigPath();

  // Auto-generate config if none exists
  if (!configPath && !explicitPath) {
    const autoPath = autoGenerateConfig();
    try {
      const raw = readFileSync(autoPath, "utf-8");
      configData = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
      source = autoPath;
    } catch {
      configData = DEFAULT_CONFIG;
    }
  } else if (configPath) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      const isLegacy = configPath.endsWith("settings.json");
      configData = isLegacy
        ? { ...DEFAULT_CONFIG, ...legacyToConfig(parsed) }
        : { ...DEFAULT_CONFIG, ...parsed };
      source = configPath;
      log.info("loaded config", { source, isLegacy });
    } catch (err) {
      log.warn("failed to load config, using defaults", {
        source,
        error: err instanceof Error ? err.message : String(err),
      });
      configData = DEFAULT_CONFIG;
    }
  }

  // Override with env vars
  const env: Record<string, unknown> = {};

  if (process.env.ISSUECLAW_PROVIDER || process.env.ISSUECLAW_MODEL) {
    const providerType = (process.env.ISSUECLAW_PROVIDER ?? "anthropic") as ProviderConfig["type"];
    env.providers = [
      {
        type: providerType,
        model: process.env.ISSUECLAW_MODEL ?? "claude-opus-4-6",
        apiKey: `\${${providerToApiKeyEnv(providerType)}}`,
        baseUrl: process.env.ISSUECLAW_BASE_URL,
        thinking: process.env.ISSUECLAW_THINKING as ProviderConfig["thinking"],
        default: true,
      },
    ];
  }

  if (process.env.ISSUECLAW_LOG_LEVEL) {
    env.runtime = {
      logLevel: process.env.ISSUECLAW_LOG_LEVEL as RuntimeConfig["logLevel"],
    };
  }
  if (process.env.ISSUECLAW_DRY_RUN === "true") {
    env.runtime = { ...(env.runtime as object), dryRun: true };
  }

  const merged = deepMerge(configData, env);
  const parsed = IssueClawConfigSchema.parse(merged);

  // Resolve env vars in provider configs
  parsed.providers = parsed.providers.map(resolveProviderEnv);

  log.debug("config loaded", {
    providers: parsed.providers.map((p) => ({ type: p.type, model: p.model, default: p.default })),
    source,
  });

  return parsed;
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (typeof base !== "object" || base === null) return override;
  if (typeof override !== "object" || override === null) return override;
  if (Array.isArray(base) || Array.isArray(override)) return override;
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    if (v !== undefined && v !== null) {
      result[k] = k in result ? deepMerge(result[k], v) : v;
    }
  }
  return result;
}

/**
 * Get the default (primary) provider from config.
 */
export function getDefaultProvider(config: IssueClawConfig): ProviderConfig {
  return config.providers.find((p) => p.default) ?? config.providers[0];
}

/**
 * Get the fallback chain (primary first, then alternates).
 */
export function getProviderChain(config: IssueClawConfig): ProviderConfig[] {
  const def = config.providers.find((p) => p.default);
  const rest = config.providers.filter((p) => !p.default);
  return def ? [def, ...rest] : config.providers;
}

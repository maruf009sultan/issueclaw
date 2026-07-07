/**
 * Provider registry and factory.
 */

import type { ProviderConfig } from "../config.ts";
import { log } from "../utils/log.ts";
import { anthropicProvider } from "./anthropic.ts";
import { cerebrasProvider } from "./cerebras.ts";
import { customProvider } from "./custom.ts";
import { geminiProvider } from "./gemini.ts";
import { groqProvider } from "./groq.ts";
import { ollamaProvider } from "./ollama.ts";
import { openaiProvider } from "./openai.ts";
import { openrouterProvider } from "./openrouter.ts";
import type { Provider } from "./types.ts";

const REGISTRY: Record<string, Provider> = {
  gemini: geminiProvider,
  cerebras: cerebrasProvider,
  anthropic: anthropicProvider,
  openai: openaiProvider,
  openrouter: openrouterProvider,
  ollama: ollamaProvider,
  groq: groqProvider,
  custom: customProvider,
};

/**
 * Register a custom provider at runtime.
 */
export function registerProvider(provider: Provider): void {
  REGISTRY[provider.type] = provider;
}

/**
 * Get a provider by type. Throws if not found.
 */
export function getProvider(type: string): Provider {
  const p = REGISTRY[type];
  if (!p) {
    throw new Error(
      `Unknown provider type: ${type}. Available: ${Object.keys(REGISTRY).join(", ")}`,
    );
  }
  return p;
}

/**
 * List all registered provider types.
 */
export function listProviderTypes(): string[] {
  return Object.keys(REGISTRY);
}

/**
 * Validate a provider config. Returns error message or null.
 */
export function validateProvider(config: ProviderConfig): string | null {
  try {
    const provider = getProvider(config.type);
    return provider.validate(config);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Build provider args for pi. Throws on validation failure.
 */
export function buildProviderArgs(config: ProviderConfig): {
  args: string[];
  env: Record<string, string | undefined>;
} {
  const error = validateProvider(config);
  if (error) {
    log.warn("provider validation failed", { type: config.type, error });
    throw new Error(`Provider "${config.type}" invalid: ${error}`);
  }
  const provider = getProvider(config.type);
  return provider.buildArgs(config);
}

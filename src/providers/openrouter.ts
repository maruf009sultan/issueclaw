/**
 * OpenRouter provider. Uses OPENROUTER_API_KEY.
 * Routes to any model: openai/gpt-4o, anthropic/claude-opus-4, google/gemini-pro, etc.
 */

import type { ProviderConfig } from "../config.ts";
import type { Provider, ProviderArgs } from "./types.ts";

export const openrouterProvider: Provider = {
  type: "openrouter",

  buildArgs(config: ProviderConfig): ProviderArgs {
    const args = ["--provider", "openrouter", "--model", config.model];
    if (config.thinking) {
      args.push("--thinking", config.thinking);
    }
    const env: Record<string, string | undefined> = {};
    if (config.apiKey) {
      env.OPENROUTER_API_KEY = config.apiKey;
    }
    if (config.baseUrl) {
      env.OPENROUTER_BASE_URL = config.baseUrl;
    }
    return { args, env };
  },

  validate(config: ProviderConfig): string | null {
    if (!config.model) return "OpenRouter provider requires a model";
    if (!config.apiKey) return "OpenRouter provider requires OPENROUTER_API_KEY";
    return null;
  },
};

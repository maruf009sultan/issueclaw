/**
 * OpenAI provider. Uses OPENAI_API_KEY.
 * Models: gpt-4o, gpt-4o-mini, gpt-4-turbo, o1, o3, etc.
 * Supports custom base URL for OpenAI-compatible endpoints.
 */

import type { ProviderConfig } from "../config.ts";
import type { Provider, ProviderArgs } from "./types.ts";

export const openaiProvider: Provider = {
  type: "openai",

  buildArgs(config: ProviderConfig): ProviderArgs {
    const args = ["--provider", "openai", "--model", config.model];
    if (config.thinking) {
      args.push("--thinking", config.thinking);
    }
    const env: Record<string, string | undefined> = {};
    if (config.apiKey) {
      env.OPENAI_API_KEY = config.apiKey;
    }
    // Custom base URL for OpenAI-compatible APIs (Together, Groq, vLLM, etc.)
    if (config.baseUrl) {
      env.OPENAI_BASE_URL = config.baseUrl;
    }
    // Custom headers
    if (config.headers) {
      // Pi reads OPENAI_HEADERS as JSON
      env.OPENAI_HEADERS = JSON.stringify(config.headers);
    }
    return { args, env };
  },

  validate(config: ProviderConfig): string | null {
    if (!config.model) return "OpenAI provider requires a model";
    if (!config.apiKey && config.type !== "ollama") {
      return "OpenAI provider requires OPENAI_API_KEY";
    }
    return null;
  },
};

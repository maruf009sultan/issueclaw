/**
 * Custom provider for any OpenAI-compatible endpoint.
 * Requires baseUrl. Useful for: Azure OpenAI, Together AI, Groq, vLLM, LM Studio, etc.
 */

import type { ProviderConfig } from "../config.ts";
import type { Provider, ProviderArgs } from "./types.ts";

export const customProvider: Provider = {
  type: "custom",

  buildArgs(config: ProviderConfig): ProviderArgs {
    const args = ["--provider", "openai", "--model", config.model];
    if (config.thinking) {
      args.push("--thinking", config.thinking);
    }
    const env: Record<string, string | undefined> = {
      OPENAI_BASE_URL: config.baseUrl ?? "",
      OPENAI_API_KEY: config.apiKey ?? "dummy",
    };
    if (config.headers) {
      env.OPENAI_HEADERS = JSON.stringify(config.headers);
    }
    return { args, env };
  },

  validate(config: ProviderConfig): string | null {
    if (!config.model) return "Custom provider requires a model";
    if (!config.baseUrl) return "Custom provider requires baseUrl";
    return null;
  },
};

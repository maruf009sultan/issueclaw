/**
 * Ollama provider for local LLMs. No API key required.
 * Models: llama3.1:70b, qwen2.5:32b, deepseek-r1:32b, etc.
 * Default base URL: http://localhost:11434
 */

import type { ProviderConfig } from "../config.ts";
import type { Provider, ProviderArgs } from "./types.ts";

export const ollamaProvider: Provider = {
  type: "ollama",

  buildArgs(config: ProviderConfig): ProviderArgs {
    // Ollama is OpenAI-compatible, so we use the openai provider with custom base URL
    const args = ["--provider", "openai", "--model", config.model];
    if (config.thinking) {
      args.push("--thinking", config.thinking);
    }
    const env: Record<string, string | undefined> = {
      OPENAI_BASE_URL: config.baseUrl ?? "http://localhost:11434/v1",
      OPENAI_API_KEY: config.apiKey ?? "ollama", // Ollama doesn't require a real key
    };
    return { args, env };
  },

  validate(config: ProviderConfig): string | null {
    if (!config.model) return "Ollama provider requires a model";
    return null;
  },
};

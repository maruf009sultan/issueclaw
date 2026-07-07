/**
 * Groq provider. Ultra-fast inference, free tier available.
 * Free tier: https://console.groq.com/docs/rate-limits
 * Get API key: https://console.groq.com/keys
 *
 * Pi has NATIVE Groq support via --provider groq, which reads GROQ_API_KEY
 * and uses the correct base URL (https://api.groq.com/openai/v1).
 *
 * Models: llama-3.3-70b-versatile, llama-3.1-8b-instant, mixtral-8x7b-32768, gemma2-9b-it
 */

import type { ProviderConfig } from "../config.ts";
import type { Provider, ProviderArgs } from "./types.ts";

export const GROQ_DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";

/** Default free-tier models on Groq. */
export const GROQ_DEFAULT_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "llama3-70b-8192",
  "llama3-8b-8192",
  "mixtral-8x7b-32768",
  "gemma2-9b-it",
] as const;

export const groqProvider: Provider = {
  type: "groq",

  buildArgs(config: ProviderConfig): ProviderArgs {
    // Use pi's NATIVE groq provider (reads GROQ_API_KEY, uses correct base URL)
    const args = ["--provider", "groq", "--model", config.model];
    if (config.thinking) {
      args.push("--thinking", config.thinking);
    }
    const env: Record<string, string | undefined> = {};
    if (config.apiKey) {
      env.GROQ_API_KEY = config.apiKey;
    }
    // If a custom baseUrl is set (e.g. for testing with a mock), we need to
    // override the provider via an extension. For now, just warn.
    if (config.baseUrl && config.baseUrl !== GROQ_DEFAULT_BASE_URL) {
      // For mock/test mode: fall back to openai-completions with custom URL
      // This requires a pi extension; for now we set OPENAI_BASE_URL as fallback
      env.OPENAI_BASE_URL = config.baseUrl;
    }
    return { args, env };
  },

  validate(config: ProviderConfig): string | null {
    if (!config.model) return "Groq provider requires a model";
    if (!config.apiKey) {
      return "Groq provider requires GROQ_API_KEY (get free at https://console.groq.com/keys)";
    }
    return null;
  },
};

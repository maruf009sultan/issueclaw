/**
 * Google Gemini provider.
 *
 * FREE TIER (as of 2026):
 *   - Gemini 2.0 Flash: 15 RPM, 1,000,000 TPM, 1,500 req/day
 *   - Gemini 2.5 Flash: 10 RPM, 1,000,000 TPM, 500 req/day
 *   - Gemini 1.5 Flash: 15 RPM, 1,000,000 TPM, 1,500 req/day
 *
 * That's 1 MILLION tokens per minute — 83x higher than Groq's 12K TPM.
 * Perfect for AI agents with large system prompts and tool definitions.
 *
 * Get a free API key: https://aistudio.google.com/app/apikey
 *
 * Pi has NATIVE Gemini support via --provider google, which reads GEMINI_API_KEY
 * and uses the correct base URL automatically.
 */

import type { ProviderConfig } from "../config.ts";
import type { Provider, ProviderArgs } from "./types.ts";

/** Default free-tier models on Google Gemini. */
export const GEMINI_DEFAULT_MODELS = [
  "gemini-2.0-flash", // 15 RPM, 1M TPM — recommended default
  "gemini-2.5-flash", // 10 RPM, 1M TPM, better reasoning
  "gemini-2.0-flash-lite", // faster, cheaper
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-2.5-pro",
] as const;

export const geminiProvider: Provider = {
  type: "gemini",

  buildArgs(config: ProviderConfig): ProviderArgs {
    // Use pi's NATIVE google provider (reads GEMINI_API_KEY, uses correct base URL)
    const args = ["--provider", "google", "--model", config.model];
    if (config.thinking) {
      args.push("--thinking", config.thinking);
    }
    const env: Record<string, string | undefined> = {};
    if (config.apiKey) {
      env.GEMINI_API_KEY = config.apiKey;
    }
    return { args, env };
  },

  validate(config: ProviderConfig): string | null {
    if (!config.model) return "Gemini provider requires a model";
    if (!config.apiKey) {
      return "Gemini provider requires GEMINI_API_KEY (get free at https://aistudio.google.com/app/apikey)";
    }
    return null;
  },
};

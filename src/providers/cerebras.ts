/**
 * Cerebras provider. Ultra-fast inference (Llama models on Cerebras hardware).
 *
 * FREE TIER (as of 2026):
 *   - Llama 3.3 70B: ~30 RPM, 60K TPM
 *   - Llama 3.1 8B: ~30 RPM, 60K TPM
 *
 * Faster than Groq (1000+ tokens/sec) but similar TPM limits.
 * Good as a fallback when Gemini is unavailable.
 *
 * Get a free API key: https://inference.cerebras.ai/
 *
 * Pi has NATIVE Cerebras support via --provider cerebras, which reads CEREBRAS_API_KEY.
 */

import type { ProviderConfig } from "../config.ts";
import type { Provider, ProviderArgs } from "./types.ts";

export const CEREBRAS_DEFAULT_BASE_URL = "https://api.cerebras.ai/v1";

/** Default free-tier models on Cerebras. */
export const CEREBRAS_DEFAULT_MODELS = [
  "llama-3.3-70b",
  "llama-3.1-8b",
  "gpt-oss-120b",
  "zai-glm-4.7",
] as const;

export const cerebrasProvider: Provider = {
  type: "cerebras",

  buildArgs(config: ProviderConfig): ProviderArgs {
    // Use pi's NATIVE cerebras provider (reads CEREBRAS_API_KEY)
    const args = ["--provider", "cerebras", "--model", config.model];
    if (config.thinking) {
      args.push("--thinking", config.thinking);
    }
    const env: Record<string, string | undefined> = {};
    if (config.apiKey) {
      env.CEREBRAS_API_KEY = config.apiKey;
    }
    return { args, env };
  },

  validate(config: ProviderConfig): string | null {
    if (!config.model) return "Cerebras provider requires a model";
    if (!config.apiKey) {
      return "Cerebras provider requires CEREBRAS_API_KEY (get free at https://inference.cerebras.ai/)";
    }
    return null;
  },
};

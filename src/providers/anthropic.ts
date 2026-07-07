/**
 * Anthropic provider. Uses ANTHROPIC_API_KEY.
 * Models: claude-opus-4-6, claude-sonnet-4-5, claude-haiku-4-5, etc.
 */

import type { ProviderConfig } from "../config.ts";
import type { Provider, ProviderArgs } from "./types.ts";

export const anthropicProvider: Provider = {
  type: "anthropic",

  buildArgs(config: ProviderConfig): ProviderArgs {
    const args = ["--provider", "anthropic", "--model", config.model];
    if (config.thinking) {
      args.push("--thinking", config.thinking);
    }
    const env: Record<string, string | undefined> = {};
    if (config.apiKey) {
      env.ANTHROPIC_API_KEY = config.apiKey;
    }
    return { args, env };
  },

  validate(config: ProviderConfig): string | null {
    if (!config.model) return "Anthropic provider requires a model";
    if (!config.apiKey) return "Anthropic provider requires ANTHROPIC_API_KEY";
    return null;
  },
};

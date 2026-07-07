/**
 * Provider type definitions.
 *
 * A Provider is an abstraction over an LLM backend. It knows how to:
 * - Build the CLI arguments for pi
 * - Set environment variables for authentication
 * - Validate its own configuration
 */

import type { ProviderConfig } from "../config.ts";

export interface ProviderEnv {
  [key: string]: string | undefined;
}

export interface ProviderArgs {
  /** CLI arguments to pass to pi (e.g. ["--provider", "anthropic", "--model", "claude-opus-4-6"]). */
  args: string[];
  /** Environment variables to set. */
  env: ProviderEnv;
}

export interface Provider {
  /** Provider type identifier. */
  readonly type: string;
  /** Build the CLI args + env for pi. */
  buildArgs(config: ProviderConfig): ProviderArgs;
  /** Validate the provider config. Returns error message or null. */
  validate(config: ProviderConfig): string | null;
}

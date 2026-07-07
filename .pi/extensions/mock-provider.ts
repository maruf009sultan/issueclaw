/**
 * Pi extension: Mock LLM provider for testing.
 *
 * Registers a "mock" provider that points to a local mock LLM server.
 * Activate by setting MOCK_LLM_BASE_URL env var.
 *
 * Usage:
 *   1. Start mock server: bun run scripts/mock-llm.ts
 *   2. Set env: MOCK_LLM_BASE_URL=http://127.0.0.1:9876/v1
 *   3. Run issueclaw with provider type "mock" (or override groq/anthropic/etc.)
 *
 * The mock server implements an OpenAI-compatible /v1/chat/completions endpoint
 * and returns canned responses — no real API key needed.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const baseUrl = process.env.MOCK_LLM_BASE_URL;
  if (!baseUrl) {
    // Not in test mode — extension is a no-op
    return;
  }

  // Register a "mock" provider
  pi.registerProvider("mock", {
    name: "Mock LLM (for testing)",
    baseUrl,
    apiKey: process.env.MOCK_LLM_API_KEY ?? "mock-key",
    api: "openai-completions",
    models: [
      {
        id: "mock-model",
        name: "Mock Model",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ],
  });

  // If MOCK_OVERRIDE_GROQ is set, override the groq provider to point to mock
  if (process.env.MOCK_OVERRIDE_GROQ === "true") {
    pi.registerProvider("groq", {
      baseUrl,
      apiKey: "mock-key",
      api: "openai-completions",
      models: [
        {
          id: "llama-3.3-70b-versatile",
          name: "Mock Llama 3.3 70B",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 131072,
          maxTokens: 131072,
        },
      ],
    });
  }
}

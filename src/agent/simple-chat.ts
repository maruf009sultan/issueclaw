/**
 * Simple chat mode — lightweight LLM call WITHOUT the pi agent.
 *
 * This mode is for simple conversations that don't need file editing, bash,
 * or tool use. It calls the LLM API directly, using only ~500 tokens
 * (vs ~120,000 tokens for the full agent mode).
 *
 * This saves massive API quota — perfect for quick Q&A on issues.
 *
 * Triggered by:
 * - The "chat" label on an issue
 * - The "💬 Chat" issue template
 *
 * STILL saves to state/ (memory, session, audit) and commits to git.
 */

import type { IssueClawConfig, ProviderConfig } from "../config.ts";
import { getProviderChain } from "../config.ts";
import type { ParsedEvent } from "../github/events.ts";
import type { MemoryStore } from "../memory/store.ts";
import { log } from "../utils/log.ts";
import { errorMessage, isRetryableHttpError, retry } from "../utils/retry.ts";

export interface SimpleChatOptions {
  config: IssueClawConfig;
  memory: MemoryStore;
  event: ParsedEvent;
  existingMapping?: { sessionPath: string } | null;
}

export interface SimpleChatResult {
  success: boolean;
  response: string;
  providerUsed: ProviderConfig | null;
  tokensUsed: number;
  error?: string;
  durationMs: number;
}

/**
 * Build a minimal system prompt for simple chat.
 * Much smaller than pi's full system prompt (~200 tokens vs ~120K).
 */
function buildSystemPrompt(memory: MemoryStore): string {
  const parts: string[] = [
    "You are a helpful AI assistant running inside a GitHub repo via issueclaw.",
    "Respond concisely and helpfully. Use Markdown for formatting.",
  ];

  // Include personality if set (non-default)
  const personality = memory.readPersonality();
  if (personality && !personality.includes("TBD")) {
    parts.push(`\nYour identity:\n${personality}`);
  }

  // Include recent memory (last 10 lines, skip defaults)
  const memContent = memory.readMemory();
  if (memContent) {
    const lines = memContent
      .split("\n")
      .filter(
        (l) =>
          l.trim() && !l.startsWith("#") && !l.startsWith(">") && !l.includes("[uninitialized]"),
      )
      .slice(-10);
    if (lines.length > 0) {
      parts.push(`\nRecent memory:\n${lines.join("\n")}`);
    }
  }

  return parts.join("\n");
}

/**
 * Build the conversation history for the LLM.
 * For simple chat, we only include the current message (no session resume).
 * This keeps token count minimal.
 */
function buildUserMessage(event: ParsedEvent): string {
  if (event.type === "issue_comment.created") {
    return event.body;
  }
  return `${event.title}\n\n${event.body}`;
}

/**
 * Make a direct LLM API call (no pi, no tools, no agent).
 * Supports OpenAI-compatible APIs (Groq, Cerebras, OpenRouter, OpenAI, custom)
 * and Google Gemini's native API format.
 */
async function callLLM(
  provider: ProviderConfig,
  systemPrompt: string,
  userMessage: string,
): Promise<{ text: string; tokens: number }> {
  const apiKey = provider.apiKey;
  if (!apiKey || apiKey.includes("${")) {
    throw new Error(`${provider.type.toUpperCase()}_API_KEY not set`);
  }

  // Route to the appropriate API based on provider type
  if (provider.type === "gemini") {
    return callGemini(provider, apiKey, systemPrompt, userMessage);
  }
  // All other providers use OpenAI-compatible chat completions API
  return callOpenAICompatible(provider, apiKey, systemPrompt, userMessage);
}

/**
 * Call Google Gemini's native API.
 * Endpoint: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 */
async function callGemini(
  provider: ProviderConfig,
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
): Promise<{ text: string; tokens: number }> {
  const model = provider.model;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: userMessage }],
      },
    ],
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    generationConfig: {
      temperature: provider.temperature ?? 0.7,
      maxOutputTokens: provider.maxTokens ?? 8192,
    },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API error (${resp.status}): ${errText.slice(0, 500)}`);
  }

  const data = (await resp.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    usageMetadata?: { totalTokenCount?: number };
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const tokens = data.usageMetadata?.totalTokenCount ?? 0;

  if (!text) {
    throw new Error("Gemini returned empty response");
  }

  return { text, tokens };
}

/**
 * Call an OpenAI-compatible chat completions API.
 * Works with: Groq, Cerebras, OpenRouter, OpenAI, Together, Groq, vLLM, etc.
 */
async function callOpenAICompatible(
  provider: ProviderConfig,
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
): Promise<{ text: string; tokens: number }> {
  // Determine base URL based on provider type
  const baseUrl = getBaseUrl(provider);
  const url = `${baseUrl}/chat/completions`;

  const body = {
    model: provider.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: provider.temperature ?? 0.7,
    max_tokens: provider.maxTokens ?? 8192,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (provider.headers) {
    for (const [k, v] of Object.entries(provider.headers)) {
      headers[k] = v;
    }
  }

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`LLM API error (${resp.status}): ${errText.slice(0, 500)}`);
  }

  const data = (await resp.json()) as {
    choices?: Array<{
      message?: { content?: string };
      finish_reason?: string;
    }>;
    usage?: { total_tokens?: number };
  };

  const text = data.choices?.[0]?.message?.content ?? "";
  const tokens = data.usage?.total_tokens ?? 0;

  if (!text) {
    throw new Error("LLM returned empty response");
  }

  return { text, tokens };
}

/**
 * Get the base URL for an OpenAI-compatible provider.
 */
function getBaseUrl(provider: ProviderConfig): string {
  if (provider.baseUrl) return provider.baseUrl.replace(/\/$/, "");

  switch (provider.type) {
    case "groq":
      return "https://api.groq.com/openai/v1";
    case "cerebras":
      return "https://api.cerebras.ai/v1";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "openai":
      return "https://api.openai.com/v1";
    case "ollama":
      return "http://localhost:11434/v1";
    default:
      return "https://api.openai.com/v1";
  }
}

/**
 * Run a simple chat — direct LLM call, no agent, no tools.
 * Saves ~99% of API tokens compared to full agent mode.
 */
export async function runSimpleChat(options: SimpleChatOptions): Promise<SimpleChatResult> {
  const startTime = Date.now();
  const { config, memory, event } = options;

  const systemPrompt = buildSystemPrompt(memory);
  const userMessage = buildUserMessage(event);

  log.info("starting simple chat", {
    issue: event.issueNumber,
    systemPromptTokens: Math.ceil(systemPrompt.length / 4),
    userMessageTokens: Math.ceil(userMessage.length / 4),
  });

  const providers = getProviderChain(config);
  const failures: Array<{ provider: string; error: string }> = [];

  for (const provider of providers) {
    const hasKey = Boolean(
      provider.apiKey && provider.apiKey.length > 0 && !provider.apiKey.includes("${"),
    );
    if (!hasKey) {
      log.info("simple chat: skipping provider (no key)", { provider: provider.type });
      failures.push({
        provider: provider.type,
        error: `no API key set (needs ${provider.type.toUpperCase()}_API_KEY)`,
      });
      continue;
    }

    try {
      const result = await retry(() => callLLM(provider, systemPrompt, userMessage), {
        maxAttempts: 2,
        name: `simple-chat ${provider.type}`,
        retryIf: isRetryableHttpError,
        initialDelayMs: 2000,
      });

      log.info("simple chat succeeded", {
        provider: `${provider.type}/${provider.model}`,
        tokens: result.tokens,
        durationMs: Date.now() - startTime,
      });

      return {
        success: true,
        response: result.text,
        providerUsed: provider,
        tokensUsed: result.tokens,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      const errMsg = errorMessage(err);
      failures.push({ provider: provider.type, error: errMsg });
      log.warn("simple chat: provider failed, trying next", {
        provider: provider.type,
        error: errMsg,
      });
    }
  }

  const failureSummary = failures
    .map((f, i) => `${i + 1}. \`${f.provider}\`: ${f.error}`)
    .join("\n");

  return {
    success: false,
    response: "",
    providerUsed: null,
    tokensUsed: 0,
    error: `All ${providers.length} provider(s) failed in simple chat mode:\n\n${failureSummary}`,
    durationMs: Date.now() - startTime,
  };
}

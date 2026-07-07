import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSimpleChat } from "../../src/agent/simple-chat.ts";
import type { IssueClawConfig, MemoryConfig, ProviderConfig } from "../../src/config.ts";
import { MemoryStore } from "../../src/memory/store.ts";

// Mock fetch for testing
const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

function makeTestConfig(providers: ProviderConfig[]): IssueClawConfig {
  return {
    version: 1,
    providers,
    memory: {
      stateDir: "./state",
      memoryFile: "memory.md",
      personalityFile: "personality.md",
      userFile: "user.md",
      auditFile: "audit.log",
      maxSessionSize: 10485760,
      autoCompact: true,
    },
    github: {
      onIssueOpened: true,
      onIssueComment: true,
      onPullRequest: false,
      allowedAssociations: ["OWNER", "MEMBER", "COLLABORATOR"],
      hatchLabel: "hatch",
      reactionWhileProcessing: true,
      maxCommentLength: 60000,
      concurrencyGroup: "x",
    },
    agent: {
      piCommand: "bunx pi",
      timeoutMs: 60000,
      skills: false,
      extensions: false,
      appendSystemPrompt: ".pi/APPEND_SYSTEM.md",
      agentsFile: "AGENTS.md",
    },
    runtime: { dryRun: false, logLevel: "warn", logJson: false, offline: false },
  };
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: "issues.opened" as const,
    rawName: "issues",
    issueNumber: 1,
    title: "Hello",
    body: "What is 2+2?",
    author: "testuser",
    authorAssociation: "OWNER",
    isBot: false,
    labels: [],
    raw: {},
    ...overrides,
  };
}

describe("simple-chat", () => {
  let tempDir: string;
  let memory: MemoryStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "simple-chat-test-"));
    const config: MemoryConfig = {
      stateDir: tempDir,
      memoryFile: "memory.md",
      personalityFile: "personality.md",
      userFile: "user.md",
      auditFile: "audit.log",
      maxSessionSize: 10485760,
      autoCompact: true,
    };
    memory = new MemoryStore(config);
    memory.init();
    mockFetch.mockReset();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should call OpenAI-compatible API and return response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "2 + 2 = 4" } }],
        usage: { total_tokens: 50 },
      }),
      text: async () => "",
    });

    const config = makeTestConfig([
      { type: "groq", model: "llama-3.3-70b-versatile", apiKey: "gsk-test", default: true },
    ]);

    const result = await runSimpleChat({
      config,
      memory,
      event: makeEvent(),
    });

    expect(result.success).toBe(true);
    expect(result.response).toBe("2 + 2 = 4");
    expect(result.tokensUsed).toBe(50);
    expect(result.providerUsed?.type).toBe("groq");

    // Verify fetch was called with correct URL
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call = mockFetch.mock.calls[0];
    expect(call[0]).toBe("https://api.groq.com/openai/v1/chat/completions");
  });

  it("should call Gemini API in native format", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Hello from Gemini!" }] } }],
        usageMetadata: { totalTokenCount: 30 },
      }),
      text: async () => "",
    });

    const config = makeTestConfig([
      { type: "gemini", model: "gemini-2.0-flash", apiKey: "AIzaTest", default: true },
    ]);

    const result = await runSimpleChat({
      config,
      memory,
      event: makeEvent(),
    });

    expect(result.success).toBe(true);
    expect(result.response).toBe("Hello from Gemini!");
    expect(result.tokensUsed).toBe(30);

    // Verify Gemini URL format
    const call = mockFetch.mock.calls[0];
    expect(call[0]).toContain("generativelanguage.googleapis.com");
    expect(call[0]).toContain("gemini-2.0-flash");
    expect(call[0]).toContain("generateContent");
  });

  it("should skip providers with no API key", async () => {
    const config = makeTestConfig([
      { type: "groq", model: "llama-3.3-70b-versatile", apiKey: "${GROQ_API_KEY}", default: true },
      { type: "openai", model: "gpt-4o", apiKey: "${OPENAI_API_KEY}" },
    ]);

    const result = await runSimpleChat({
      config,
      memory,
      event: makeEvent(),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("groq");
    expect(result.error).toContain("openai");
    expect(result.error).toContain("no API key");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should fall back to next provider on error", async () => {
    // First provider fails with non-retryable error (400)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => "bad request",
      json: async () => ({}),
    });
    // Second provider succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Fallback worked!" } }],
        usage: { total_tokens: 40 },
      }),
      text: async () => "",
    });

    const config = makeTestConfig([
      { type: "groq", model: "llama-3.3-70b-versatile", apiKey: "gsk-test", default: true },
      { type: "cerebras", model: "llama-3.3-70b", apiKey: "csk-test" },
    ]);

    const result = await runSimpleChat({
      config,
      memory,
      event: makeEvent(),
    });

    expect(result.success).toBe(true);
    expect(result.response).toBe("Fallback worked!");
    expect(result.providerUsed?.type).toBe("cerebras");
  });

  it("should handle empty response from LLM", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "" } }],
        usage: { total_tokens: 10 },
      }),
      text: async () => "",
    });

    const config = makeTestConfig([
      { type: "groq", model: "llama-3.3-70b-versatile", apiKey: "gsk-test", default: true },
    ]);

    const result = await runSimpleChat({
      config,
      memory,
      event: makeEvent(),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("empty response");
  });

  it("should include personality in system prompt when set", async () => {
    memory.writePersonality("# Personality\n\nName: TestBot\nVibe: chill");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Hi!" } }],
        usage: { total_tokens: 20 },
      }),
      text: async () => "",
    });

    const config = makeTestConfig([
      { type: "groq", model: "llama-3.3-70b-versatile", apiKey: "gsk-test", default: true },
    ]);

    await runSimpleChat({
      config,
      memory,
      event: makeEvent(),
    });

    // Verify the system prompt included personality
    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.messages[0].content).toContain("TestBot");
    expect(body.messages[0].content).toContain("chill");
  });

  it("should use comment body for issue_comment events", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Reply!" } }],
        usage: { total_tokens: 15 },
      }),
      text: async () => "",
    });

    const config = makeTestConfig([
      { type: "groq", model: "llama-3.3-70b-versatile", apiKey: "gsk-test", default: true },
    ]);

    await runSimpleChat({
      config,
      memory,
      event: makeEvent({
        type: "issue_comment.created",
        body: "This is my comment reply",
      }),
    });

    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.messages[1].content).toBe("This is my comment reply");
  });

  it("should use custom baseUrl when provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Custom!" } }],
        usage: { total_tokens: 10 },
      }),
      text: async () => "",
    });

    const config = makeTestConfig([
      {
        type: "custom",
        model: "my-model",
        apiKey: "my-key",
        baseUrl: "https://api.mybackend.com/v1",
        default: true,
      },
    ]);

    await runSimpleChat({
      config,
      memory,
      event: makeEvent(),
    });

    const call = mockFetch.mock.calls[0];
    expect(call[0]).toBe("https://api.mybackend.com/v1/chat/completions");
  });
});

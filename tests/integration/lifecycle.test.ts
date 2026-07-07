import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPrompt, runAgent } from "../../src/agent/runner.ts";
import { loadConfig } from "../../src/config.ts";
import { parseEvent } from "../../src/github/events.ts";
import { MemoryStore } from "../../src/memory/store.ts";

describe("lifecycle integration", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "issueclaw-int-"));
    originalCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    process.env.GITHUB_EVENT_PATH = undefined;
    process.env.GITHUB_EVENT_NAME = undefined;
  });

  it("should run full lifecycle in mock mode (offline)", async () => {
    // Create config
    writeFileSync(
      "issueclaw.config.json",
      JSON.stringify({
        version: 1,
        providers: [
          {
            type: "anthropic",
            model: "claude-opus-4-6",
            apiKey: "test-key",
            default: true,
          },
        ],
        runtime: {
          dryRun: true,
          offline: true,
          logLevel: "debug",
        },
      }),
    );

    // Create event payload
    const eventPayload = {
      action: "opened",
      issue: {
        number: 1,
        title: "Integration Test",
        body: "This is an integration test issue",
        user: { login: "tester" },
        author_association: "OWNER",
        labels: [],
      },
    };
    const eventPath = join(tempDir, "event.json");
    writeFileSync(eventPath, JSON.stringify(eventPayload));
    process.env.GITHUB_EVENT_PATH = eventPath;
    process.env.GITHUB_EVENT_NAME = "issues";

    // Load config & parse event
    const config = loadConfig();
    expect(config.runtime.dryRun).toBe(true);

    const event = parseEvent();
    expect(event.type).toBe("issues.opened");
    expect(event.issueNumber).toBe(1);

    // Initialize memory
    const memory = new MemoryStore(config.memory);
    memory.init();

    expect(existsSync(join(config.memory.stateDir, "memory.md"))).toBe(true);
    expect(existsSync(join(config.memory.stateDir, "personality.md"))).toBe(true);
    expect(existsSync(join(config.memory.stateDir, "user.md"))).toBe(true);

    // Build prompt
    const prompt = buildPrompt(event, memory, config);
    expect(prompt).toContain("Integration Test");
    expect(prompt).toContain("## Instructions");

    // Run agent (offline mock mode)
    const result = await runAgent({
      config,
      memory,
      event,
      executable: false,
    });

    expect(result.success).toBe(true);
    expect(result.response).toContain("[MOCK MODE]");
    expect(result.providerUsed?.type).toBe("anthropic");
  });

  it("should handle hatch label", async () => {
    writeFileSync(
      "issueclaw.config.json",
      JSON.stringify({
        version: 1,
        providers: [
          {
            type: "openai",
            model: "gpt-4o",
            apiKey: "test-key",
            default: true,
          },
        ],
        runtime: { dryRun: true, offline: true, logLevel: "debug" },
      }),
    );

    const eventPayload = {
      action: "opened",
      issue: {
        number: 2,
        title: "Hatch me",
        body: "Let's create an identity",
        user: { login: "tester" },
        author_association: "OWNER",
        labels: [{ name: "hatch" }],
      },
    };
    const eventPath = join(tempDir, "event.json");
    writeFileSync(eventPath, JSON.stringify(eventPayload));
    process.env.GITHUB_EVENT_PATH = eventPath;
    process.env.GITHUB_EVENT_NAME = "issues";

    const config = loadConfig();
    const event = parseEvent();
    expect(event.labels).toContain("hatch");

    const memory = new MemoryStore(config.memory);
    memory.init();

    const prompt = buildPrompt(event, memory, config);
    expect(prompt).toContain("HATCH TRIGGER");
    expect(prompt).toContain("BOOTSTRAP.md");
  });

  it("should support multiple providers with fallback", async () => {
    writeFileSync(
      "issueclaw.config.json",
      JSON.stringify({
        version: 1,
        providers: [
          {
            type: "anthropic",
            model: "claude-opus-4-6",
            apiKey: "primary-key",
            default: true,
          },
          {
            type: "openai",
            model: "gpt-4o",
            apiKey: "fallback-key",
          },
          {
            type: "openrouter",
            model: "anthropic/claude-opus-4",
            apiKey: "or-key",
          },
        ],
        runtime: { dryRun: true, offline: true, logLevel: "debug" },
      }),
    );

    const config = loadConfig();
    expect(config.providers).toHaveLength(3);

    const eventPayload = {
      action: "opened",
      issue: {
        number: 3,
        title: "Fallback test",
        body: "Testing fallback chain",
        user: { login: "tester" },
        author_association: "OWNER",
        labels: [],
      },
    };
    const eventPath = join(tempDir, "event.json");
    writeFileSync(eventPath, JSON.stringify(eventPayload));
    process.env.GITHUB_EVENT_PATH = eventPath;
    process.env.GITHUB_EVENT_NAME = "issues";

    const event = parseEvent();
    const memory = new MemoryStore(config.memory);
    memory.init();

    const result = await runAgent({
      config,
      memory,
      event,
      executable: false,
    });

    // Primary provider should be tried first
    expect(result.success).toBe(true);
    expect(result.providerUsed?.type).toBe("anthropic");
  });

  it("should persist state files via memory store", async () => {
    writeFileSync(
      "issueclaw.config.json",
      JSON.stringify({
        version: 1,
        providers: [{ type: "anthropic", model: "x", apiKey: "k", default: true }],
        runtime: { dryRun: true, offline: true, logLevel: "debug" },
      }),
    );

    const config = loadConfig();
    const memory = new MemoryStore(config.memory);
    memory.init();

    // Modify state
    memory.appendMemory("test fact from integration");
    memory.writePersonality("# Updated Personality\nName: TestBot");
    memory.writeUser("Name: Tester");
    memory.appendAudit("integration_test", { timestamp: new Date().toISOString() });

    // Read back
    const memContent = memory.readMemory();
    const persContent = memory.readPersonality();
    const userContent = memory.readUser();
    const auditContent = memory.readAudit();

    expect(memContent).toContain("test fact from integration");
    expect(persContent).toContain("TestBot");
    expect(userContent).toContain("Tester");
    expect(auditContent).toContain("integration_test");
  });
});

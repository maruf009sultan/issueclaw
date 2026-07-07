import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPrompt, extractFinalMessage } from "../../src/agent/runner.ts";
import type { IssueClawConfig, MemoryConfig } from "../../src/config.ts";
import type { ParsedEvent } from "../../src/github/events.ts";
import { MemoryStore } from "../../src/memory/store.ts";

function makeTestConfig(): IssueClawConfig {
  return {
    version: 1,
    providers: [{ type: "anthropic", model: "claude-opus-4-6", apiKey: "key" }],
    memory: {
      stateDir: "./state",
      memoryFile: "memory.md",
      personalityFile: "personality.md",
      userFile: "user.md",
      auditFile: "audit.log",
      maxSessionSize: 10 * 1024 * 1024,
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
      concurrencyGroup: "issueclaw",
    },
    agent: {
      piCommand: "bunx pi",
      timeoutMs: 60000,
      skills: true,
      extensions: true,
      appendSystemPrompt: ".pi/APPEND_SYSTEM.md",
      agentsFile: "AGENTS.md",
    },
    runtime: { dryRun: false, logLevel: "info", logJson: false, offline: false },
  };
}

function makeEvent(overrides: Partial<ParsedEvent> = {}): ParsedEvent {
  return {
    type: "issues.opened",
    rawName: "issues",
    issueNumber: 1,
    title: "Test Issue",
    body: "This is a test issue",
    author: "alice",
    authorAssociation: "OWNER",
    isBot: false,
    labels: [],
    raw: {},
    ...overrides,
  };
}

describe("agent runner", () => {
  let tempDir: string;
  let memory: MemoryStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "issueclaw-agent-"));
    const config: MemoryConfig = {
      stateDir: tempDir,
      memoryFile: "memory.md",
      personalityFile: "personality.md",
      userFile: "user.md",
      auditFile: "audit.log",
      maxSessionSize: 10 * 1024 * 1024,
      autoCompact: true,
    };
    memory = new MemoryStore(config);
    memory.init();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("buildPrompt", () => {
    it("should include issue title and body", () => {
      const event = makeEvent();
      const config = makeTestConfig();
      const prompt = buildPrompt(event, memory, config);
      expect(prompt).toContain("Test Issue");
      expect(prompt).toContain("This is a test issue");
    });

    it("should include Current Request section", () => {
      const event = makeEvent();
      const config = makeTestConfig();
      const prompt = buildPrompt(event, memory, config);
      expect(prompt).toContain("## Current Request");
    });

    it("should include Instructions section", () => {
      const event = makeEvent();
      const config = makeTestConfig();
      const prompt = buildPrompt(event, memory, config);
      expect(prompt).toContain("## Instructions");
      expect(prompt).toContain("state/personality.md");
      expect(prompt).toContain("state/memory.md");
    });

    it("should include HATCH TRIGGER for hatch label", () => {
      const event = makeEvent({ labels: ["hatch"] });
      const config = makeTestConfig();
      const prompt = buildPrompt(event, memory, config);
      expect(prompt).toContain("HATCH TRIGGER");
      expect(prompt).toContain("BOOTSTRAP.md");
    });

    it("should not include HATCH TRIGGER without label", () => {
      const event = makeEvent({ labels: ["bug"] });
      const config = makeTestConfig();
      const prompt = buildPrompt(event, memory, config);
      expect(prompt).not.toContain("HATCH TRIGGER");
    });

    it("should include personality when set", () => {
      memory.writePersonality("# Personality\n\nName: TestBot\nVibe: chill");
      const event = makeEvent();
      const config = makeTestConfig();
      const prompt = buildPrompt(event, memory, config);
      expect(prompt).toContain("TestBot");
      expect(prompt).toContain("## Your Identity");
    });

    it("should not include default TBD personality", () => {
      const event = makeEvent();
      const config = makeTestConfig();
      const prompt = buildPrompt(event, memory, config);
      // Default personality has TBD, should not be included
      expect(prompt).not.toContain("## Your Identity");
    });

    it("should include recent memory", () => {
      memory.appendMemory("important fact one");
      memory.appendMemory("important fact two");
      const event = makeEvent();
      const config = makeTestConfig();
      const prompt = buildPrompt(event, memory, config);
      expect(prompt).toContain("## Recent Memory");
      expect(prompt).toContain("important fact one");
      expect(prompt).toContain("important fact two");
    });

    it("should use comment body for issue_comment events", () => {
      const event = makeEvent({
        type: "issue_comment.created",
        body: "This is a comment reply",
      });
      const config = makeTestConfig();
      const prompt = buildPrompt(event, memory, config);
      expect(prompt).toContain("This is a comment reply");
    });

    it("should strip issue template boilerplate", () => {
      const event = makeEvent({
        type: "issues.opened",
        title: "Build a website",
        body: `## What do you want the agent to do?

Build a hello world page

## Context

[Optional: Any background info]

## Success Criteria

[Optional: How will you know it's done?]`,
      });
      const config = makeTestConfig();
      const prompt = buildPrompt(event, memory, config);
      // The actual task should be present
      expect(prompt).toContain("Build a hello world page");
      // Template placeholders should be stripped
      expect(prompt).not.toContain("[Optional:");
      expect(prompt).not.toContain("What do you want the agent to do?");
      expect(prompt).not.toContain("Success Criteria");
    });

    it("should not include uninitialized memory", () => {
      const event = makeEvent();
      const config = makeTestConfig();
      const prompt = buildPrompt(event, memory, config);
      // Default memory has [uninitialized] markers — should NOT be in prompt
      expect(prompt).not.toContain("[uninitialized]");
      expect(prompt).not.toContain("## Recent Memory");
    });

    it("should include real memory entries", () => {
      memory.appendMemory("User prefers TypeScript over JavaScript");
      const event = makeEvent();
      const config = makeTestConfig();
      const prompt = buildPrompt(event, memory, config);
      expect(prompt).toContain("## Recent Memory");
      expect(prompt).toContain("User prefers TypeScript");
    });

    it("should keep prompt within token budget for normal requests", () => {
      const event = makeEvent({
        body: "Say hello",
      });
      const config = makeTestConfig();
      const prompt = buildPrompt(event, memory, config);
      // Should be well under 6000 tokens (24K chars)
      expect(prompt.length).toBeLessThan(24000);
    });

    it("should truncate user message if extremely large", () => {
      const hugeBody = "A".repeat(50000); // 50K chars = ~12.5K tokens
      const event = makeEvent({
        type: "issues.opened",
        title: "Huge",
        body: hugeBody,
      });
      const config = makeTestConfig();
      const prompt = buildPrompt(event, memory, config);
      // Should be truncated — look for the truncation notice
      expect(prompt).toContain("truncated");
      expect(prompt.length).toBeLessThan(hugeBody.length);
    });
  });

  describe("estimateTokens", () => {
    it("should estimate tokens as chars/4", async () => {
      const { estimateTokens } = await import("../../src/agent/runner.ts");
      expect(estimateTokens("hello world")).toBe(3); // 11 chars / 4 = 2.75 -> 3
      expect(estimateTokens("")).toBe(0);
      expect(estimateTokens("a")).toBe(1);
    });
  });

  describe("extractFinalMessage", () => {
    it("should extract text from message_end event", () => {
      const tempFile = join(tempDir, "output.jsonl");
      const events = [
        JSON.stringify({ type: "message_start", message: { role: "assistant" } }),
        JSON.stringify({ type: "tool_call", name: "bash" }),
        JSON.stringify({
          type: "message_end",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "Hello, " },
              { type: "text", text: "world!" },
            ],
          },
        }),
      ];
      writeFileSync(tempFile, `${events.join("\n")}\n`);

      const result = extractFinalMessage(tempFile);
      expect(result).toBe("Hello, world!");
    });

    it("should return empty string for no message_end event", () => {
      const tempFile = join(tempDir, "no-end.jsonl");
      writeFileSync(tempFile, `${JSON.stringify({ type: "other" })}\n`);
      const result = extractFinalMessage(tempFile);
      expect(result).toBe("");
    });

    it("should use the last message_end if multiple exist", () => {
      const tempFile = join(tempDir, "multi.jsonl");
      const events = [
        JSON.stringify({
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text: "first" }] },
        }),
        JSON.stringify({
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text: "second" }] },
        }),
      ];
      writeFileSync(tempFile, `${events.join("\n")}\n`);
      const result = extractFinalMessage(tempFile);
      expect(result).toBe("second");
    });

    it("should skip non-text content blocks", () => {
      const tempFile = join(tempDir, "mixed.jsonl");
      writeFileSync(
        tempFile,
        `${JSON.stringify({
          type: "message_end",
          message: {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "internal" },
              { type: "text", text: "visible" },
              { type: "tool_use", name: "x" },
            ],
          },
        })}\n`,
      );
      const result = extractFinalMessage(tempFile);
      expect(result).toBe("visible");
    });

    it("should handle empty file", () => {
      const tempFile = join(tempDir, "empty.jsonl");
      writeFileSync(tempFile, "");
      const result = extractFinalMessage(tempFile);
      expect(result).toBe("");
    });

    it("should handle malformed lines", () => {
      const tempFile = join(tempDir, "malformed.jsonl");
      const content = [
        "this is not json",
        JSON.stringify({
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text: "found" }] },
        }),
      ].join("\n");
      writeFileSync(tempFile, `${content}\n`);
      const result = extractFinalMessage(tempFile);
      expect(result).toBe("found");
    });

    it("CRITICAL: should NEVER return a user message as the response", () => {
      // This is the bug that caused the agent to post the prompt as the response
      // when the LLM call failed. The user's message_end has the prompt text,
      // and if we don't filter by role, we'd return it as the "response".
      const tempFile = join(tempDir, "user-only.jsonl");
      const events = [
        // User message (the prompt) — should NEVER be returned
        JSON.stringify({
          type: "message_end",
          message: {
            role: "user",
            content: [{ type: "text", text: "write me a hello world html page" }],
          },
        }),
        // Assistant message_end with NO content (LLM failed) — should be skipped
        JSON.stringify({
          type: "message_end",
          message: {
            role: "assistant",
            content: [],
            stopReason: "error",
            errorMessage: "403: Forbidden",
          },
        }),
      ];
      writeFileSync(tempFile, `${events.join("\n")}\n`);
      const result = extractFinalMessage(tempFile);
      // Must be empty — NOT the user's prompt
      expect(result).toBe("");
      expect(result).not.toContain("hello world html page");
    });

    it("should skip assistant messages with error stopReason and no text", () => {
      const tempFile = join(tempDir, "error-assistant.jsonl");
      const events = [
        JSON.stringify({
          type: "message_end",
          message: {
            role: "assistant",
            content: [],
            stopReason: "error",
            errorMessage: "403: Forbidden",
          },
        }),
      ];
      writeFileSync(tempFile, `${events.join("\n")}\n`);
      const result = extractFinalMessage(tempFile);
      expect(result).toBe("");
    });
  });

  describe("extractErrorMessage", () => {
    it("should extract error message from failed assistant message_end", async () => {
      const { extractErrorMessage } = await import("../../src/agent/runner.ts");
      const tempFile = join(tempDir, "error.jsonl");
      const events = [
        JSON.stringify({
          type: "message_end",
          message: {
            role: "assistant",
            content: [],
            stopReason: "error",
            errorMessage: "403: Forbidden",
          },
        }),
      ];
      writeFileSync(tempFile, `${events.join("\n")}\n`);
      const result = extractErrorMessage(tempFile);
      expect(result).toBe("403: Forbidden");
    });

    it("should return null when no error", async () => {
      const { extractErrorMessage } = await import("../../src/agent/runner.ts");
      const tempFile = join(tempDir, "no-error.jsonl");
      writeFileSync(
        tempFile,
        `${JSON.stringify({
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
        })}\n`,
      );
      const result = extractErrorMessage(tempFile);
      expect(result).toBeNull();
    });
  });
});

import { afterEach, beforeEach } from "vitest";

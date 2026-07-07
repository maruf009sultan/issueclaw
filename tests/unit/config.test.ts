import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  IssueClawConfigSchema,
  getDefaultProvider,
  getProviderChain,
  loadConfig,
} from "../../src/config.ts";

describe("config", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "issueclaw-test-"));
    originalCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("IssueClawConfigSchema", () => {
    it("should accept a minimal config with one provider", () => {
      const minimal = {
        version: 1,
        providers: [{ type: "anthropic", model: "claude-opus-4-6" }],
      };
      const result = IssueClawConfigSchema.safeParse(minimal);
      expect(result.success).toBe(true);
    });

    it("should reject config with no providers", () => {
      const empty = { version: 1, providers: [] };
      const result = IssueClawConfigSchema.safeParse(empty);
      expect(result.success).toBe(false);
    });

    it("should apply defaults", () => {
      const result = IssueClawConfigSchema.parse({
        version: 1,
        providers: [{ type: "openai", model: "gpt-4o" }],
      });
      expect(result.memory.stateDir).toBe("./state");
      expect(result.github.onIssueOpened).toBe(true);
      expect(result.runtime.logLevel).toBe("info");
      expect(result.agent.timeoutMs).toBe(15 * 60 * 1000);
    });

    it("should reject invalid provider type", () => {
      const result = IssueClawConfigSchema.safeParse({
        version: 1,
        providers: [{ type: "invalid", model: "x" }],
      });
      expect(result.success).toBe(false);
    });

    it("should accept custom provider type", () => {
      const result = IssueClawConfigSchema.safeParse({
        version: 1,
        providers: [
          {
            type: "custom",
            model: "my-model",
            baseUrl: "https://api.example.com/v1",
          },
        ],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("loadConfig", () => {
    it("should load from issueclaw.config.json", () => {
      writeFileSync(
        "issueclaw.config.json",
        JSON.stringify({
          version: 1,
          providers: [{ type: "openai", model: "gpt-4o", apiKey: "test-key", default: true }],
        }),
      );
      const config = loadConfig();
      expect(config.providers).toHaveLength(1);
      expect(config.providers[0].type).toBe("openai");
      expect(config.providers[0].model).toBe("gpt-4o");
      expect(config.providers[0].apiKey).toBe("test-key");
    });

    it("should resolve env var references in apiKey", () => {
      process.env.TEST_API_KEY = "resolved-key";
      writeFileSync(
        "issueclaw.config.json",
        JSON.stringify({
          version: 1,
          providers: [{ type: "openai", model: "gpt-4o", apiKey: "${TEST_API_KEY}" }],
        }),
      );
      const config = loadConfig();
      expect(config.providers[0].apiKey).toBe("resolved-key");
      process.env.TEST_API_KEY = undefined;
    });

    it("should auto-generate Groq config if no config file exists", () => {
      // Clear any env API keys so we get the default Groq fallback
      const savedKeys = [
        "GROQ_API_KEY",
        "GEMINI_API_KEY",
        "CEREBRAS_API_KEY",
        "OPENROUTER_API_KEY",
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
      ];
      const savedVals: Record<string, string | undefined> = {};
      for (const k of savedKeys) {
        savedVals[k] = process.env[k];
        delete process.env[k];
      }
      const config = loadConfig();
      // Should default to Groq (works with simple chat mode's ~500 token usage)
      expect(config.providers.length).toBeGreaterThanOrEqual(1);
      expect(config.providers[0].type).toBe("groq");
      expect(config.providers[0].default).toBe(true);
      expect(config.providers[0].model).toBe("llama-3.3-70b-versatile");
      // Should have tools restricted (for token budget management)
      expect(config.agent.tools).toBeDefined();
      expect(config.agent.tools?.length).toBeGreaterThan(0);
      // Restore
      for (const k of savedKeys) {
        if (savedVals[k] !== undefined) process.env[k] = savedVals[k];
      }
    });

    it("should support legacy .pi/settings.json", () => {
      const piDir = join(tempDir, ".pi");
      const fs = require("node:fs");
      fs.mkdirSync(piDir, { recursive: true });
      fs.writeFileSync(
        join(piDir, "settings.json"),
        JSON.stringify({
          defaultProvider: "openai",
          defaultModel: "gpt-4o",
          defaultThinkingLevel: "medium",
        }),
      );
      const config = loadConfig();
      expect(config.providers[0].type).toBe("openai");
      expect(config.providers[0].model).toBe("gpt-4o");
    });

    it("should override provider via env vars", () => {
      process.env.ISSUECLAW_PROVIDER = "openrouter";
      process.env.ISSUECLAW_MODEL = "anthropic/claude-opus-4";
      process.env.OPENROUTER_API_KEY = "or-key";
      const config = loadConfig();
      expect(config.providers[0].type).toBe("openrouter");
      expect(config.providers[0].model).toBe("anthropic/claude-opus-4");
      expect(config.providers[0].apiKey).toBe("or-key");
      process.env.ISSUECLAW_PROVIDER = undefined;
      process.env.ISSUECLAW_MODEL = undefined;
      process.env.OPENROUTER_API_KEY = undefined;
    });
  });

  describe("getDefaultProvider", () => {
    it("should return the provider marked as default", () => {
      const config = IssueClawConfigSchema.parse({
        version: 1,
        providers: [
          { type: "anthropic", model: "claude-opus-4-6" },
          { type: "openai", model: "gpt-4o", default: true },
        ],
      });
      const provider = getDefaultProvider(config);
      expect(provider.type).toBe("openai");
    });

    it("should return first provider if none marked default", () => {
      const config = IssueClawConfigSchema.parse({
        version: 1,
        providers: [{ type: "anthropic", model: "claude-opus-4-6" }],
      });
      const provider = getDefaultProvider(config);
      expect(provider.type).toBe("anthropic");
    });
  });

  describe("getProviderChain", () => {
    it("should return default first, then others", () => {
      const config = IssueClawConfigSchema.parse({
        version: 1,
        providers: [
          { type: "anthropic", model: "claude-opus-4-6" },
          { type: "openai", model: "gpt-4o", default: true },
          { type: "openrouter", model: "anthropic/claude-opus-4" },
        ],
      });
      const chain = getProviderChain(config);
      expect(chain).toHaveLength(3);
      expect(chain[0].type).toBe("openai"); // default first
      expect(chain[1].type).toBe("anthropic");
      expect(chain[2].type).toBe("openrouter");
    });
  });
});

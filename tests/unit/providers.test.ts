import { describe, expect, it } from "vitest";
import type { ProviderConfig } from "../../src/config.ts";
import { anthropicProvider } from "../../src/providers/anthropic.ts";
import { cerebrasProvider } from "../../src/providers/cerebras.ts";
import { customProvider } from "../../src/providers/custom.ts";
import { geminiProvider } from "../../src/providers/gemini.ts";
import { groqProvider } from "../../src/providers/groq.ts";
import {
  buildProviderArgs,
  getProvider,
  listProviderTypes,
  validateProvider,
} from "../../src/providers/index.ts";
import { ollamaProvider } from "../../src/providers/ollama.ts";
import { openaiProvider } from "../../src/providers/openai.ts";
import { openrouterProvider } from "../../src/providers/openrouter.ts";

describe("providers", () => {
  describe("anthropic", () => {
    it("should build args with provider and model", () => {
      const config: ProviderConfig = {
        type: "anthropic",
        model: "claude-opus-4-6",
        apiKey: "sk-ant-test",
        thinking: "high",
      };
      const result = anthropicProvider.buildArgs(config);
      expect(result.args).toContain("--provider");
      expect(result.args).toContain("anthropic");
      expect(result.args).toContain("--model");
      expect(result.args).toContain("claude-opus-4-6");
      expect(result.args).toContain("--thinking");
      expect(result.args).toContain("high");
      expect(result.env.ANTHROPIC_API_KEY).toBe("sk-ant-test");
    });

    it("should validate requires model", () => {
      expect(anthropicProvider.validate({ type: "anthropic", model: "" } as ProviderConfig)).toBe(
        "Anthropic provider requires a model",
      );
    });

    it("should validate requires api key", () => {
      expect(
        anthropicProvider.validate({
          type: "anthropic",
          model: "claude-opus-4-6",
        } as ProviderConfig),
      ).toBe("Anthropic provider requires ANTHROPIC_API_KEY");
    });

    it("should pass validation with all fields", () => {
      expect(
        anthropicProvider.validate({
          type: "anthropic",
          model: "claude-opus-4-6",
          apiKey: "sk-ant-test",
        }),
      ).toBeNull();
    });
  });

  describe("openai", () => {
    it("should build args with custom base URL", () => {
      const config: ProviderConfig = {
        type: "openai",
        model: "gpt-4o",
        apiKey: "sk-test",
        baseUrl: "https://api.together.xyz/v1",
      };
      const result = openaiProvider.buildArgs(config);
      expect(result.args).toContain("openai");
      expect(result.env.OPENAI_API_KEY).toBe("sk-test");
      expect(result.env.OPENAI_BASE_URL).toBe("https://api.together.xyz/v1");
    });

    it("should pass headers as JSON env", () => {
      const config: ProviderConfig = {
        type: "openai",
        model: "gpt-4o",
        apiKey: "sk-test",
        headers: { "X-Custom": "value" },
      };
      const result = openaiProvider.buildArgs(config);
      expect(result.env.OPENAI_HEADERS).toBe(JSON.stringify({ "X-Custom": "value" }));
    });
  });

  describe("openrouter", () => {
    it("should build args with openrouter provider", () => {
      const config: ProviderConfig = {
        type: "openrouter",
        model: "anthropic/claude-opus-4",
        apiKey: "or-test",
      };
      const result = openrouterProvider.buildArgs(config);
      expect(result.args).toContain("openrouter");
      expect(result.env.OPENROUTER_API_KEY).toBe("or-test");
    });
  });

  describe("ollama", () => {
    it("should use openai provider with localhost base URL", () => {
      const config: ProviderConfig = {
        type: "ollama",
        model: "llama3.1:70b",
      };
      const result = ollamaProvider.buildArgs(config);
      expect(result.args).toContain("openai"); // Ollama is OpenAI-compatible
      expect(result.env.OPENAI_BASE_URL).toBe("http://localhost:11434/v1");
      expect(result.env.OPENAI_API_KEY).toBe("ollama");
    });

    it("should not require API key", () => {
      expect(ollamaProvider.validate({ type: "ollama", model: "llama3.1:70b" })).toBeNull();
    });
  });

  describe("custom", () => {
    it("should require baseUrl", () => {
      expect(customProvider.validate({ type: "custom", model: "my-model" } as ProviderConfig)).toBe(
        "Custom provider requires baseUrl",
      );
    });

    it("should build args with custom base URL", () => {
      const config: ProviderConfig = {
        type: "custom",
        model: "my-model",
        baseUrl: "https://api.mybackend.com/v1",
        apiKey: "my-key",
      };
      const result = customProvider.buildArgs(config);
      expect(result.env.OPENAI_BASE_URL).toBe("https://api.mybackend.com/v1");
      expect(result.env.OPENAI_API_KEY).toBe("my-key");
    });
  });

  describe("groq", () => {
    it("should use native groq provider with GROQ_API_KEY env", () => {
      const config: ProviderConfig = {
        type: "groq",
        model: "llama-3.3-70b-versatile",
        apiKey: "gsk_test",
      };
      const result = groqProvider.buildArgs(config);
      // Pi has native groq support — uses --provider groq (not openai)
      expect(result.args).toContain("groq");
      expect(result.args).toContain("llama-3.3-70b-versatile");
      expect(result.env.GROQ_API_KEY).toBe("gsk_test");
    });

    it("should warn about missing GROQ_API_KEY", () => {
      expect(
        groqProvider.validate({ type: "groq", model: "llama-3.3-70b-versatile" } as ProviderConfig),
      ).toContain("GROQ_API_KEY");
    });

    it("should pass validation with api key", () => {
      expect(
        groqProvider.validate({
          type: "groq",
          model: "llama-3.3-70b-versatile",
          apiKey: "gsk_test",
        }),
      ).toBeNull();
    });

    it("should require model", () => {
      expect(
        groqProvider.validate({ type: "groq", model: "", apiKey: "k" } as ProviderConfig),
      ).toBe("Groq provider requires a model");
    });
  });

  describe("gemini", () => {
    it("should use native google provider with GEMINI_API_KEY env", () => {
      const config: ProviderConfig = {
        type: "gemini",
        model: "gemini-2.0-flash",
        apiKey: "AIzaSyTest",
      };
      const result = geminiProvider.buildArgs(config);
      // Pi has native google support — uses --provider google
      expect(result.args).toContain("google");
      expect(result.args).toContain("gemini-2.0-flash");
      expect(result.env.GEMINI_API_KEY).toBe("AIzaSyTest");
    });

    it("should warn about missing GEMINI_API_KEY", () => {
      expect(
        geminiProvider.validate({ type: "gemini", model: "gemini-2.0-flash" } as ProviderConfig),
      ).toContain("GEMINI_API_KEY");
    });

    it("should pass validation with api key", () => {
      expect(
        geminiProvider.validate({
          type: "gemini",
          model: "gemini-2.0-flash",
          apiKey: "AIzaSyTest",
        }),
      ).toBeNull();
    });
  });

  describe("cerebras", () => {
    it("should use native cerebras provider with CEREBRAS_API_KEY env", () => {
      const config: ProviderConfig = {
        type: "cerebras",
        model: "llama-3.3-70b",
        apiKey: "csk-test",
      };
      const result = cerebrasProvider.buildArgs(config);
      expect(result.args).toContain("cerebras");
      expect(result.args).toContain("llama-3.3-70b");
      expect(result.env.CEREBRAS_API_KEY).toBe("csk-test");
    });

    it("should warn about missing CEREBRAS_API_KEY", () => {
      expect(
        cerebrasProvider.validate({ type: "cerebras", model: "llama-3.3-70b" } as ProviderConfig),
      ).toContain("CEREBRAS_API_KEY");
    });

    it("should pass validation with api key", () => {
      expect(
        cerebrasProvider.validate({
          type: "cerebras",
          model: "llama-3.3-70b",
          apiKey: "csk-test",
        }),
      ).toBeNull();
    });
  });

  describe("registry", () => {
    it("should list all provider types", () => {
      const types = listProviderTypes();
      expect(types).toContain("gemini");
      expect(types).toContain("cerebras");
      expect(types).toContain("anthropic");
      expect(types).toContain("openai");
      expect(types).toContain("openrouter");
      expect(types).toContain("ollama");
      expect(types).toContain("groq");
      expect(types).toContain("custom");
    });

    it("should throw on unknown provider type", () => {
      expect(() => getProvider("unknown")).toThrow();
    });

    it("should validate known provider", () => {
      const error = validateProvider({
        type: "anthropic",
        model: "claude-opus-4-6",
        apiKey: "key",
      });
      expect(error).toBeNull();
    });

    it("should build args via registry", () => {
      const result = buildProviderArgs({
        type: "openai",
        model: "gpt-4o",
        apiKey: "sk-test",
      });
      expect(result.args).toContain("openai");
      expect(result.env.OPENAI_API_KEY).toBe("sk-test");
    });
  });
});

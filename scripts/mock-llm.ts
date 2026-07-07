#!/usr/bin/env bun
/**
 * Mock LLM server for live testing.
 *
 * Implements a minimal OpenAI-compatible /v1/chat/completions endpoint
 * that returns canned responses. This lets us test the full pi →
 * provider → response pipeline without a real API key.
 *
 * Responses are written to mirror what pi expects from OpenAI-compatible APIs.
 */

import { log } from "../src/utils/log.ts";

const PORT = Number(process.env.MOCK_LLM_PORT ?? 9876);
const HOST = "127.0.0.1";

let requestCount = 0;
const requests: Array<{ model: string; messages: unknown; timestamp: string }> = [];

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  development: false,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Health check
    if (path === "/health" || path === "/") {
      return new Response(JSON.stringify({ status: "ok", requests: requestCount }), {
        headers: { "content-type": "application/json" },
      });
    }

    // OpenAI-compatible chat completions
    if (path === "/v1/chat/completions" && req.method === "POST") {
      requestCount++;
      const body = (await req.json()) as {
        model: string;
        messages: Array<{ role: string; content: string }>;
        stream?: boolean;
        tools?: unknown[];
      };
      requests.push({
        model: body.model,
        messages: body.messages,
        timestamp: new Date().toISOString(),
      });

      log.info("mock-llm: request received", {
        count: requestCount,
        model: body.model,
        msgCount: body.messages?.length ?? 0,
        stream: body.stream,
      });

      // Generate a helpful canned response
      const lastUserMsg = [...(body.messages ?? [])].reverse().find((m) => m.role === "user");
      // Content can be a string OR an array of content blocks (OpenAI format)
      const rawContent = lastUserMsg?.content ?? "";
      const userText =
        typeof rawContent === "string"
          ? rawContent
          : Array.isArray(rawContent)
            ? rawContent
                .map((c: { type?: string; text?: string }) =>
                  c?.type === "text" ? (c.text ?? "") : "",
                )
                .join("")
            : String(rawContent);
      const response = generateResponse(userText, body.model);

      if (body.stream) {
        // SSE streaming response
        const stream = new ReadableStream({
          start(controller) {
            const chunks = [
              {
                id: `chatcmpl-mock-${requestCount}`,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: body.model,
                choices: [
                  { index: 0, delta: { role: "assistant", content: "" }, finish_reason: null },
                ],
              },
              ...response.split("").map((ch) => ({
                id: `chatcmpl-mock-${requestCount}`,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: body.model,
                choices: [{ index: 0, delta: { content: ch }, finish_reason: null }],
              })),
              {
                id: `chatcmpl-mock-${requestCount}`,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: body.model,
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              },
            ];
            for (const chunk of chunks) {
              controller.enqueue(`data: ${JSON.stringify(chunk)}\n\n`);
            }
            controller.enqueue("data: [DONE]\n\n");
            controller.close();
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        });
      }

      // Non-streaming response
      return new Response(
        JSON.stringify({
          id: `chatcmpl-mock-${requestCount}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: body.model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: response },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: Math.ceil((userText?.length ?? 0) / 4),
            completion_tokens: Math.ceil(response.length / 4),
            total_tokens: Math.ceil((userText?.length ?? 0 + response.length) / 4),
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    }

    // Models endpoint
    if (path === "/v1/models") {
      return new Response(
        JSON.stringify({
          object: "list",
          data: [
            { id: "llama-3.3-70b-versatile", object: "model", owned_by: "groq" },
            { id: "llama-3.1-8b-instant", object: "model", owned_by: "groq" },
            { id: "mock-model", object: "model", owned_by: "mock" },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      );
    }

    // Request log (for testing)
    if (path === "/requests") {
      return new Response(JSON.stringify({ count: requestCount, requests }, null, 2), {
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "not found", path }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  },
});

function generateResponse(userText: string, model: string): string {
  const text = userText.toLowerCase();
  if (text.includes("hatch") || text.includes("who am i") || text.includes("who are you")) {
    return `Hey! I'm a mock agent running on ${model}. I'd love to figure out my identity with you. What should we call me?`;
  }
  if (text.includes("hello") || text.includes("hi") || text.includes("hey")) {
    return `Hello! I'm a mock agent running on ${model}. I received your message: "${userText.slice(0, 100)}${userText.length > 100 ? "..." : ""}". How can I help?`;
  }
  if (text.includes("remember")) {
    return `Got it — I'll remember that. (Mock mode: would have appended to state/memory.md)`;
  }
  // Default helpful response
  return `I received your message and I'm responding via the mock LLM server (model: ${model}).

Your request was:
"""
${userText.slice(0, 500)}${userText.length > 500 ? "...(truncated)" : ""}
"""

This is a canned response from the mock server, which proves the full pipeline works:
1. ✅ GitHub event was parsed
2. ✅ Prompt was built with memory/personality context
3. ✅ Provider args were constructed (OpenAI-compatible)
4. ✅ pi was invoked as a subprocess
5. ✅ pi made an HTTP request to the LLM endpoint
6. ✅ Response was received and parsed
7. ✅ This response will be posted as a GitHub comment

To use a real LLM, set GROQ_API_KEY (free at https://console.groq.com/keys) and remove the MOCK_LLM_BASE_URL override.`;
}

log.info(`mock-llm server running on http://${HOST}:${PORT}`);
log.info(`health: curl http://${HOST}:${PORT}/health`);
log.info(`requests: curl http://${HOST}:${PORT}/requests`);

// Keep process alive
process.on("SIGINT", () => {
  log.info("mock-llm shutting down");
  server.stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  server.stop();
  process.exit(0);
});

export { server };

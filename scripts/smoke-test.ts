#!/usr/bin/env bun
/**
 * Smoke test: verify pi can be invoked and produces JSONL output.
 * This test uses a mock JSONL file to verify the parsing pipeline.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractFinalMessage } from "../src/agent/runner.ts";

const tempDir = mkdtempSync(join(tmpdir(), "issueclaw-smoke-"));

// Test 1: Pi is installed and responds to --version
console.log("Test 1: Pi version check...");
const proc = Bun.spawn(["bunx", "pi", "--version"], { stdout: "pipe", stderr: "pipe" });
const exitCode = await proc.exited;
const version = (await new Response(proc.stdout).text()).trim();
if (exitCode === 0 && version.length > 0) {
  console.log(`  ✓ Pi is installed: ${version}`);
} else {
  console.error(`  ✗ Pi check failed (exit ${exitCode})`);
  process.exit(1);
}

// Test 2: extractFinalMessage parses JSONL correctly
console.log("Test 2: extractFinalMessage...");
const mockJsonl = join(tempDir, "mock.jsonl");
const mockEvents = [
  JSON.stringify({ type: "message_start", message: { role: "assistant" } }),
  JSON.stringify({
    type: "message_end",
    message: {
      content: [
        { type: "thinking", thinking: "Let me think..." },
        { type: "text", text: "Hello from the agent!" },
      ],
    },
  }),
];
writeFileSync(mockJsonl, `${mockEvents.join("\n")}\n`);
const extracted = extractFinalMessage(mockJsonl);
if (extracted === "Hello from the agent!") {
  console.log("  ✓ extractFinalMessage works correctly");
} else {
  console.error(`  ✗ extractFinalMessage returned: "${extracted}"`);
  process.exit(1);
}

// Test 3: Config loads
console.log("Test 3: Config loading...");
const { loadConfig } = await import("../src/config.ts");
const config = loadConfig();
if (config.providers.length > 0) {
  console.log(`  ✓ Config loaded with ${config.providers.length} provider(s)`);
} else {
  console.error("  ✗ No providers in config");
  process.exit(1);
}

// Test 4: Memory store initializes
console.log("Test 4: Memory store...");
const { MemoryStore } = await import("../src/memory/store.ts");
const stateDir = join(tempDir, "state");
const memory = new MemoryStore({ ...config.memory, stateDir });
memory.init();
const memContent = memory.readMemory();
const persContent = memory.readPersonality();
const userContent = memory.readUser();
if (memContent && persContent && userContent) {
  console.log("  ✓ Memory store initialized with all default files");
} else {
  console.error("  ✗ Memory store missing files");
  process.exit(1);
}

// Test 5: Provider registry
console.log("Test 5: Provider registry...");
const { listProviderTypes } = await import("../src/providers/index.ts");
const types = listProviderTypes();
if (types.length >= 5) {
  console.log(`  ✓ ${types.length} providers registered: ${types.join(", ")}`);
} else {
  console.error(`  ✗ Only ${types.length} providers`);
  process.exit(1);
}

// Test 6: GitHub event parsing
console.log("Test 6: Event parsing...");
const testEvent = {
  action: "opened",
  issue: {
    number: 1,
    title: "Test",
    body: "Body",
    user: { login: "tester" },
    author_association: "OWNER",
    labels: [{ name: "bug" }],
  },
};
const eventPath = join(tempDir, "event.json");
writeFileSync(eventPath, JSON.stringify(testEvent));
process.env.GITHUB_EVENT_PATH = eventPath;
process.env.GITHUB_EVENT_NAME = "issues";
const { parseEvent } = await import("../src/github/events.ts");
const event = parseEvent();
if (event.type === "issues.opened" && event.issueNumber === 1) {
  console.log(`  ✓ Event parsed: ${event.type}, issue #${event.issueNumber}`);
} else {
  console.error(`  ✗ Event parsing failed: ${event.type}`);
  process.exit(1);
}

console.log("\n✅ All smoke tests passed!");
process.exit(0);

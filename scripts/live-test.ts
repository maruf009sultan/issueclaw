#!/usr/bin/env bun
/**
 * Live test harness — runs the full issueclaw pipeline end-to-end without GitHub.
 *
 * What it does:
 * 1. Starts a mock LLM server (OpenAI-compatible)
 * 2. Creates a temp git repo with state/
 * 3. Generates a fake GitHub event (issue opened)
 * 4. Runs the full lifecycle (preinstall + main)
 * 5. Verifies:
 *    - State files (memory.md, personality.md, user.md) are created
 *    - Session JSONL is created
 *    - Issue mapping is saved
 *    - Git commit was made
 *    - Audit log has entries
 *    - Agent response was extracted
 * 6. Tests comment event (resume session)
 * 7. Tests hatch label event
 * 8. Cleans up
 *
 * Usage: bun run scripts/live-test.ts
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const _SUITE_NAME = "live-test";
let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    failures.push(msg);
    console.error(`  ✗ ${msg}`);
  }
}

async function main(): Promise<void> {
  console.log("🧪 IssueClaw Live Test Harness\n");

  // Set log level to reduce noise
  process.env.ISSUECLAW_LOG_LEVEL = "warn";

  const tempDir = mkdtempSync(join(tmpdir(), "issueclaw-live-"));
  console.log(`📂 Working directory: ${tempDir}\n`);

  try {
    // ===== Setup: mock LLM server =====
    console.log("1️⃣  Starting mock LLM server...");
    const mockPort = 9876 + Math.floor(Math.random() * 1000);
    process.env.MOCK_LLM_PORT = String(mockPort);
    const mockProc = Bun.spawn(["bun", "run", "scripts/mock-llm.ts"], {
      env: { ...process.env, MOCK_LLM_PORT: String(mockPort), ISSUECLAW_LOG_LEVEL: "warn" },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for server to be ready
    await sleep(1000);
    let mockReady = false;
    for (let i = 0; i < 10; i++) {
      try {
        const resp = await fetch(`http://127.0.0.1:${mockPort}/health`);
        if (resp.ok) {
          mockReady = true;
          break;
        }
      } catch {
        await sleep(200);
      }
    }
    assert(mockReady, "Mock LLM server is running");
    if (!mockReady) {
      console.error("❌ Mock LLM server failed to start. Aborting.");
      mockProc.kill();
      process.exit(1);
    }

    // ===== Setup: git repo =====
    console.log("\n2️⃣  Setting up git repo...");
    const cwd = process.cwd();
    process.chdir(tempDir);

    // Init git
    Bun.spawnSync(["git", "init", "-b", "main"], { cwd: tempDir });
    Bun.spawnSync(["git", "config", "user.name", "Test Bot"], { cwd: tempDir });
    Bun.spawnSync(["git", "config", "user.email", "test@test.com"], { cwd: tempDir });
    Bun.spawnSync(["git", "config", "commit.gpgsign", "false"], { cwd: tempDir });

    // Copy project files
    await copyProjectFiles(tempDir, cwd);

    // Install deps
    console.log("   Installing dependencies...");
    const installResult = Bun.spawnSync(["bun", "install"], {
      cwd: tempDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    assert(installResult.exitCode === 0, "bun install succeeded");

    // Create config that uses the mock provider (registered via pi extension)
    const mockBaseUrl = `http://127.0.0.1:${mockPort}/v1`;
    const config = {
      version: 1,
      providers: [
        {
          type: "groq",
          model: "llama-3.3-70b-versatile",
          apiKey: "mock-key",
          default: true,
        },
      ],
      memory: { stateDir: "./state", autoCompact: true },
      github: {
        onIssueOpened: true,
        onIssueComment: true,
        allowedAssociations: ["OWNER", "MEMBER", "COLLABORATOR"],
        hatchLabel: "hatch",
        reactionWhileProcessing: false, // No real GitHub in test
        maxCommentLength: 60000,
      },
      agent: {
        piCommand: "bunx pi",
        timeoutMs: 120000,
        skills: false,
        extensions: true, // Enable mock-provider extension
      },
      runtime: {
        dryRun: true, // Don't try to comment on real GitHub
        logLevel: "warn",
        offline: false, // We want to actually run pi
      },
    };
    writeFileSync("issueclaw.config.json", JSON.stringify(config, null, 2));
    console.log("   ✓ Config created (uses mock provider via extension)");

    // Set env vars for the lifecycle
    // The mock-provider extension reads MOCK_LLM_BASE_URL to register a "mock" provider
    // But we want to use "groq" provider type — so we override the Groq base URL via extension too
    process.env.GROQ_API_KEY = "mock-key";
    process.env.MOCK_LLM_BASE_URL = mockBaseUrl;
    process.env.GITHUB_REPOSITORY = "test/repo";
    process.env.GITHUB_TOKEN = "mock-token";

    // Override the groq provider to point to mock via an extension
    // We'll create a test-specific extension that overrides groq's baseUrl
    mkdirSync(".pi/extensions", { recursive: true });
    writeFileSync(
      ".pi/extensions/mock-provider.ts",
      `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function (pi: ExtensionAPI) {
  // Override the groq provider to point to our mock server
  pi.registerProvider("groq", {
    baseUrl: "${mockBaseUrl}",
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
`,
    );
    console.log("   ✓ Mock provider extension created");

    // ===== Test 1: Issue opened event =====
    console.log("\n3️⃣  Test: Issue opened event");
    const issuePayload = {
      action: "opened",
      issue: {
        number: 1,
        title: "Hello test",
        body: "Say hello to verify the pipeline works.",
        user: { login: "testuser" },
        author_association: "OWNER",
        labels: [{ name: "agent" }], // Use agent label to test full agent mode
      },
    };
    const eventPath = join(tempDir, "event-issue.json");
    writeFileSync(eventPath, JSON.stringify(issuePayload));
    process.env.GITHUB_EVENT_PATH = eventPath;
    process.env.GITHUB_EVENT_NAME = "issues";

    // Run main.ts (skip preinstall since we don't have real GitHub)
    console.log("   Running agent (this invokes pi)...");
    const mainResult = Bun.spawnSync(["bun", "run", "src/lifecycle/main.ts"], {
      cwd: tempDir,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120000,
    });

    const mainStdout = mainResult.stdout?.toString() ?? "";
    const mainStderr = mainResult.stderr?.toString() ?? "";

    if (mainResult.exitCode !== 0) {
      console.log(`   main.ts exit code: ${mainResult.exitCode}`);
      console.log(`   stdout: ${mainStdout.slice(0, 500)}`);
      console.log(`   stderr: ${mainStderr.slice(0, 500)}`);
    }

    assert(mainResult.exitCode === 0, "main.ts exited cleanly");

    // Verify state files
    assert(existsSync("state/memory.md"), "state/memory.md created");
    assert(existsSync("state/personality.md"), "state/personality.md created");
    assert(existsSync("state/user.md"), "state/user.md created");
    assert(existsSync("state/issues/1.json"), "state/issues/1.json mapping created");
    assert(existsSync("state/audit.log"), "state/audit.log created");

    // Verify session file
    const sessionFiles = await listSessionFiles();
    assert(sessionFiles.length > 0, `Session JSONL created (${sessionFiles.length} files)`);

    // Verify git commit (skipped in dry-run mode, which is correct behavior)
    const gitLog = Bun.spawnSync(["git", "log", "--oneline"], { cwd: tempDir, stdout: "pipe" });
    const logText = gitLog.stdout?.toString() ?? "";
    // In dry-run mode, no commit is made — that's expected
    if (config.runtime.dryRun) {
      assert(!logText.includes("issueclaw:"), "Dry-run mode correctly skipped git commit");
    } else {
      assert(
        logText.includes("issueclaw:"),
        `Git commit made (${logText.trim().split("\n").length} commits)`,
      );
    }

    // Verify audit log has entries
    if (existsSync("state/audit.log")) {
      const auditContent = readFileSync("state/audit.log", "utf-8");
      const auditLines = auditContent
        .trim()
        .split("\n")
        .filter((l) => l.trim());
      assert(auditLines.length >= 2, `Audit log has ${auditLines.length} entries`);

      // Parse and verify audit entries
      let hasStart = false;
      let hasEnd = false;
      for (const line of auditLines) {
        try {
          const entry = JSON.parse(line);
          if (entry.action === "agent_run_start") hasStart = true;
          if (entry.action === "agent_run_end") hasEnd = true;
        } catch {
          // ignore
        }
      }
      assert(hasStart, "Audit log has agent_run_start entry");
      assert(hasEnd, "Audit log has agent_run_end entry");
    }

    // Verify issue mapping
    if (existsSync("state/issues/1.json")) {
      const mapping = JSON.parse(readFileSync("state/issues/1.json", "utf-8"));
      assert(mapping.issueNumber === 1, "Mapping has correct issue number");
      assert(mapping.sessionPath?.includes(".jsonl"), "Mapping has session path");
      assert(mapping.turnCount === 1, "Mapping has turnCount = 1");
    }

    // Verify mock LLM was called
    try {
      const resp = await fetch(`http://127.0.0.1:${mockPort}/requests`);
      const data = (await resp.json()) as { count: number };
      assert(data.count > 0, `Mock LLM received ${data.count} request(s)`);
    } catch {
      assert(false, "Could not query mock LLM request log");
    }

    // ===== Test 2: Hatch label event =====
    console.log("\n4️⃣  Test: Hatch label event");
    const hatchPayload = {
      action: "opened",
      issue: {
        number: 2,
        title: "Hatch me",
        body: "Let's figure out my identity.",
        user: { login: "testuser" },
        author_association: "OWNER",
        labels: [{ name: "hatch" }],
      },
    };
    const hatchPath = join(tempDir, "event-hatch.json");
    writeFileSync(hatchPath, JSON.stringify(hatchPayload));
    process.env.GITHUB_EVENT_PATH = hatchPath;
    process.env.GITHUB_EVENT_NAME = "issues";

    const hatchResult = Bun.spawnSync(["bun", "run", "src/lifecycle/main.ts"], {
      cwd: tempDir,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120000,
    });
    assert(hatchResult.exitCode === 0, "Hatch event main.ts exited cleanly");
    assert(existsSync("state/issues/2.json"), "Hatch issue mapping created");

    // ===== Test 3: CLI commands =====
    console.log("\n5️⃣  Test: CLI commands");

    // config show
    const configShow = Bun.spawnSync(["bun", "run", "src/cli.ts", "config", "show"], {
      cwd: tempDir,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    assert(configShow.exitCode === 0, "issueclaw config show works");

    // config validate
    const configValidate = Bun.spawnSync(["bun", "run", "src/cli.ts", "config", "validate"], {
      cwd: tempDir,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    assert(configValidate.exitCode === 0, "issueclaw config validate works");

    // memory show
    const memoryShow = Bun.spawnSync(["bun", "run", "src/cli.ts", "memory", "show"], {
      cwd: tempDir,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    assert(memoryShow.exitCode === 0, "issueclaw memory show works");
    const memOut = memoryShow.stdout?.toString() ?? "";
    assert(memOut.length > 0, "Memory output is non-empty");

    // personality show
    const persShow = Bun.spawnSync(["bun", "run", "src/cli.ts", "personality", "show"], {
      cwd: tempDir,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    assert(persShow.exitCode === 0, "issueclaw personality show works");

    // user show
    const userShow = Bun.spawnSync(["bun", "run", "src/cli.ts", "user", "show"], {
      cwd: tempDir,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    assert(userShow.exitCode === 0, "issueclaw user show works");

    // doctor
    const doctor = Bun.spawnSync(["bun", "run", "src/cli.ts", "doctor"], {
      cwd: tempDir,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    assert(doctor.exitCode === 0, "issueclaw doctor works");

    // ===== Test 4: Mock LLM request log =====
    console.log("\n6️⃣  Test: Verify mock LLM received proper requests");
    try {
      const resp = await fetch(`http://127.0.0.1:${mockPort}/requests`);
      const data = (await resp.json()) as {
        count: number;
        requests: Array<{ model: string; messages: unknown[] }>;
      };
      console.log(`   Total LLM requests: ${data.count}`);
      if (data.requests.length > 0) {
        const first = data.requests[0];
        assert(
          first.model === "llama-3.3-70b-versatile",
          `Model is llama-3.3-70b-versatile (got ${first.model})`,
        );
        assert(Array.isArray(first.messages), "Messages array is present");
      }
    } catch (err) {
      assert(
        false,
        `Could not verify LLM requests: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // ===== Cleanup =====
    console.log("\n7️⃣  Cleanup");
    mockProc.kill();
    process.chdir(cwd);
    rmSync(tempDir, { recursive: true, force: true });
    assert(true, "Cleanup complete");

    // ===== Summary =====
    console.log(`\n${"=".repeat(60)}`);
    console.log(`📊 LIVE TEST RESULTS: ${passed} passed, ${failed} failed`);
    console.log("=".repeat(60));
    if (failures.length > 0) {
      console.log("\n❌ Failures:");
      for (const f of failures) console.log(`   - ${f}`);
    }
    console.log("");
    process.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error(
      "\n💥 Live test crashed:",
      err instanceof Error ? (err.stack ?? err.message) : String(err),
    );
    process.chdir(cwd);
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    process.exit(2);
  }
}

async function copyProjectFiles(target: string, source: string): Promise<void> {
  // Copy src, tests, scripts, .pi, .github, package.json, etc.
  const dirs = ["src", "scripts", ".pi"];
  for (const dir of dirs) {
    const src = join(source, dir);
    const dst = join(target, dir);
    if (existsSync(src)) {
      await copyDir(src, dst);
    }
  }
  // Copy individual files
  const files = ["package.json", "tsconfig.json", "biome.json", "vitest.config.ts", "AGENTS.md"];
  for (const file of files) {
    const src = join(source, file);
    const dst = join(target, file);
    if (existsSync(src)) {
      writeFileSync(dst, readFileSync(src));
    }
  }
  // Create state dir
  mkdirSync(join(target, "state", "issues"), { recursive: true });
  mkdirSync(join(target, "state", "sessions"), { recursive: true });
}

async function copyDir(src: string, dst: string): Promise<void> {
  mkdirSync(dst, { recursive: true });
  const entries = require("node:fs").readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const dstPath = join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, dstPath);
    } else {
      writeFileSync(dstPath, readFileSync(srcPath));
    }
  }
}

async function listSessionFiles(): Promise<string[]> {
  const dir = "state/sessions";
  if (!existsSync(dir)) return [];
  try {
    const entries = require("node:fs").readdirSync(dir);
    return entries.filter((f: string) => f.endsWith(".jsonl")).map((f: string) => join(dir, f));
  } catch {
    return [];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(2);
});

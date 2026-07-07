#!/usr/bin/env bun
/**
 * IssueClaw CLI.
 *
 * Usage:
 *   issueclaw run                     Run the agent lifecycle (preinstall + main)
 *   issueclaw run --dry-run           Dry-run mode (no commits, no comments)
 *   issueclaw run --event <path>      Use a custom event payload
 *   issueclaw run --offline           Offline mode (mock pi invocation)
 *   issueclaw config show             Show current configuration
 *   issueclaw config validate         Validate config file
 *   issueclaw memory show             Show current memory state
 *   issueclaw memory search <query>   Search memory log
 *   issueclaw memory append <text>    Append to memory log
 *   issueclaw personality show        Show current personality
 *   issueclaw personality set <file>  Set personality from file
 *   issueclaw user show               Show user profile
 *   issueclaw test event <type>       Generate a test event payload
 *   issueclaw test lifecycle          Run lifecycle against a mock event
 *   issueclaw doctor                  Diagnose configuration & environment
 *   issueclaw version                 Show version
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildPrompt, runAgent } from "./agent/runner.ts";
import { type IssueClawConfig, loadConfig } from "./config.ts";
import { parseEvent } from "./github/events.ts";
import { MemoryStore } from "./memory/store.ts";
import { log } from "./utils/log.ts";

const VERSION = "2.0.0";

interface ParsedArgs {
  command: string;
  subcommand?: string;
  flags: Record<string, string | boolean>;
  positional: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  const command = args[0] ?? "help";
  let subcommand: string | undefined;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg?.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (arg && !subcommand) {
      subcommand = arg;
    } else if (arg) {
      positional.push(arg);
    }
  }

  return { command, subcommand, flags, positional };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // Apply global flags
  if (args.flags["log-level"]) {
    process.env.ISSUECLAW_LOG_LEVEL = args.flags["log-level"] as string;
  }
  if (args.flags["dry-run"]) {
    process.env.ISSUECLAW_DRY_RUN = "true";
  }

  switch (args.command) {
    case "version":
      console.log(`issueclaw v${VERSION}`);
      break;

    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;

    case "run":
      await cmdRun(args);
      break;

    case "config":
      await cmdConfig(args);
      break;

    case "memory":
      await cmdMemory(args);
      break;

    case "personality":
      await cmdPersonality(args);
      break;

    case "user":
      await cmdUser(args);
      break;

    case "test":
      await cmdTest(args);
      break;

    case "doctor":
      await cmdDoctor(args);
      break;

    default:
      console.error(`Unknown command: ${args.command}`);
      printHelp();
      process.exit(2);
  }
}

async function cmdRun(args: ParsedArgs): Promise<void> {
  const config = loadConfig();
  log.info("issueclaw run", { dryRun: config.runtime.dryRun, offline: config.runtime.offline });

  // If event path provided, set GITHUB_EVENT_PATH
  if (args.flags.event && typeof args.flags.event === "string") {
    process.env.GITHUB_EVENT_PATH = args.flags.event;
    process.env.GITHUB_EVENT_NAME = (args.flags["event-name"] as string) ?? "issues";
  }

  // Parse event
  const event = parseEvent();
  log.info("event", { type: event.type, issue: event.issueNumber, author: event.author });

  // Initialize memory
  const memory = new MemoryStore(config.memory);
  memory.init();

  // Run agent
  const result = await runAgent({
    config,
    memory,
    event,
    executable: !config.runtime.offline,
  });

  if (result.success) {
    console.log("\n--- Agent Response ---\n");
    console.log(result.response);
    console.log("\n--- End ---\n");
  } else {
    console.error(`Agent failed: ${result.error}`);
    process.exit(1);
  }
}

async function cmdConfig(args: ParsedArgs): Promise<void> {
  const config = loadConfig();

  switch (args.subcommand) {
    case "show":
      console.log(JSON.stringify(config, null, 2));
      break;

    case "validate": {
      const errors: string[] = [];
      for (const provider of config.providers) {
        const { validateProvider } = await import("./providers/index.ts");
        const err = validateProvider(provider);
        if (err) errors.push(`Provider ${provider.type}: ${err}`);
      }
      if (errors.length === 0) {
        console.log("✓ Configuration is valid");
      } else {
        console.error("✗ Configuration has errors:");
        for (const e of errors) console.error(`  - ${e}`);
        process.exit(1);
      }
      break;
    }

    case "init":
    case "auto": {
      const { autoGenerateConfig } = await import("./config.ts");
      const targetPath = (args.flags.path as string) ?? "issueclaw.config.json";
      const path = autoGenerateConfig(targetPath);
      console.log(`✓ Auto-generated ${path}`);
      console.log("");
      console.log("Detected providers:");
      const cfg = loadConfig();
      for (const p of cfg.providers) {
        const status = p.apiKey && !p.apiKey.includes("${") ? "✓" : "⚠️ ";
        const def = p.default ? " (default)" : "";
        console.log(`  ${status} ${p.type}/${p.model}${def}`);
      }
      console.log("");
      console.log("To get a free Groq API key: https://console.groq.com/keys");
      break;
    }

    default:
      console.error("Usage: issueclaw config [show|validate|init|auto]");
      process.exit(2);
  }
}

async function cmdMemory(args: ParsedArgs): Promise<void> {
  const config = loadConfig();
  const memory = new MemoryStore(config.memory);

  switch (args.subcommand) {
    case "show":
      console.log(memory.readMemory());
      break;

    case "search": {
      const query = args.positional[0];
      if (!query) {
        console.error("Usage: issueclaw memory search <query>");
        process.exit(2);
      }
      const content = memory.readMemory();
      const lines = content
        .split("\n")
        .filter((l) => l.toLowerCase().includes(query.toLowerCase()));
      console.log(lines.length ? lines.join("\n") : "(no matches)");
      break;
    }

    case "append": {
      const text = args.positional.join(" ");
      if (!text) {
        console.error("Usage: issueclaw memory append <text>");
        process.exit(2);
      }
      memory.appendMemory(text);
      console.log("✓ Memory appended");
      break;
    }

    case "clear":
      memory.writeMemory(`# Memory Log\n\n> Cleared on ${new Date().toISOString()}\n\n`);
      console.log("✓ Memory cleared");
      break;

    default:
      console.error("Usage: issueclaw memory [show|search|append|clear]");
      process.exit(2);
  }
}

async function cmdPersonality(args: ParsedArgs): Promise<void> {
  const config = loadConfig();
  const memory = new MemoryStore(config.memory);

  switch (args.subcommand) {
    case "show":
      console.log(memory.readPersonality());
      break;

    case "set": {
      const file = args.positional[0];
      if (!file || !existsSync(file)) {
        console.error("Usage: issueclaw personality set <file>");
        process.exit(2);
      }
      const content = readFileSync(file, "utf-8");
      memory.writePersonality(content);
      console.log("✓ Personality updated");
      break;
    }

    case "reset":
      memory.writePersonality("");
      console.log("✓ Personality reset");
      break;

    default:
      console.error("Usage: issueclaw personality [show|set|reset]");
      process.exit(2);
  }
}

async function cmdUser(args: ParsedArgs): Promise<void> {
  const config = loadConfig();
  const memory = new MemoryStore(config.memory);

  switch (args.subcommand) {
    case "show":
      console.log(memory.readUser());
      break;

    case "set": {
      const file = args.positional[0];
      if (!file || !existsSync(file)) {
        console.error("Usage: issueclaw user set <file>");
        process.exit(2);
      }
      const content = readFileSync(file, "utf-8");
      memory.writeUser(content);
      console.log("✓ User profile updated");
      break;
    }

    default:
      console.error("Usage: issueclaw user [show|set]");
      process.exit(2);
  }
}

async function cmdTest(args: ParsedArgs): Promise<void> {
  switch (args.subcommand) {
    case "event":
      generateTestEvent(args.positional[0] ?? "issues.opened");
      break;

    case "lifecycle":
      await testLifecycle(args);
      break;

    case "prompt":
      await testPrompt(args);
      break;

    default:
      console.error("Usage: issueclaw test [event|lifecycle|prompt]");
      process.exit(2);
  }
}

function generateTestEvent(type: string): void {
  const events: Record<string, unknown> = {
    "issues.opened": {
      action: "opened",
      issue: {
        number: 1,
        title: "Test Issue",
        body: "This is a test issue for issueclaw.",
        user: { login: "testuser" },
        author_association: "OWNER",
        labels: [],
      },
    },
    "issue_comment.created": {
      action: "created",
      issue: {
        number: 1,
        title: "Test Issue",
        body: "Original body",
        user: { login: "testuser" },
        author_association: "OWNER",
        labels: [],
      },
      comment: {
        id: 12345,
        body: "This is a test comment.",
        user: { login: "testuser" },
        author_association: "OWNER",
      },
    },
  };

  const [name, _action] = type.split(".");
  const eventName = name;
  const payload = events[type] ?? events["issues.opened"];

  mkdirSync("/tmp/issueclaw-test", { recursive: true });
  const path = `/tmp/issueclaw-test/event-${type.replace(".", "-")}.json`;
  writeFileSync(path, JSON.stringify(payload, null, 2));

  console.log(`Test event written to: ${path}`);
  console.log(
    `Use with: GITHUB_EVENT_NAME=${eventName} GITHUB_EVENT_PATH=${path} bun run src/cli.ts run --dry-run`,
  );
}

async function testLifecycle(args: ParsedArgs): Promise<void> {
  const eventPath = (args.flags.event as string) ?? "/tmp/issueclaw-test/event-issues-opened.json";
  if (!existsSync(eventPath)) {
    console.error(`Event file not found: ${eventPath}. Run 'issueclaw test event' first.`);
    process.exit(1);
  }

  process.env.GITHUB_EVENT_PATH = eventPath;
  process.env.GITHUB_EVENT_NAME = "issues";
  process.env.ISSUECLAW_DRY_RUN = "true";
  process.env.ISSUECLAW_LOG_LEVEL = "debug";

  const config = loadConfig();
  const event = parseEvent();
  const memory = new MemoryStore(config.memory);
  memory.init();

  console.log("=== Event ===");
  console.log(
    JSON.stringify({ type: event.type, issue: event.issueNumber, author: event.author }, null, 2),
  );

  console.log("\n=== Prompt ===");
  const prompt = buildPrompt(event, memory, config);
  console.log(prompt.slice(0, 1000) + (prompt.length > 1000 ? "...(truncated)" : ""));

  console.log("\n=== Agent (offline mock) ===");
  config.runtime.offline = true;
  const result = await runAgent({ config, memory, event, executable: false });
  console.log(
    JSON.stringify(
      {
        success: result.success,
        response: result.response,
        provider: result.providerUsed?.type,
        durationMs: result.durationMs,
      },
      null,
      2,
    ),
  );
}

async function testPrompt(args: ParsedArgs): Promise<void> {
  const eventPath = (args.flags.event as string) ?? "/tmp/issueclaw-test/event-issues-opened.json";
  if (!existsSync(eventPath)) {
    console.error(`Event file not found: ${eventPath}`);
    process.exit(1);
  }
  process.env.GITHUB_EVENT_PATH = eventPath;
  process.env.GITHUB_EVENT_NAME = "issues";

  const config = loadConfig();
  const event = parseEvent();
  const memory = new MemoryStore(config.memory);
  memory.init();

  const prompt = buildPrompt(event, memory, config);
  console.log(prompt);
}

async function cmdDoctor(_args: ParsedArgs): Promise<void> {
  console.log("🔍 IssueClaw Doctor\n");

  // Config
  let config: IssueClawConfig;
  try {
    config = loadConfig();
    console.log("✓ Configuration loaded");
  } catch (err) {
    console.error(`✗ Configuration failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // Providers
  console.log(`\n📋 Providers (${config.providers.length}):`);
  const { validateProvider } = await import("./providers/index.ts");
  for (const provider of config.providers) {
    const err = validateProvider(provider);
    if (err) {
      console.log(`  ✗ ${provider.type}/${provider.model}: ${err}`);
    } else {
      console.log(`  ✓ ${provider.type}/${provider.model}${provider.default ? " (default)" : ""}`);
    }
  }

  // Memory
  const memory = new MemoryStore(config.memory);
  console.log(`\n💾 State directory: ${config.memory.stateDir}`);
  const memExists = existsSync(memory.memoryFilePath);
  const persExists = existsSync(memory.personalityFilePath);
  const userExists = existsSync(memory.userFilePath);
  console.log(`  ${memExists ? "✓" : "✗"} memory.md`);
  console.log(`  ${persExists ? "✓" : "✗"} personality.md`);
  console.log(`  ${userExists ? "✓" : "✗"} user.md`);

  // Tools
  console.log("\n🛠  Environment:");
  console.log(`  ${process.env.GITHUB_TOKEN ? "✓" : "✗"} GITHUB_TOKEN`);
  console.log(`  ${process.env.GITHUB_EVENT_PATH ? "✓" : "✗"} GITHUB_EVENT_PATH`);
  console.log(`  ${process.env.GITHUB_REPOSITORY ?? "(not set)"} GITHUB_REPOSITORY`);

  // Bun
  try {
    const proc = Bun.spawn(["bun", "--version"], { stdout: "pipe" });
    const version = (await new Response(proc.stdout).text()).trim();
    console.log(`\n🥟 Bun: ${version}`);
  } catch {
    console.log("\n✗ Bun not found");
  }

  // Git
  try {
    const proc = Bun.spawn(["git", "--version"], { stdout: "pipe" });
    const version = (await new Response(proc.stdout).text()).trim();
    console.log(`🌿 Git: ${version}`);
  } catch {
    console.log("✗ Git not found");
  }

  // gh
  try {
    const proc = Bun.spawn(["gh", "--version"], { stdout: "pipe" });
    const version = (await new Response(proc.stdout).text()).trim().split("\n")[0];
    console.log(`🐙 GitHub CLI: ${version}`);
  } catch {
    console.log("✗ GitHub CLI (gh) not found");
  }

  // pi
  try {
    const proc = Bun.spawn(["bunx", "pi", "--version"], { stdout: "pipe", stderr: "pipe" });
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      const version = (await new Response(proc.stdout).text()).trim();
      console.log(`🤖 Pi: ${version}`);
    } else {
      console.log("⚠️  Pi not yet installed (will install on first run)");
    }
  } catch {
    console.log("⚠️  Pi not yet installed");
  }
}

function printHelp(): void {
  console.log(`
issueclaw v${VERSION}

Enterprise AI assistant that runs through GitHub Issues and Actions.

USAGE
  issueclaw <command> [subcommand] [options]

COMMANDS
  run                          Run the agent lifecycle
    --dry-run                    Don't commit, push, or comment
    --offline                    Mock pi invocation (for testing)
    --event <path>               Custom event payload path
    --event-name <name>          Event name (issues, issue_comment, etc.)

  config                       Configuration management
    show                         Show current config
    validate                     Validate config
    init                         Create issueclaw.config.json template

  memory                       Memory log management
    show                         Show memory log
    search <query>               Search memory
    append <text>                Append entry to memory
    clear                        Clear memory log

  personality                  Personality file management
    show                         Show personality
    set <file>                   Set personality from file
    reset                        Reset personality

  user                         User profile management
    show                         Show user profile
    set <file>                   Set user profile from file

  test                         Testing utilities
    event <type>                 Generate test event payload
    lifecycle                    Run lifecycle against test event
    prompt                       Show prompt that would be sent

  doctor                       Diagnose environment & config

  version                      Show version
  help                         Show this help

GLOBAL OPTIONS
  --log-level <level>          trace|debug|info|warn|error|fatal
  --dry-run                    Enable dry-run mode

EXAMPLES
  issueclaw doctor
  issueclaw test event issues.opened
  issueclaw test lifecycle --event /tmp/issueclaw-test/event-issues-opened.json
  issueclaw run --dry-run --offline
  issueclaw config init

ENVIRONMENT VARIABLES
  GITHUB_TOKEN                 GitHub access token
  GITHUB_EVENT_PATH            Path to event payload (set by Actions)
  GITHUB_EVENT_NAME            Event name (set by Actions)
  GITHUB_REPOSITORY            owner/repo (set by Actions)
  ANTHROPIC_API_KEY            Anthropic API key
  OPENAI_API_KEY               OpenAI API key
  OPENROUTER_API_KEY           OpenRouter API key
  ISSUECLAW_PROVIDER             Override provider type
  ISSUECLAW_MODEL                Override model
  ISSUECLAW_BASE_URL             Override base URL (for custom providers)
  ISSUECLAW_LOG_LEVEL            Log level
  ISSUECLAW_DRY_RUN              Enable dry-run mode
  ISSUECLAW_CONFIG_PATH          Custom config file path
`);
}

main().catch((err) => {
  log.error("fatal", { error: err instanceof Error ? (err.stack ?? err.message) : String(err) });
  process.exit(1);
});

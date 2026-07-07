#!/usr/bin/env bun
/**
 * Main agent lifecycle. Runs after preinstall.
 *
 * Pipeline:
 * 1. Parse event (already validated by preinstall)
 * 2. Initialize memory store
 * 3. Configure git
 * 4. Build prompt
 * 5. Run agent (with provider fallback)
 * 6. Save session mapping
 * 7. Commit & push state changes
 * 8. Comment on issue
 * 9. Cleanup reaction (finally)
 */

import { existsSync, readFileSync } from "node:fs";
import { type AgentRunResult, runAgent } from "../agent/runner.ts";
import { type IssueClawConfig, loadConfig } from "../config.ts";
import { GithubClient } from "../github/client.ts";
import { parseEvent } from "../github/events.ts";
import { MemoryStore } from "../memory/store.ts";
import type { IssueMapping } from "../memory/store.ts";
import { GitClient } from "../utils/git.ts";
import { log } from "../utils/log.ts";

/**
 * Build a helpful error message to post on the issue when the agent fails.
 * Includes the error, provider used, and actionable troubleshooting steps.
 */
function buildErrorMessage(
  result: AgentRunResult,
  _provider: string,
  errMsg: string,
  config: IssueClawConfig,
): string {
  // Check if ALL providers failed because they all lack API keys
  const allProvidersNoKey = errMsg.includes("✗ no key") && !errMsg.includes("✓ key set");
  const hasAnyKeySet = errMsg.includes("✓ key set");

  // Classify the error
  const isMissingKey = /requires.*API_KEY|invalid:.*requires|no key/i.test(errMsg);
  const isAuthError = /403|401|Forbidden|Unauthorized|API key|apiKey/i.test(errMsg);
  const isRateLimit = /429|rate limit|RateLimit|RESOURCE_EXHAUSTED|quota/i.test(errMsg);
  const isTokenLimit = /413|too large|TPM|tokens per minute|Request too large/i.test(errMsg);
  const isNetwork = /timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|network/i.test(errMsg);

  let hint = "";

  if (allProvidersNoKey) {
    hint = `**No API keys found in any provider.**

You need to set at least ONE API key as a GitHub secret:

1. Go to **Settings → Secrets and variables → Actions**
2. Add one of these secrets (pick a provider):
   - \`GEMINI_API_KEY\` — get free at https://aistudio.google.com/app/apikey (RECOMMENDED, 1M TPM)
   - \`CEREBRAS_API_KEY\` — get free at https://inference.cerebras.ai/
   - \`OPENROUTER_API_KEY\` — get free at https://openrouter.ai/keys
   - \`GROQ_API_KEY\` — get free at https://console.groq.com/keys
   - \`ANTHROPIC_API_KEY\` — paid
   - \`OPENAI_API_KEY\` — paid

3. The secret name MUST match exactly (case-sensitive)
4. Push a new commit or re-run the workflow

**Current config providers:**
${config.providers.map((p, i) => `${i + 1}. \`${p.type}/${p.model}\` — needs \`${p.type.toUpperCase()}_API_KEY\` (currently ${p.apiKey?.includes("${") ? "❌ NOT SET" : "✓ set"})`).join("\n")}`;
  } else if (isMissingKey && !hasAnyKeySet) {
    hint = `**API key missing for the configured provider.**

The error shows a provider requires an API key that isn't set. Check:

1. **Which provider is your default?** Look at \`issueclaw.config.json\` — the one with \`"default": true\`
2. **Is the matching secret set?** Go to **Settings → Secrets and variables → Actions**
   - Provider type → Required secret name:
   - \`gemini\` → \`GEMINI_API_KEY\`
   - \`cerebras\` → \`CEREBRAS_API_KEY\`
   - \`openrouter\` → \`OPENROUTER_API_KEY\`
   - \`groq\` → \`GROQ_API_KEY\`
   - \`anthropic\` → \`ANTHROPIC_API_KEY\`
   - \`openai\` → \`OPENAI_API_KEY\`
3. **Secret names are case-sensitive** — must be exactly as shown above

**Get a free key:**
- Gemini (recommended, 1M TPM): https://aistudio.google.com/app/apikey
- Cerebras: https://inference.cerebras.ai/
- OpenRouter: https://openrouter.ai/keys`;
  } else if (isTokenLimit) {
    hint = `**Token limit exceeded (413 error).**

The prompt (including system prompt, tools, and context) exceeded the provider's tokens-per-minute (TPM) limit.

**How to fix:**
1. **Use Gemini** — it has 1,000,000 TPM (vs Groq's 12,000). Set \`GEMINI_API_KEY\` and make it default.
2. **Wait and retry** — TPM limits reset every 60 seconds
3. **Add multiple fallback providers** in \`issueclaw.config.json\``;
  } else if (isRateLimit) {
    hint = `**Rate limit or quota exceeded (429).**

One or more providers rate-limited the request.

**How to fix:**
1. **Wait a minute and retry** — rate limits reset quickly
2. **Set up multiple providers** — the fallback chain will try the next one
3. **Check your provider's quota dashboard**:
   - Gemini: https://ai.google.dev/gemini-api/docs/rate-limits
   - Groq: https://console.groq.com/settings/limits
   - OpenRouter: https://openrouter.ai/activity`;
  } else if (isAuthError) {
    hint = `**Authentication error (403/401).**

An API key was rejected by the provider.

**How to fix:**
1. **Verify the key is valid** — regenerate it at the provider's console
2. **Check for geo-restrictions** — some providers block certain regions
3. **Ensure the key hasn't been revoked or expired**`;
  } else if (isNetwork) {
    hint = `**Network error.**

This is usually transient. Try again in a moment.`;
  } else {
    hint = `**Unexpected error.**

Check the workflow logs in the Actions tab for the full error details.`;
  }

  const providers = config.providers
    .map((p, i) => `${i + 1}. \`${p.type}/${p.model}\`${p.default ? " (default)" : ""}`)
    .join("\n");

  // The error message from the runner now contains ALL provider failures
  // Show it in a collapsible details section
  const errDisplay =
    errMsg.length > 3000
      ? `${errMsg.slice(0, 3000)}\n\n...(truncated, see full logs in Actions tab)`
      : errMsg;

  return `## ⚠️ Agent Error

The agent failed to produce a response after trying all configured providers.

${hint}

---

<details>
<summary>🔍 Provider attempts (click to expand)</summary>

${errDisplay}

</details>

---

<details>
<summary>📋 Configuration</summary>

**Provider fallback chain:**
${providers}

**Config file**: \`issueclaw.config.json\`
**Tools**: ${config.agent.tools?.length ?? 0} enabled
**Session file**: \`${result.sessionPath ?? "none"}\`
**Duration**: ${result.durationMs}ms

</details>

---

**To debug further:**
1. Check the workflow run logs in the **Actions** tab (look for "provider failed, trying next")
2. Download the \`issueclaw-session-*\` artifact for full JSONL output
3. Run \`bun run src/cli.ts doctor\` locally

_If this keeps happening, [open an issue](https://github.com/maruf009sultan/issueclaw/issues/new?labels=bug) with the diagnostics above._`;
}

async function main(config: IssueClawConfig): Promise<void> {
  const startTime = Date.now();
  log.info("main: starting agent lifecycle");

  // Parse event
  const event = parseEvent();
  log.info("main: parsed event", { type: event.type, issue: event.issueNumber });

  // Initialize memory
  const memory = new MemoryStore(config.memory);
  memory.init();
  memory.appendAudit("agent_run_start", { issue: event.issueNumber, type: event.type });

  // Configure git
  const git = new GitClient({});
  await git.configure();

  // Read existing mapping for resume
  const existingMapping = memory.getMapping(event.issueNumber);
  let _mode = "new";
  if (existingMapping?.sessionPath && existsSync(existingMapping.sessionPath)) {
    _mode = "resume";
    log.info("main: resuming session", { session: existingMapping.sessionPath });
  }

  // Read reaction state
  const reactionState = existsSync("/tmp/reaction-state.json")
    ? JSON.parse(readFileSync("/tmp/reaction-state.json", "utf-8"))
    : null;

  try {
    // Detect mode based on issue labels:
    //   "agent" or "task" label → full agent mode (pi + tools, ~120K tokens)
    //   "hatch" label           → agent mode + bootstrap identity flow
    //   default (no label)      → simple chat mode (~500 tokens, works with Groq)
    //
    // RATIONALE: Groq's free tier has only 12K TPM, but agent mode needs ~120K
    // tokens (pi's system prompt + tool definitions). So agent mode ALWAYS fails
    // on Groq with 413. Making chat the default means Groq works for the common
    // case (quick questions). Use the "agent" label only when you need file
    // editing / tool use, and ideally with Gemini (1M TPM) as the provider.
    const isAgentMode =
      event.labels.includes("agent") ||
      event.labels.includes("task") ||
      event.labels.includes(config.github.hatchLabel);
    const isHatchMode = event.labels.includes(config.github.hatchLabel);
    const mode = isHatchMode ? "hatch" : isAgentMode ? "agent" : "chat";

    log.info("main: running in mode", { mode, issue: event.issueNumber, labels: event.labels });

    // Result type — both runAgent and runSimpleChat produce compatible shapes
    let result: AgentRunResult;

    if (mode === "chat") {
      // Simple chat: direct LLM call, no agent, no tools — saves ~99% of API tokens
      // This is the DEFAULT mode — works with Groq's 12K TPM free tier.
      const { runSimpleChat } = await import("../agent/simple-chat.ts");
      const chatResult = await runSimpleChat({
        config,
        memory,
        event,
        existingMapping,
      });
      result = {
        success: chatResult.success,
        response: chatResult.response,
        sessionPath: null, // simple chat doesn't create a session file
        providerUsed: chatResult.providerUsed,
        error: chatResult.error,
        durationMs: chatResult.durationMs,
      };
      log.info("main: simple chat finished", {
        success: chatResult.success,
        durationMs: chatResult.durationMs,
        tokensUsed: chatResult.tokensUsed,
        provider: chatResult.providerUsed?.type,
      });
      memory.appendAudit("simple_chat_complete", {
        issue: event.issueNumber,
        success: chatResult.success,
        durationMs: chatResult.durationMs,
        provider: chatResult.providerUsed?.type,
        tokensUsed: chatResult.tokensUsed,
        responseLength: chatResult.response.length,
      });
    } else {
      // Full agent mode: pi agent with tools, file editing, session management
      // Needs ~120K tokens — requires Gemini (1M TPM) or Cerebras (60K TPM).
      // Will FAIL on Groq (12K TPM) with 413 error.
      result = await runAgent({
        config,
        memory,
        event,
        existingMapping,
        executable: !config.runtime.offline,
      });

      log.info("main: agent finished", {
        success: result.success,
        durationMs: result.durationMs,
        responseLength: result.response.length,
        provider: result.providerUsed
          ? `${result.providerUsed.type}/${result.providerUsed.model}`
          : null,
      });

      memory.appendAudit("agent_run_complete", {
        issue: event.issueNumber,
        success: result.success,
        durationMs: result.durationMs,
        provider: result.providerUsed?.type,
        responseLength: result.response.length,
      });
    }

    // Save session mapping (only for agent mode — chat mode has no session file)
    if (result.sessionPath) {
      const now = new Date().toISOString();
      const mapping: IssueMapping = {
        issueNumber: event.issueNumber,
        sessionPath: result.sessionPath,
        createdAt: existingMapping?.createdAt ?? now,
        updatedAt: now,
        turnCount: (existingMapping?.turnCount ?? 0) + 1,
      };
      memory.saveMapping(mapping);
      log.info("main: mapping saved", { issue: event.issueNumber, session: result.sessionPath });
    }

    // Commit & push (unless dry-run)
    if (!config.runtime.dryRun) {
      await git.add(["-A"]);
      const committed = await git.commit(
        `issueclaw: work on issue #${event.issueNumber} (${mode})`,
      );
      if (committed) {
        const branch = await git.currentBranch();
        await git.push("origin", branch);
        log.info("main: pushed changes", { branch });
      } else {
        log.info("main: no changes to commit");
      }
    } else {
      log.info("main: dry-run mode, skipping commit/push");
    }

    // Comment on issue (unless dry-run)
    if (!config.runtime.dryRun) {
      const gh = new GithubClient();
      let commentBody: string;

      if (result.success && result.response) {
        commentBody = result.response;
        // Truncate if too long, with notice
        if (commentBody.length > config.github.maxCommentLength) {
          const truncated = commentBody.slice(0, config.github.maxCommentLength - 200);
          commentBody = `${truncated}\n\n---\n\n⚠️ Response truncated (original was ${commentBody.length} chars, max is ${config.github.maxCommentLength}). See full response in the session file at \`${result.sessionPath ?? "state/sessions/"}\`.`;
        }
      } else {
        // Agent FAILED — post a clear error message with diagnostics
        const provider = result.providerUsed
          ? `${result.providerUsed.type}/${result.providerUsed.model}`
          : "unknown";
        const errMsg = result.error ?? "unknown error";
        commentBody = buildErrorMessage(result, provider, errMsg, config);
        log.error("main: agent failed, posting error comment", {
          issue: event.issueNumber,
          error: errMsg,
          provider,
        });
      }

      await gh.commentOnIssue(event.issueNumber, commentBody);
      memory.appendAudit("comment_posted", {
        issue: event.issueNumber,
        bodyLength: commentBody.length,
        success: result.success,
        truncated: result.success && result.response.length > config.github.maxCommentLength,
      });
    } else if (config.runtime.dryRun) {
      log.info("main: dry-run mode, would have commented", {
        success: result.success,
        responsePreview: result.response.slice(0, 200),
        error: result.error,
      });
    }
  } finally {
    // Cleanup reaction
    if (reactionState?.reactionId && !config.runtime.dryRun) {
      try {
        const gh = new GithubClient();
        const target =
          reactionState.reactionTarget === "comment" && reactionState.commentId
            ? { type: "comment" as const, id: reactionState.commentId }
            : { type: "issue" as const, id: reactionState.issueNumber };
        await gh.deleteReaction(target, reactionState.reactionId);
        log.info("main: reaction cleaned up");
      } catch (err) {
        log.warn("main: failed to cleanup reaction", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const totalMs = Date.now() - startTime;
    log.info("main: lifecycle complete", { totalMs });
    memory.appendAudit("agent_run_end", { issue: event.issueNumber, totalMs });
  }
}

// Run if invoked directly
if (import.meta.path === process.argv[1] || process.argv[1]?.endsWith("main.ts")) {
  const config = loadConfig();
  // Apply log level from config
  process.env.ISSUECLAW_LOG_LEVEL = config.runtime.logLevel;
  await main(config).catch((err) => {
    log.error("main failed", { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
}

export { main };

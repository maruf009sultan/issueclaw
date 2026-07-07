#!/usr/bin/env bun
/**
 * Pre-install lifecycle hook. Runs before the agent.
 *
 * Responsibilities:
 * 1. Parse the GitHub event
 * 2. Check author permissions
 * 3. Add 👀 reaction to indicate processing
 * 4. Write reaction state for cleanup in main.ts
 *
 * Exit codes:
 *   0 = proceed to main
 *  78 = EX_CONFIG: skip this event (not allowed, bot, etc.)
 */

import { writeFileSync } from "node:fs";
import type { IssueClawConfig } from "../config.ts";
import { GithubClient } from "../github/client.ts";
import { parseEvent, shouldProcessEvent } from "../github/events.ts";
import { log } from "../utils/log.ts";

export async function preinstall(config: IssueClawConfig): Promise<void> {
  log.info("preinstall: starting", { event: process.env.GITHUB_EVENT_NAME });

  const event = parseEvent();
  log.info("preinstall: parsed event", {
    type: event.type,
    issue: event.issueNumber,
    author: event.author,
    association: event.authorAssociation,
    isBot: event.isBot,
  });

  // Permission check
  if (!shouldProcessEvent(event, config.github.allowedAssociations)) {
    log.info("preinstall: skipping event (not allowed)", {
      author: event.author,
      association: event.authorAssociation,
    });
    process.exit(78); // EX_CONFIG
  }

  // Add eyes reaction while processing
  const gh = new GithubClient();
  let reactionId: number | null = null;
  let reactionTarget: "issue" | "comment" = "issue";
  let commentId: number | null = null;

  if (config.github.reactionWhileProcessing) {
    if (event.type === "issue_comment.created" && event.commentId) {
      commentId = event.commentId;
      reactionTarget = "comment";
      reactionId = await gh.addCommentReaction(commentId, "eyes");
    } else if (event.issueNumber) {
      reactionId = await gh.addIssueReaction(event.issueNumber, "eyes");
    }
  }

  // Write reaction state for main.ts to clean up
  const reactionState = {
    reactionId,
    reactionTarget,
    commentId,
    issueNumber: event.issueNumber,
    repo: process.env.GITHUB_REPOSITORY,
  };
  writeFileSync("/tmp/reaction-state.json", JSON.stringify(reactionState, null, 2));
  log.info("preinstall: reaction state saved", reactionState);
}

// Run if invoked directly
if (import.meta.path === process.argv[1] || process.argv[1]?.endsWith("preinstall.ts")) {
  const { loadConfig } = await import("../config.ts");
  await preinstall(loadConfig()).catch((err) => {
    log.error("preinstall failed", { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
}

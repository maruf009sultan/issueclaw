/**
 * GitHub event parsing. Handles issues.opened, issue_comment.created,
 * and pull_request events.
 */

import { readFileSync } from "node:fs";
import { log } from "../utils/log.ts";

export type EventType =
  | "issues.opened"
  | "issue_comment.created"
  | "pull_request.opened"
  | "pull_request.edited"
  | "unknown";

export interface ParsedEvent {
  type: EventType;
  rawName: string;
  issueNumber: number;
  title: string;
  body: string;
  commentId?: number;
  author: string;
  authorAssociation: string;
  isBot: boolean;
  labels: string[];
  raw: unknown;
}

interface GithubIssue {
  number: number;
  title: string;
  body: string | null;
  user?: { login: string };
  author_association?: string;
  labels?: Array<{ name: string } | string>;
}

interface GithubComment {
  id: number;
  body: string | null;
  user?: { login: string };
  author_association?: string;
}

interface GithubEventPayload {
  issue?: GithubIssue;
  comment?: GithubComment;
  pull_request?: GithubIssue & { number: number };
  action?: string;
}

/**
 * Parse a GitHub event from GITHUB_EVENT_PATH or an explicit payload.
 */
export function parseEvent(
  eventPath?: string,
  eventName?: string,
  rawPayload?: string,
): ParsedEvent {
  const raw = rawPayload ?? readEventJson(eventPath);
  const name = eventName ?? process.env.GITHUB_EVENT_NAME ?? "unknown";
  const payload = JSON.parse(raw) as GithubEventPayload;

  log.debug("parsing event", { name, hasIssue: !!payload.issue, hasComment: !!payload.comment });

  let type: EventType = "unknown";
  let issueNumber = 0;
  let title = "";
  let body = "";
  let commentId: number | undefined;
  let author = "";
  let authorAssociation = "";
  let isBot = false;
  const labels: string[] = [];

  // Determine event type
  if (name === "issues" && payload.action === "opened" && payload.issue) {
    type = "issues.opened";
  } else if (name === "issue_comment" && payload.action === "created" && payload.comment) {
    type = "issue_comment.created";
  } else if (name === "pull_request" && payload.issue && payload.pull_request) {
    type = payload.action === "opened" ? "pull_request.opened" : "pull_request.edited";
  } else {
    log.warn("unrecognized event", { name, action: payload.action });
  }

  // Extract issue / pull_request
  const issue = payload.issue ?? payload.pull_request;
  if (issue) {
    issueNumber = issue.number;
    title = issue.title ?? "";
    body = issue.body ?? "";
    author = issue.user?.login ?? "";
    authorAssociation = issue.author_association ?? "";
    isBot = author === "github-actions[bot]" || author.endsWith("[bot]");
    if (issue.labels) {
      for (const label of issue.labels) {
        labels.push(typeof label === "string" ? label : label.name);
      }
    }
  }

  // Extract comment
  if (payload.comment) {
    commentId = payload.comment.id;
    body = payload.comment.body ?? "";
    author = payload.comment.user?.login ?? "";
    authorAssociation = payload.comment.author_association ?? "";
    isBot = author === "github-actions[bot]" || author.endsWith("[bot]");
  }

  return {
    type,
    rawName: name,
    issueNumber,
    title,
    body,
    commentId,
    author,
    authorAssociation,
    isBot,
    labels,
    raw: payload,
  };
}

function readEventJson(eventPath?: string): string {
  const path = eventPath ?? process.env.GITHUB_EVENT_PATH;
  if (!path) {
    throw new Error("GITHUB_EVENT_PATH not set and no explicit path provided");
  }
  try {
    return readFileSync(path, "utf-8");
  } catch (err) {
    throw new Error(
      `Failed to read event payload at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Check if an author association is allowed.
 */
export function isAuthorAllowed(
  association: string,
  allowed: string[] = ["OWNER", "MEMBER", "COLLABORATOR"],
): boolean {
  return allowed.includes(association);
}

/**
 * Check if the event should trigger the agent.
 */
export function shouldProcessEvent(event: ParsedEvent, allowedAssociations: string[]): boolean {
  if (event.isBot) {
    log.debug("skipping bot event", { author: event.author });
    return false;
  }
  if (!isAuthorAllowed(event.authorAssociation, allowedAssociations)) {
    log.debug("author not allowed", { author: event.author, association: event.authorAssociation });
    return false;
  }
  return true;
}

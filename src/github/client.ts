/**
 * GitHub API client. Wraps the `gh` CLI with structured error handling,
 * retry logic, and type-safe responses.
 */

import { log } from "../utils/log.ts";
import { errorMessage, isRetryableHttpError, retry } from "../utils/retry.ts";

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface IssueComment {
  id: number;
  body: string;
  user: { login: string };
  authorAssociation: string;
  createdAt: string;
}

export interface IssueReaction {
  id: number;
  content: string;
}

export interface Issue {
  number: number;
  title: string;
  body: string;
  user: { login: string };
  authorAssociation: string;
  labels: string[];
  state: "open" | "closed";
}

export interface GithubContext {
  token?: string;
  repo?: string;
  /** Whether to actually execute gh CLI commands (false = mock mode). */
  executable?: boolean;
}

export class GithubClient {
  private token: string | undefined;
  private repo: string | undefined;
  private executable: boolean;

  constructor(ctx: GithubContext = {}) {
    this.token = ctx.token ?? process.env.GITHUB_TOKEN;
    this.repo = ctx.repo ?? process.env.GITHUB_REPOSITORY;
    this.executable = ctx.executable ?? true;
  }

  private async runGh(args: string[]): Promise<RunResult> {
    const cmd = ["gh", ...args];
    log.debug(`gh ${args.join(" ")}`);

    const env: Record<string, string | undefined> = { ...process.env };
    if (this.token) {
      env.GH_TOKEN = this.token;
      env.GITHUB_TOKEN = this.token;
    }

    if (!this.executable) {
      log.debug("gh mock mode, returning empty result", { args });
      return { exitCode: 0, stdout: "", stderr: "" };
    }

    const proc = Bun.spawn(cmd, {
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
  }

  private async gh(...args: string[]): Promise<string> {
    const result = await retry(() => this.runGh(args), {
      maxAttempts: 3,
      name: `gh ${args.slice(0, 3).join(" ")}`,
      retryIf: isRetryableHttpError,
    });
    if (result.exitCode !== 0) {
      throw new Error(`gh ${args[0]} failed: ${result.stderr || result.stdout}`);
    }
    return result.stdout;
  }

  async getIssue(number: number): Promise<Issue> {
    const json = await this.gh(
      "issue",
      "view",
      String(number),
      "--json",
      "number,title,body,user,authorAssociation,labels,state",
    );
    const parsed = JSON.parse(json) as Issue;
    return {
      ...parsed,
      labels: Array.isArray(parsed.labels)
        ? parsed.labels.map((l) => (typeof l === "string" ? l : (l as { name: string }).name))
        : [],
    };
  }

  async getComment(_number: number, commentId: number): Promise<IssueComment> {
    const json = await this.gh(
      "api",
      `repos/${this.repo}/issues/comments/${commentId}`,
      "--jq",
      ".",
    );
    return JSON.parse(json) as IssueComment;
  }

  async addIssueReaction(number: number, content = "eyes"): Promise<number | null> {
    try {
      const result = await this.gh(
        "api",
        `repos/${this.repo}/issues/${number}/reactions`,
        "-f",
        `content=${content}`,
        "--jq",
        ".id",
      );
      return Number.parseInt(result, 10) || null;
    } catch (err) {
      log.warn("failed to add issue reaction", { error: errorMessage(err) });
      return null;
    }
  }

  async addCommentReaction(commentId: number, content = "eyes"): Promise<number | null> {
    try {
      const result = await this.gh(
        "api",
        `repos/${this.repo}/issues/comments/${commentId}/reactions`,
        "-f",
        `content=${content}`,
        "--jq",
        ".id",
      );
      return Number.parseInt(result, 10) || null;
    } catch (err) {
      log.warn("failed to add comment reaction", { error: errorMessage(err) });
      return null;
    }
  }

  async deleteReaction(
    target: { type: "issue" | "comment"; id: number },
    reactionId: number,
  ): Promise<boolean> {
    const path =
      target.type === "comment"
        ? `repos/${this.repo}/issues/comments/${target.id}/reactions/${reactionId}`
        : `repos/${this.repo}/issues/${target.id}/reactions/${reactionId}`;
    try {
      await this.gh("api", path, "-X", "DELETE");
      return true;
    } catch (err) {
      log.warn("failed to delete reaction", { error: errorMessage(err) });
      return false;
    }
  }

  async commentOnIssue(number: number, body: string): Promise<number> {
    const _result = await this.gh("issue", "comment", String(number), "--body", body);
    // gh issue comment doesn't return the comment ID by default; parse from URL or use api
    log.info("commented on issue", { number, bodyLength: body.length });
    // Try to get the latest comment ID
    try {
      const json = await this.gh(
        "api",
        `repos/${this.repo}/issues/${number}/comments`,
        "--jq",
        ".[-1].id",
      );
      return Number.parseInt(json, 10) || 0;
    } catch {
      return 0;
    }
  }

  async closeIssue(number: number): Promise<void> {
    await this.gh("issue", "close", String(number));
    log.info("closed issue", { number });
  }

  async addLabel(number: number, label: string): Promise<void> {
    await this.gh("issue", "edit", String(number), "--add-label", label);
  }

  async removeLabel(number: number, label: string): Promise<void> {
    await this.gh("issue", "edit", String(number), "--remove-label", label);
  }

  async getRawApi(path: string, ...extraArgs: string[]): Promise<string> {
    return this.gh("api", path, ...extraArgs);
  }
}

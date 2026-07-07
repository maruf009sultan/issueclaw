/**
 * Git operations utility. Wraps git CLI with proper error handling,
 * structured logging, and retry logic for network operations.
 */

import { log } from "./log.ts";
import { isRetryableHttpError, retry } from "./retry.ts";

export interface GitOptions {
  /** Working directory for git commands. */
  cwd?: string;
  /** Git user name for commits. */
  userName?: string;
  /** Git user email for commits. */
  userEmail?: string;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runGit(args: string[], opts: GitOptions = {}, input?: string): Promise<RunResult> {
  const cmd = ["git", ...args];
  log.debug(`git ${args.join(" ")}`, { cwd: opts.cwd });

  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: input ? "pipe" : undefined,
  });

  if (input && proc.stdin) {
    proc.stdin.write(input);
    proc.stdin.end();
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
}

export class GitClient {
  constructor(private opts: GitOptions = {}) {}

  async configure(user?: { name: string; email: string }): Promise<void> {
    const { userName = "issueclaw[bot]", userEmail = "issueclaw[bot]@users.noreply.github.com" } =
      this.opts;
    const name = user?.name ?? userName;
    const email = user?.email ?? userEmail;
    await runGit(["config", "user.name", name], this.opts);
    await runGit(["config", "user.email", email], this.opts);
    log.debug("git configured", { name, email });
  }

  async add(paths: string[] = ["-A"]): Promise<void> {
    const result = await runGit(["add", ...paths], this.opts);
    if (result.exitCode !== 0) {
      throw new Error(`git add failed: ${result.stderr}`);
    }
  }

  async hasStagedChanges(): Promise<boolean> {
    const result = await runGit(["diff", "--cached", "--quiet"], this.opts);
    return result.exitCode !== 0;
  }

  async commit(message: string, options: { allowEmpty?: boolean } = {}): Promise<boolean> {
    if (!options.allowEmpty && !(await this.hasStagedChanges())) {
      log.debug("no staged changes, skipping commit");
      return false;
    }
    const args = ["commit", "-m", message];
    if (options.allowEmpty) args.push("--allow-empty");
    const result = await runGit(args, this.opts);
    if (result.exitCode !== 0) {
      throw new Error(`git commit failed: ${result.stderr}`);
    }
    log.info("git commit", { message });
    return true;
  }

  async push(
    remote = "origin",
    branch = "main",
    options: { maxAttempts?: number } = {},
  ): Promise<void> {
    const maxAttempts = options.maxAttempts ?? 3;

    await retry(
      async () => {
        const push = await runGit(["push", remote, branch], this.opts);
        if (push.exitCode !== 0) {
          log.warn("push failed, attempting rebase", { stderr: push.stderr });
          await runGit(["pull", "--rebase", remote, branch], this.opts);
          const retry = await runGit(["push", remote, branch], this.opts);
          if (retry.exitCode !== 0) {
            throw new Error(`git push failed after rebase: ${retry.stderr}`);
          }
        }
        log.info("git push succeeded", { remote, branch });
      },
      {
        maxAttempts,
        name: "git push",
        retryIf: isRetryableHttpError,
      },
    );
  }

  async pull(remote = "origin", branch = "main", rebase = true): Promise<void> {
    const args = ["pull"];
    if (rebase) args.push("--rebase");
    args.push(remote, branch);
    const result = await runGit(args, this.opts);
    if (result.exitCode !== 0) {
      throw new Error(`git pull failed: ${result.stderr}`);
    }
  }

  async status(): Promise<string> {
    const result = await runGit(["status", "--porcelain"], this.opts);
    return result.stdout;
  }

  async currentBranch(): Promise<string> {
    const result = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], this.opts);
    return result.stdout;
  }

  async raw(args: string[]): Promise<RunResult> {
    return runGit(args, this.opts);
  }
}

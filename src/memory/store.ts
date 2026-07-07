/**
 * Memory store. Manages persistent files in the state/ directory:
 * - memory.md: append-only log of important facts
 * - personality.md: mutable agent personality
 * - user.md: mutable user profile
 * - audit.log: append-only audit trail
 * - issues/<n>.json: issue → session mapping
 * - sessions/*.jsonl: full conversation transcripts
 *
 * All files are committed to git so the agent has full history.
 */

import { join } from "node:path";
import type { MemoryConfig } from "../config.ts";
import {
  appendLine,
  atomicWrite,
  ensureDir,
  latestFile,
  listFiles,
  safeRead,
  safeReadJson,
  writeJson,
} from "../utils/fs.ts";
import { log } from "../utils/log.ts";

export interface IssueMapping {
  issueNumber: number;
  sessionPath: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
}

export interface AuditEntry {
  timestamp: string;
  action: string;
  issueNumber?: number;
  details?: Record<string, unknown>;
}

export class MemoryStore {
  private readonly stateDir: string;
  private readonly issuesDir: string;
  private readonly sessionsDir: string;
  private readonly memoryPath: string;
  private readonly personalityPath: string;
  private readonly userPath: string;
  private readonly auditPath: string;

  constructor(private config: MemoryConfig) {
    this.stateDir = config.stateDir;
    this.issuesDir = join(this.stateDir, "issues");
    this.sessionsDir = join(this.stateDir, "sessions");
    this.memoryPath = join(this.stateDir, config.memoryFile);
    this.personalityPath = join(this.stateDir, config.personalityFile);
    this.userPath = join(this.stateDir, config.userFile);
    this.auditPath = join(this.stateDir, config.auditFile);
  }

  /**
   * Initialize state directories and seed default files if missing.
   */
  init(): void {
    ensureDir(this.stateDir);
    ensureDir(this.issuesDir);
    ensureDir(this.sessionsDir);

    // Seed default files if missing
    if (!this.readMemory()) {
      this.writeMemory(DEFAULT_MEMORY);
    }
    if (!this.readPersonality()) {
      this.writePersonality(DEFAULT_PERSONALITY);
    }
    if (!this.readUser()) {
      this.writeUser(DEFAULT_USER);
    }

    log.debug("memory store initialized", { stateDir: this.stateDir });
  }

  // ---- Memory log ----

  readMemory(): string {
    return safeRead(this.memoryPath);
  }

  writeMemory(content: string): void {
    atomicWrite(this.memoryPath, content);
  }

  appendMemory(entry: string): void {
    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 16);
    const line = `- [${timestamp}] ${entry}`;
    appendLine(this.memoryPath, line);
    log.debug("memory appended", { entry });
  }

  // ---- Personality ----

  readPersonality(): string {
    return safeRead(this.personalityPath);
  }

  writePersonality(content: string): void {
    atomicWrite(this.personalityPath, content);
    log.debug("personality updated");
  }

  // ---- User profile ----

  readUser(): string {
    return safeRead(this.userPath);
  }

  writeUser(content: string): void {
    atomicWrite(this.userPath, content);
    log.debug("user profile updated");
  }

  // ---- Audit log ----

  readAudit(): string {
    return safeRead(this.auditPath);
  }

  appendAudit(action: string, details?: Record<string, unknown>): void {
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      action,
      details,
    };
    appendLine(this.auditPath, JSON.stringify(entry));
    log.debug("audit entry", { action });
  }

  // ---- Issue mappings ----

  getMapping(issueNumber: number): IssueMapping | null {
    const path = join(this.issuesDir, `${issueNumber}.json`);
    return safeReadJson<IssueMapping | null>(path, null);
  }

  saveMapping(mapping: IssueMapping): void {
    const path = join(this.issuesDir, `${mapping.issueNumber}.json`);
    writeJson(path, mapping);
    log.debug("mapping saved", { issue: mapping.issueNumber, session: mapping.sessionPath });
  }

  listMappings(): IssueMapping[] {
    return listFiles(this.issuesDir, ".json").map((f) =>
      safeReadJson<IssueMapping>(f, {} as IssueMapping),
    );
  }

  // ---- Sessions ----

  listSessions(): string[] {
    return listFiles(this.sessionsDir, ".jsonl");
  }

  getLatestSession(): string | null {
    return latestFile(this.sessionsDir, ".jsonl");
  }

  getSessionPath(filename: string): string {
    return join(this.sessionsDir, filename);
  }

  /** Public accessor for sessions directory. */
  getSessionsDir(): string {
    return this.sessionsDir;
  }

  get stateDirectory(): string {
    return this.stateDir;
  }

  get memoryFilePath(): string {
    return this.memoryPath;
  }

  get personalityFilePath(): string {
    return this.personalityPath;
  }

  get userFilePath(): string {
    return this.userPath;
  }

  get auditFilePath(): string {
    return this.auditPath;
  }
}

const DEFAULT_MEMORY = `# Memory Log

> Append-only log of important facts, decisions, and user preferences.
> Format: \`- [YYYY-MM-DD HH:MM] entry\`
> Future sessions will grep this for context.

## User Preferences

- [uninitialized] Waiting to learn about the user.

## Project Context

- [uninitialized] No project context captured yet.
`;

const DEFAULT_PERSONALITY = `# Personality

> This file defines the agent's mutable identity. It can be updated by the agent
> as it learns and evolves. Bootstrap flow uses this to start a new identity.

## Name
TBD — set during hatch flow.

## Nature
TBD — set during hatch flow.

## Vibe
TBD — set during hatch flow.

## Emoji
TBD — set during hatch flow.

## Hatch Date
TBD

## Notes
This file persists across sessions. The agent can read and update it.
`;

const DEFAULT_USER = `# User Profile

> Information about the human the agent is working with.

## Name
Unknown

## How to Address Them
Unknown

## Preferences
- (none yet)

## Communication Style
- (unknown)

## Notes
- (none)
`;

/**
 * File system helpers with atomic writes, safe reads, and directory utilities.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { log } from "./log.ts";

/**
 * Atomically write a file by writing to a temp file and renaming.
 * Prevents partial writes from being observed by other processes.
 */
export function atomicWrite(filePath: string, content: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, content, "utf-8");
  try {
    renameSync(tmp, filePath);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // ignore
    }
    throw err;
  }
}

/**
 * Safely read a file, returning the default if it doesn't exist or errors.
 */
export function safeRead(filePath: string, defaultContent = ""): string {
  try {
    if (!existsSync(filePath)) return defaultContent;
    return readFileSync(filePath, "utf-8");
  } catch (err) {
    log.warn("safeRead failed", { filePath, error: errorMessage(err) });
    return defaultContent;
  }
}

/**
 * Read and parse JSON safely.
 */
export function safeReadJson<T>(filePath: string, defaultValue: T): T {
  try {
    if (!existsSync(filePath)) return defaultValue;
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch (err) {
    log.warn("safeReadJson failed", { filePath, error: errorMessage(err) });
    return defaultValue;
  }
}

/**
 * Write JSON with pretty-printing and atomic write.
 */
export function writeJson(filePath: string, data: unknown, pretty = true): void {
  const content = pretty ? `${JSON.stringify(data, null, 2)}\n` : JSON.stringify(data);
  atomicWrite(filePath, content);
}

/**
 * Ensure a directory exists.
 */
export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/**
 * Append a line to a file, creating it if needed.
 */
export function appendLine(filePath: string, line: string): void {
  const dir = dirname(filePath);
  ensureDir(dir);
  // Use appendFileSync-equivalent via Bun
  const existing = existsSync(filePath) ? safeRead(filePath) : "";
  const newContent =
    existing.endsWith("\n") || existing === "" ? `${existing + line}\n` : `${existing}\n${line}\n`;
  atomicWrite(filePath, newContent);
}

/**
 * List files in a directory matching a pattern.
 */
export function listFiles(dir: string, extension?: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => !extension || f.endsWith(extension))
      .map((f) => join(dir, f))
      .filter((f) => statSync(f).isFile());
  } catch {
    return [];
  }
}

/**
 * Get file size in bytes.
 */
export function fileSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

/**
 * Find the most recently modified file matching a glob pattern in a directory.
 */
export function latestFile(dir: string, extension?: string): string | null {
  const files = listFiles(dir, extension);
  if (files.length === 0) return null;
  let latest = files[0];
  let latestMtime = statSync(latest).mtimeMs;
  for (const f of files.slice(1)) {
    const mtime = statSync(f).mtimeMs;
    if (mtime > latestMtime) {
      latest = f;
      latestMtime = mtime;
    }
  }
  return latest;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Slugify a string for use as a filename.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

/**
 * Extract file extension without the dot.
 */
export function ext(filePath: string): string {
  return extname(filePath).slice(1);
}

/**
 * Get basename without extension.
 */
export function basenameNoExt(filePath: string): string {
  const base = basename(filePath);
  const e = extname(base);
  return e ? base.slice(0, -e.length) : base;
}

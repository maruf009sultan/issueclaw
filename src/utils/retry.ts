/**
 * Retry utility with exponential backoff and jitter.
 * Supports async functions and configurable retry conditions.
 */

import { log } from "./log.ts";

export interface RetryOptions<_T> {
  /** Maximum number of attempts (including the first try). Default: 3. */
  maxAttempts?: number;
  /** Initial delay in ms. Default: 1000. */
  initialDelayMs?: number;
  /** Maximum delay in ms. Default: 30000. */
  maxDelayMs?: number;
  /** Backoff multiplier. Default: 2. */
  multiplier?: number;
  /** Whether to add jitter (random 0-50% of delay). Default: true. */
  jitter?: boolean;
  /** Predicate to decide whether an error is retryable. Default: all errors. */
  retryIf?: (error: unknown) => boolean;
  /** Called before each retry with the attempt number and error. */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
  /** Timeout for each attempt in ms. */
  timeoutMs?: number;
  /** Operation name for logging. */
  name?: string;
}

const DEFAULT_OPTIONS: Required<
  Omit<RetryOptions<unknown>, "retryIf" | "onRetry" | "timeoutMs" | "name">
> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  multiplier: 2,
  jitter: true,
};

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retry<T>(fn: () => Promise<T>, options: RetryOptions<T> = {}): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const name = opts.name ?? "operation";

  let lastError: unknown;
  let delay = opts.initialDelayMs;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      log.debug(`retry: ${name} attempt ${attempt}/${opts.maxAttempts}`);
      const result = opts.timeoutMs ? await withTimeout(fn(), opts.timeoutMs) : await fn();
      if (attempt > 1) {
        log.info(`retry: ${name} succeeded on attempt ${attempt}`);
      }
      return result;
    } catch (error) {
      lastError = error;
      const isRetryable = opts.retryIf ? opts.retryIf(error) : true;
      if (!isRetryable || attempt === opts.maxAttempts) {
        throw error;
      }
      const jitter = opts.jitter ? Math.random() * 0.5 * delay : 0;
      const actualDelay = Math.min(delay + jitter, opts.maxDelayMs);
      log.warn(
        `retry: ${name} failed on attempt ${attempt}, retrying in ${Math.round(actualDelay)}ms`,
        { error: errorMessage(error), attempt, nextDelay: Math.round(actualDelay) },
      );
      opts.onRetry?.(attempt, error, Math.round(actualDelay));
      await sleep(actualDelay);
      delay = Math.min(delay * opts.multiplier, opts.maxDelayMs);
    }
  }
  throw lastError;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Operation timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Returns a retryable error predicate for network/HTTP errors.
 */
export function isRetryableHttpError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("rate limit") || msg.includes("429")) return true;
    if (msg.includes("timeout") || msg.includes("etimedout")) return true;
    if (msg.includes("econnreset") || msg.includes("econnrefused")) return true;
    if (msg.includes("502") || msg.includes("503") || msg.includes("504")) return true;
    if (msg.includes("network")) return true;
  }
  return false;
}

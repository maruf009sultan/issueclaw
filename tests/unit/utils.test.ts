import { describe, expect, it } from "vitest";
import { errorMessage, isRetryableHttpError, retry, withTimeout } from "../../src/utils/retry.ts";

describe("utils", () => {
  describe("retry", () => {
    it("should return result on first success", async () => {
      const result = await retry(async () => "ok");
      expect(result).toBe("ok");
    });

    it("should retry on failure and succeed", async () => {
      let attempts = 0;
      const result = await retry(
        async () => {
          attempts++;
          if (attempts < 3) throw new Error("transient");
          return "success";
        },
        { maxAttempts: 5, initialDelayMs: 10 },
      );
      expect(result).toBe("success");
      expect(attempts).toBe(3);
    });

    it("should throw after max attempts", async () => {
      let attempts = 0;
      await expect(
        retry(
          async () => {
            attempts++;
            throw new Error("always fails");
          },
          { maxAttempts: 3, initialDelayMs: 10 },
        ),
      ).rejects.toThrow("always fails");
      expect(attempts).toBe(3);
    });

    it("should not retry if retryIf returns false", async () => {
      let attempts = 0;
      await expect(
        retry(
          async () => {
            attempts++;
            throw new Error("non-retryable");
          },
          { maxAttempts: 5, retryIf: () => false, initialDelayMs: 10 },
        ),
      ).rejects.toThrow("non-retryable");
      expect(attempts).toBe(1);
    });

    it("should call onRetry callback", async () => {
      const onRetry = vi.fn();
      let attempts = 0;
      await retry(
        async () => {
          attempts++;
          if (attempts < 2) throw new Error("fail");
          return "ok";
        },
        { maxAttempts: 3, initialDelayMs: 10, onRetry },
      );
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), expect.any(Number));
    });
  });

  describe("withTimeout", () => {
    it("should resolve if promise completes in time", async () => {
      const result = await withTimeout(
        new Promise((resolve) => setTimeout(() => resolve("ok"), 10)),
        1000,
      );
      expect(result).toBe("ok");
    });

    it("should reject if promise times out", async () => {
      await expect(
        withTimeout(new Promise((resolve) => setTimeout(() => resolve("ok"), 1000)), 50),
      ).rejects.toThrow("timed out");
    });
  });

  describe("isRetryableHttpError", () => {
    it("should detect rate limit errors", () => {
      expect(isRetryableHttpError(new Error("rate limit exceeded"))).toBe(true);
      expect(isRetryableHttpError(new Error("429 Too Many Requests"))).toBe(true);
    });

    it("should detect timeout errors", () => {
      expect(isRetryableHttpError(new Error("ETIMEDOUT"))).toBe(true);
      expect(isRetryableHttpError(new Error("operation timeout"))).toBe(true);
    });

    it("should detect 5xx errors", () => {
      expect(isRetryableHttpError(new Error("502 Bad Gateway"))).toBe(true);
      expect(isRetryableHttpError(new Error("503 Service Unavailable"))).toBe(true);
      expect(isRetryableHttpError(new Error("504 Gateway Timeout"))).toBe(true);
    });

    it("should detect network errors", () => {
      expect(isRetryableHttpError(new Error("ECONNRESET"))).toBe(true);
      expect(isRetryableHttpError(new Error("ECONNREFUSED"))).toBe(true);
      expect(isRetryableHttpError(new Error("network error"))).toBe(true);
    });

    it("should not detect 4xx errors (except 429)", () => {
      expect(isRetryableHttpError(new Error("404 Not Found"))).toBe(false);
      expect(isRetryableHttpError(new Error("401 Unauthorized"))).toBe(false);
    });

    it("should not detect generic errors", () => {
      expect(isRetryableHttpError(new Error("validation failed"))).toBe(false);
      expect(isRetryableHttpError(new Error("invalid input"))).toBe(false);
    });
  });

  describe("errorMessage", () => {
    it("should extract message from Error", () => {
      expect(errorMessage(new Error("test"))).toBe("test");
    });

    it("should return string as-is", () => {
      expect(errorMessage("string error")).toBe("string error");
    });

    it("should stringify other types", () => {
      expect(errorMessage(42)).toBe("42");
      expect(errorMessage({ a: 1 })).toBe("[object Object]");
    });
  });
});

import { vi } from "vitest";

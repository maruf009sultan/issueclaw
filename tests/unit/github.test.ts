import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAuthorAllowed, parseEvent, shouldProcessEvent } from "../../src/github/events.ts";

describe("github events", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "issueclaw-evt-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    process.env.GITHUB_EVENT_PATH = undefined;
    process.env.GITHUB_EVENT_NAME = undefined;
  });

  describe("parseEvent", () => {
    it("should parse issues.opened event", () => {
      const payload = {
        action: "opened",
        issue: {
          number: 42,
          title: "Test Issue",
          body: "This is a test",
          user: { login: "alice" },
          author_association: "OWNER",
          labels: [{ name: "bug" }, { name: "urgent" }],
        },
      };
      const path = join(tempDir, "event.json");
      writeFileSync(path, JSON.stringify(payload));
      process.env.GITHUB_EVENT_PATH = path;
      process.env.GITHUB_EVENT_NAME = "issues";

      const event = parseEvent();
      expect(event.type).toBe("issues.opened");
      expect(event.issueNumber).toBe(42);
      expect(event.title).toBe("Test Issue");
      expect(event.body).toBe("This is a test");
      expect(event.author).toBe("alice");
      expect(event.authorAssociation).toBe("OWNER");
      expect(event.isBot).toBe(false);
      expect(event.labels).toEqual(["bug", "urgent"]);
    });

    it("should parse issue_comment.created event", () => {
      const payload = {
        action: "created",
        issue: {
          number: 1,
          title: "Original",
          body: "Original body",
          user: { login: "alice" },
          author_association: "OWNER",
          labels: [],
        },
        comment: {
          id: 999,
          body: "A comment",
          user: { login: "bob" },
          author_association: "MEMBER",
        },
      };
      const path = join(tempDir, "event.json");
      writeFileSync(path, JSON.stringify(payload));
      process.env.GITHUB_EVENT_PATH = path;
      process.env.GITHUB_EVENT_NAME = "issue_comment";

      const event = parseEvent();
      expect(event.type).toBe("issue_comment.created");
      expect(event.issueNumber).toBe(1);
      expect(event.commentId).toBe(999);
      expect(event.body).toBe("A comment");
      expect(event.author).toBe("bob");
      expect(event.authorAssociation).toBe("MEMBER");
    });

    it("should detect bot author", () => {
      const payload = {
        action: "opened",
        issue: {
          number: 1,
          title: "Bot issue",
          body: "test",
          user: { login: "github-actions[bot]" },
          author_association: "NONE",
          labels: [],
        },
      };
      const path = join(tempDir, "event.json");
      writeFileSync(path, JSON.stringify(payload));
      process.env.GITHUB_EVENT_PATH = path;
      process.env.GITHUB_EVENT_NAME = "issues";

      const event = parseEvent();
      expect(event.isBot).toBe(true);
    });

    it("should parse pull_request.opened event", () => {
      const payload = {
        action: "opened",
        issue: {
          number: 5,
          title: "PR Title",
          body: "PR body",
          user: { login: "alice" },
          author_association: "COLLABORATOR",
          labels: [],
        },
        pull_request: {
          number: 5,
          title: "PR Title",
          body: "PR body",
          user: { login: "alice" },
          author_association: "COLLABORATOR",
        },
      };
      const path = join(tempDir, "event.json");
      writeFileSync(path, JSON.stringify(payload));
      process.env.GITHUB_EVENT_PATH = path;
      process.env.GITHUB_EVENT_NAME = "pull_request";

      const event = parseEvent();
      expect(event.type).toBe("pull_request.opened");
      expect(event.issueNumber).toBe(5);
    });

    it("should handle unknown event type", () => {
      const payload = { action: "deleted", issue: { number: 1, title: "t", body: "b" } };
      const path = join(tempDir, "event.json");
      writeFileSync(path, JSON.stringify(payload));
      process.env.GITHUB_EVENT_PATH = path;
      process.env.GITHUB_EVENT_NAME = "issues";

      const event = parseEvent();
      expect(event.type).toBe("unknown");
    });

    it("should throw if GITHUB_EVENT_PATH not set", () => {
      process.env.GITHUB_EVENT_PATH = undefined;
      expect(() => parseEvent()).toThrow();
    });

    it("should support string labels (some payloads)", () => {
      const payload = {
        action: "opened",
        issue: {
          number: 1,
          title: "t",
          body: "b",
          user: { login: "alice" },
          author_association: "OWNER",
          labels: ["bug", "urgent"],
        },
      };
      const path = join(tempDir, "event.json");
      writeFileSync(path, JSON.stringify(payload));
      process.env.GITHUB_EVENT_PATH = path;
      process.env.GITHUB_EVENT_NAME = "issues";

      const event = parseEvent();
      expect(event.labels).toEqual(["bug", "urgent"]);
    });
  });

  describe("isAuthorAllowed", () => {
    it("should allow OWNER", () => {
      expect(isAuthorAllowed("OWNER")).toBe(true);
    });

    it("should allow MEMBER", () => {
      expect(isAuthorAllowed("MEMBER")).toBe(true);
    });

    it("should allow COLLABORATOR", () => {
      expect(isAuthorAllowed("COLLABORATOR")).toBe(true);
    });

    it("should reject NONE", () => {
      expect(isAuthorAllowed("NONE")).toBe(false);
    });

    it("should reject CONTRIBUTOR", () => {
      expect(isAuthorAllowed("CONTRIBUTOR")).toBe(false);
    });

    it("should support custom allowlist", () => {
      expect(isAuthorAllowed("CONTRIBUTOR", ["CONTRIBUTOR"])).toBe(true);
    });
  });

  describe("shouldProcessEvent", () => {
    it("should reject bot events", () => {
      const event = {
        type: "issues.opened" as const,
        rawName: "issues",
        issueNumber: 1,
        title: "t",
        body: "b",
        author: "github-actions[bot]",
        authorAssociation: "NONE",
        isBot: true,
        labels: [],
        raw: {},
      };
      expect(shouldProcessEvent(event, ["OWNER"])).toBe(false);
    });

    it("should reject disallowed authors", () => {
      const event = {
        type: "issues.opened" as const,
        rawName: "issues",
        issueNumber: 1,
        title: "t",
        body: "b",
        author: "random",
        authorAssociation: "NONE",
        isBot: false,
        labels: [],
        raw: {},
      };
      expect(shouldProcessEvent(event, ["OWNER", "MEMBER", "COLLABORATOR"])).toBe(false);
    });

    it("should allow valid authors", () => {
      const event = {
        type: "issues.opened" as const,
        rawName: "issues",
        issueNumber: 1,
        title: "t",
        body: "b",
        author: "alice",
        authorAssociation: "OWNER",
        isBot: false,
        labels: [],
        raw: {},
      };
      expect(shouldProcessEvent(event, ["OWNER"])).toBe(true);
    });
  });
});

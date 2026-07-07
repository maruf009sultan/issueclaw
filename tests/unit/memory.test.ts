import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MemoryConfig } from "../../src/config.ts";
import { MemoryStore } from "../../src/memory/store.ts";

describe("memory store", () => {
  let tempDir: string;
  let store: MemoryStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "issueclaw-mem-"));
    const config: MemoryConfig = {
      stateDir: tempDir,
      memoryFile: "memory.md",
      personalityFile: "personality.md",
      userFile: "user.md",
      auditFile: "audit.log",
      maxSessionSize: 10 * 1024 * 1024,
      autoCompact: true,
    };
    store = new MemoryStore(config);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("init", () => {
    it("should create directories", () => {
      store.init();
      expect(existsSync(join(tempDir, "issues"))).toBe(true);
      expect(existsSync(join(tempDir, "sessions"))).toBe(true);
    });

    it("should seed default memory.md", () => {
      store.init();
      const content = store.readMemory();
      expect(content).toContain("Memory Log");
      expect(content).toContain("User Preferences");
    });

    it("should seed default personality.md", () => {
      store.init();
      const content = store.readPersonality();
      expect(content).toContain("Personality");
      expect(content).toContain("Name");
    });

    it("should seed default user.md", () => {
      store.init();
      const content = store.readUser();
      expect(content).toContain("User Profile");
    });

    it("should not overwrite existing files", () => {
      store.init();
      store.writeMemory("custom memory");
      store.init(); // second init
      expect(store.readMemory()).toBe("custom memory");
    });
  });

  describe("memory log", () => {
    beforeEach(() => store.init());

    it("should append entries with timestamp", () => {
      store.appendMemory("User prefers TypeScript");
      const content = store.readMemory();
      expect(content).toContain("User prefers TypeScript");
      expect(content).toMatch(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\]/);
    });

    it("should append multiple entries", () => {
      store.appendMemory("first fact");
      store.appendMemory("second fact");
      const content = store.readMemory();
      expect(content).toContain("first fact");
      expect(content).toContain("second fact");
    });

    it("should write entire memory", () => {
      store.writeMemory("# Custom\n\n- entry");
      expect(store.readMemory()).toBe("# Custom\n\n- entry");
    });
  });

  describe("personality", () => {
    beforeEach(() => store.init());

    it("should update personality", () => {
      store.writePersonality("# My Identity\n\nName: TestBot");
      expect(store.readPersonality()).toContain("TestBot");
    });
  });

  describe("user profile", () => {
    beforeEach(() => store.init());

    it("should update user profile", () => {
      store.writeUser("Name: Alice");
      expect(store.readUser()).toContain("Alice");
    });
  });

  describe("audit log", () => {
    beforeEach(() => store.init());

    it("should append JSON audit entries", () => {
      store.appendAudit("test_action", { foo: "bar" });
      const content = store.readAudit();
      const entries = content.trim().split("\n");
      const lastEntry = JSON.parse(entries[entries.length - 1]);
      expect(lastEntry.action).toBe("test_action");
      expect(lastEntry.details.foo).toBe("bar");
      expect(lastEntry.timestamp).toMatch(/\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("issue mappings", () => {
    beforeEach(() => store.init());

    it("should save and retrieve mappings", () => {
      const mapping = {
        issueNumber: 42,
        sessionPath: "state/sessions/test.jsonl",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
        turnCount: 3,
      };
      store.saveMapping(mapping);
      const retrieved = store.getMapping(42);
      expect(retrieved).toEqual(mapping);
    });

    it("should return null for non-existent mapping", () => {
      const retrieved = store.getMapping(999);
      expect(retrieved).toBeNull();
    });

    it("should list all mappings", () => {
      store.saveMapping({
        issueNumber: 1,
        sessionPath: "a.jsonl",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        turnCount: 1,
      });
      store.saveMapping({
        issueNumber: 2,
        sessionPath: "b.jsonl",
        createdAt: "2026-01-02T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
        turnCount: 1,
      });
      const list = store.listMappings();
      expect(list).toHaveLength(2);
    });
  });

  describe("atomic writes", () => {
    beforeEach(() => store.init());

    it("should write atomically (no .tmp files left)", () => {
      store.writeMemory("test content");
      const files = require("node:fs").readdirSync(tempDir);
      const tmpFiles = files.filter((f: string) => f.includes(".tmp"));
      expect(tmpFiles).toHaveLength(0);
    });
  });
});

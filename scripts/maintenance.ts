#!/usr/bin/env bun
/**
 * Scheduled maintenance script.
 *
 * - Cleans up orphaned session files (sessions with no issue mapping)
 * - Compacts oversized session files
 * - Reports state stats
 */

import { loadConfig } from "../src/config.ts";
import { MemoryStore } from "../src/memory/store.ts";
import { fileSize } from "../src/utils/fs.ts";
import { log } from "../src/utils/log.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  const memory = new MemoryStore(config.memory);
  memory.init();

  log.info("maintenance: starting");

  // List sessions
  const sessions = memory.listSessions();
  const mappings = memory.listMappings();
  const mappedPaths = new Set(mappings.map((m) => m.sessionPath));

  let orphaned = 0;
  let oversized = 0;

  for (const session of sessions) {
    if (!mappedPaths.has(session)) {
      log.info("orphaned session (no mapping)", { session });
      orphaned++;
    }
    const size = fileSize(session);
    if (size > config.memory.maxSessionSize) {
      log.warn("oversized session", { session, size, max: config.memory.maxSessionSize });
      oversized++;
      // TODO: implement compaction via pi --compact
    }
  }

  log.info("maintenance: complete", {
    totalSessions: sessions.length,
    totalMappings: mappings.length,
    orphaned,
    oversized,
  });

  // Append summary to audit log
  memory.appendAudit("maintenance_complete", {
    totalSessions: sessions.length,
    totalMappings: mappings.length,
    orphaned,
    oversized,
  });
}

main().catch((err) => {
  log.error("maintenance failed", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});

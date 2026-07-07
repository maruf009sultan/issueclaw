# State Directory

This directory holds all persistent state for the issueclaw agent. Everything here is committed to git so the agent has full history across sessions.

## Files

| File | Purpose | Mutability |
|------|---------|------------|
| `memory.md` | Append-only memory log | Append-only |
| `personality.md` | Mutable agent identity | Mutable |
| `user.md` | User profile | Mutable |
| `audit.log` | Audit trail of all agent runs | Append-only |
| `issues/<n>.json` | Issue → session mapping | Managed by lifecycle |
| `sessions/*.jsonl` | Full conversation transcripts | Managed by pi |

## Bootstrap

On first run, the lifecycle will seed default files if they don't exist. The `hatch` label on an issue triggers the bootstrap flow to establish agent identity.

## Memory Format

```
- [YYYY-MM-DD HH:MM] One-line memory entry.
```

Atomic, one fact per line. Future sessions will grep this.

## Backup

All state is in git. To back up:

```bash
git tag backup-$(date +%Y%m%d)
git push origin backup-$(date +%Y%m%d)
```

To restore:

```bash
git checkout backup-YYYYMMDD -- state/
```

# Deployment Guide

## Option 1: GitHub Actions (Recommended)

IssueClaw is designed to run in GitHub Actions. No servers needed.

### 1. Fork the Repo

Fork `issueclaw` to your GitHub account.

### 2. Add Secrets

Go to **Settings → Secrets and variables → Actions** and add at least one API key:

- `ANTHROPIC_API_KEY` (for Claude)
- `OPENAI_API_KEY` (for GPT-4o, etc.)
- `OPENROUTER_API_KEY` (for OpenRouter)
- `ISSUECLAW_BASE_URL` (for custom OpenAI-compatible endpoints)

### 3. Configure Provider

Edit `issueclaw.config.json` to select your provider and model.

### 4. Open an Issue

That's it! The agent will respond automatically.

### 5. (Optional) Hatch the Agent

Use the "🥚 Hatch" issue template to bootstrap the agent's identity.

## Option 2: Self-Hosted Runner

For private repos or custom environments:

1. Set up a [self-hosted runner](https://docs.github.com/en/actions/hosting-your-own-runners)
2. Install Bun, git, and gh CLI on the runner
3. The workflow will use the self-hosted runner automatically if you add `runs-on: self-hosted`

## Option 3: Docker (Local Testing)

```bash
# Build
docker compose build

# Diagnose
docker compose run --rm issueclaw doctor

# Run with env vars
docker compose run --rm \
  -e GITHUB_TOKEN=ghp_xxx \
  -e ANTHROPIC_API_KEY=sk-ant-xxx \
  issueclaw run --dry-run
```

## Production Checklist

Before going live, verify:

- [ ] **API key set**: At least one provider key in repository secrets
- [ ] **Config valid**: Run `bun run src/cli.ts config validate` locally
- [ ] **Permissions**: Workflow has `contents: write`, `issues: write`
- [ ] **Concurrency**: `concurrency.group` is set (prevents race conditions)
- [ ] **Timeouts**: `timeout-minutes: 30` is appropriate for your use case
- [ ] **Repo visibility**: Set to private if conversations contain sensitive info
- [ ] **Branch protection**: Consider protecting `main` branch
- [ ] **Audit log**: Monitor `state/audit.log` for errors
- [ ] **Session artifacts**: Verify uploads work in Actions tab
- [ ] **Backup**: Tag releases for rollback: `git tag v1.0.0`

## Upgrading

### From original issueclaw

If you're upgrading from the original `issueclaw`:

1. Backup your `state/` directory
2. Replace all files with the new enterprise version
3. Move `.pi/settings.json` (legacy compat will read it)
4. Create `issueclaw.config.json` (run `bun run src/cli.ts config init`)
5. Add API key secrets
6. Test with `bun run src/cli.ts doctor`

The legacy `.pi/settings.json` is still supported as a fallback:

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-opus-4-6",
  "defaultThinkingLevel": "high"
}
```

### Updating pi-mono

Pi is invoked via `bunx pi`, which fetches the latest version on each run. To pin:

```json
{
  "agent": {
    "piCommand": "bunx pi@0.80.3"
  }
}
```

## Monitoring

### Audit Log

```bash
# Recent activity
tail -20 state/audit.log | jq .

# All errors
jq 'select(.details.success == false)' state/audit.log

# Runs per issue
jq -s 'group_by(.details.issue) | map({issue: .[0].details.issue, count: length})' state/audit.log
```

### GitHub Actions

- **Workflow runs**: Actions tab in GitHub
- **Artifacts**: Each run uploads session JSONL (30 day retention)
- **Logs**: Structured JSON logs in workflow output

### Health Check

```bash
bun run src/cli.ts doctor
```

## Rollback

If something breaks:

```bash
# Revert to previous commit
git revert HEAD
git push origin main

# Or reset to a known-good tag
git reset --hard v1.0.0
git push --force origin main
```

State in `state/` is also versioned, so you can roll back state independently:

```bash
git checkout v1.0.0 -- state/
git commit -m "rollback state to v1.0.0"
git push origin main
```

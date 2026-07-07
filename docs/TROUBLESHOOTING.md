# Troubleshooting

## Common Issues

### Agent doesn't respond to issues

**Symptoms**: Issue opened, no comment, no reaction.

**Diagnosis**:

1. Check Actions tab — did the workflow run?
2. Check workflow `if:` condition — are you `OWNER`/`MEMBER`/`COLLABORATOR`?
3. Check that `GITHUB_TOKEN` has `issues: write` permission
4. Run `bun run src/cli.ts doctor` locally

**Solutions**:

- If you're a `CONTRIBUTOR`, add yourself as a collaborator in repo settings
- If workflow didn't trigger, verify `on: issues: types: [opened]` is in `agent.yml`
- If permission denied, check `permissions:` block in workflow

### Agent responds with error

**Symptoms**: Comment posted with "⚠️ Agent failed to produce a response".

**Diagnosis**:

1. Check audit log: `tail -5 state/audit.log | jq .`
2. Look at workflow logs for the actual error
3. Verify API key is set: `bun run src/cli.ts doctor`

**Common causes**:

- **API key invalid/expired**: Regenerate and update secret
- **Rate limit**: Wait and retry, or use a different provider
- **Model unavailable**: Check provider's model list
- **Network issue**: Provider fallback chain will try next provider

### Git push fails

**Symptoms**: `git push failed` in logs.

**Diagnosis**:

1. Check if another run pushed first (race condition)
2. Verify `GITHUB_TOKEN` has `contents: write`

**Solutions**:

- The workflow auto-rebases and retries 3 times
- If still failing, manually rebase: `git pull --rebase origin main && git push`
- Consider enabling `concurrency:` groups (already in default workflow)

### Comment is truncated

**Symptoms**: Comment ends with "⚠️ Response truncated".

**Cause**: Response exceeded `maxCommentLength` (default 60000 chars).

**Solutions**:

- The full response is in the session JSONL (uploaded as artifact)
- Increase `maxCommentLength` in config (max 65536, GitHub limit)
- Tell the agent to be more concise

### Session file not found

**Symptoms**: `Warning: no session file found to map`.

**Cause**: Pi failed to create a session file (likely provider error).

**Solutions**:

- Check that the agent actually ran successfully
- Verify provider config is valid: `bun run src/cli.ts config validate`
- Check API key is set

### Memory not persisting

**Symptoms**: Agent forgets things between sessions.

**Diagnosis**:

1. Check `state/memory.md` exists and has content
2. Check `state/personality.md` is not "TBD"
3. Verify git commits include state changes

**Solutions**:

- If `memory.md` is empty, the agent never wrote to it (prompt the agent to remember)
- If file exists but not committed, check git push didn't fail
- If file is committed but agent doesn't read it, verify `buildPrompt` includes it

### Reaction not removed

**Symptoms**: 👀 stays on issue forever.

**Cause**: `finally` block in `main.ts` failed, or workflow was cancelled.

**Solutions**:

- Manually remove via GitHub UI
- The reaction state is in `/tmp/reaction-state.json` — if workflow is restarted, it can clean up
- Check `state/audit.log` for `reaction_cleanup_failed`

## Debug Mode

### Enable Debug Logging

Set `ISSUECLAW_LOG_LEVEL=debug` (or `trace` for maximum verbosity):

```yaml
env:
  ISSUECLAW_LOG_LEVEL: debug
```

Or via repo variables: **Settings → Secrets and variables → Actions → Variables**.

### JSON Logging

For log aggregation (Datadog, Splunk, etc.):

```yaml
env:
  ISSUECLAW_LOG_JSON: "true"
```

### Local Debugging

```bash
# Generate a test event
bun run src/cli.ts test event issues.opened

# See the prompt that would be sent
bun run src/cli.ts test prompt

# Run in offline mock mode
bun run src/cli.ts test lifecycle

# Diagnose environment
bun run src/cli.ts doctor
```

## Performance Issues

### Agent runs slow

**Solutions**:

- Use a faster model (e.g. `claude-sonnet-4-5` instead of `claude-opus-4-6`)
- Reduce `thinking` level (e.g. `medium` instead of `high`)
- Disable unused tools: `"tools": ["read", "bash"]`
- Increase `timeoutMs` if agent is being killed mid-run

### Workflow takes too long

**Solutions**:

- Reduce `timeout-minutes` in workflow
- Cache Bun deps (already in default workflow)
- Use smaller models for simple tasks

### GitHub API rate limit

**Solutions**:

- The `gh` CLI retries on 429 with backoff
- Avoid opening many issues in rapid succession
- Use `concurrency:` groups to serialize runs

## Getting Help

1. Run `bun run src/cli.ts doctor` and include output
2. Check `state/audit.log` for recent errors
3. Check workflow logs in Actions tab
4. Open an issue with the doctor output and audit log excerpt

## FAQ

### Can I use this on a private repo?

Yes! In fact, **recommended** for anything sensitive. The workflow uses `GITHUB_TOKEN` which works for private repos.

### Can multiple people use the same agent?

Yes, but only `OWNER`/`MEMBER`/`COLLABORATOR` can trigger. Add them as collaborators in repo settings.

### Can I run the agent locally?

Yes:

```bash
bun run src/cli.ts run --dry-run --offline
```

This won't actually call the LLM or post comments, but will show you what would happen.

### How do I change the agent's personality?

Open an issue with the `hatch` label to bootstrap a new identity. Or edit `state/personality.md` directly.

### How do I reset everything?

```bash
rm -rf state/
bun run src/cli.ts doctor
```

Then open an issue with the `hatch` label.

### Can I use a custom model?

Yes, via the `custom` provider type. Any OpenAI-compatible endpoint works:

```json
{
  "type": "custom",
  "model": "my-model",
  "baseUrl": "https://your-endpoint.com/v1",
  "apiKey": "${YOUR_API_KEY}"
}
```

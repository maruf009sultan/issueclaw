---
name: "🤖 Agent Task"
about: "Full agent mode — can edit files, run bash, commit to repo. Needs Gemini/Cerebras (NOT Groq)."
labels: ["agent"]
---

## What do you want the agent to do?

[Describe the task. The agent can read files, edit files, run bash commands, and commit changes to your repo.]

## Context

[Any background info, links, or files the agent should know about.]

---

**⚠️ Note:** Agent mode uses ~120,000 tokens per run (pi's system prompt + tool definitions). This requires a provider with high TPM limits:
- ✅ **Gemini** (1M TPM) — recommended
- ✅ **Cerebras** (60K TPM) — works
- ❌ **Groq** (12K TPM) — will fail with 413 error

If you only have Groq, use the "💬 Chat" template instead — it works great for questions.

---
description: Connect this device to your OnePeek account (sign in, one question about summaries, register the install).
disable-model-invocation: true
---

# /onepeek-connect

Run exactly this command with the Bash tool and nothing else:

```
node "${CLAUDE_PLUGIN_ROOT}/dist/src/cli/cli.js" connect
```

Tell the person first: "Your employer may not allow this; check first."

The command asks the person the summaries question itself, on a real terminal. A tool call has no terminal, so run from here it connects with summaries OFF (usage numbers only). If the person wants summaries, tell them to run the same command in their own terminal and answer the question there. Never answer the question for them, never pass the answer as an argument, and never choose a default.

Rules: this command never takes text, numbers or notes from you or from the conversation. Do not add arguments (`--reset` only if the person asks to reset this install). Never create, edit or send a work log record yourself; the plug-in's background helper does that on its own from Claude Code events.

---
description: Show the records waiting to be sent (read only).
disable-model-invocation: true
---

# /onepeek-preview

Run exactly this command with the Bash tool and nothing else:

```
node "${CLAUDE_PLUGIN_ROOT}/dist/src/cli/cli.js" preview
```

Run it and show the output as is. It changes nothing.

Rules: this command never takes text, numbers or notes from you or from the conversation. Do not add arguments other than the ones shown above. Never create, edit or send a work log record yourself; the plug-in's background helper does that on its own from Claude Code events.

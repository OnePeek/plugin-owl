---
description: Show the OnePeek work log status: connection, capture mode, pending and sent records, problems.
disable-model-invocation: true
---

# /onepeek-status

Run exactly this command with the Bash tool and nothing else:

```
node "${CLAUDE_PLUGIN_ROOT}/dist/src/cli/cli.js" status
```

Run it and show the output as is.

Rules: this command never takes text, numbers or notes from you or from the conversation. Do not add arguments other than the ones shown above. Never create, edit or send a work log record yourself; the plug-in's background helper does that on its own from Claude Code events.

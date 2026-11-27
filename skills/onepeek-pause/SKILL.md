---
description: Pause OnePeek work logging (everywhere, or only in this project).
disable-model-invocation: true
---

# /onepeek-pause

Run exactly this command with the Bash tool and nothing else:

```
node "${CLAUDE_PLUGIN_ROOT}/dist/src/cli/cli.js" pause [--here]
```

Ask whether they mean everywhere or only this project. For this project add --here.

Rules: this command never takes text, numbers or notes from you or from the conversation. Do not add arguments other than the ones shown above. Never create, edit or send a work log record yourself; the plug-in's background helper does that on its own from Claude Code events.

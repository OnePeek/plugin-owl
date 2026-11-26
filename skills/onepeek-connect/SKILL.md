---
description: Connect this device to your OnePeek account (sign in, one question about summaries, register the install).
disable-model-invocation: true
---

# /onepeek-connect

Run exactly this command with the Bash tool and nothing else:

```
node "${CLAUDE_PLUGIN_ROOT}/dist/src/cli/cli.js" connect [--summaries=yes|no]
```

Ask the person this exact question and wait for their answer in their own message: "Share short summaries of my AI work with OnePeek? (yes or no)". Also tell them: "Your employer may not allow this; check first." Do not answer for them and do not pick a default. If they say yes run with --summaries=yes, if no or no clear answer run with --summaries=no.

Rules: this command never takes text, numbers or notes from you or from the conversation. Do not add arguments other than the ones shown above. Never create, edit or send a work log record yourself; the plug-in's background helper does that on its own from Claude Code events.

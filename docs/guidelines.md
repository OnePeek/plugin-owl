# Coding guide: plugin-owl

How code in this repo is structured and written. It applies `onepeek-docs/standards/code-guidelines.md` to the Claude Code plug-in. Read both before changing anything; the spec is `onepeek-docs/trd/work-log-plugin-spec.md`. This repo is **public**: everything here can be read by anyone.

## 1. What the plug-in does (and never does)

- At session end it turns the session into **closed-vocabulary tags**, redacts on the device, signs and chains the record, and sends it through the MCP `log_work` tool.
- It **never** sends source code, file contents, prompts, paths, secrets or free text. If in doubt, it sends nothing.
- It **never gets in the way**: any failure is silent to the person and their session carries on.

## 2. Folders

```
.claude-plugin/plugin.json   the plug-in manifest
hooks/hooks.json             hook registration only; each hook calls one entry script
hooks/<event>.*              thin entry scripts: read the event, call redact/, call send
redact/
  vocabulary.*               the closed tag vocabulary (the only words that may leave)
  classify.*                 session -> tags, pure functions
  redact.*                   final allow-list filter: anything not in the vocabulary is dropped
sign/                        signing and chaining of records
send/                        the only module that talks to the network (log_work)
tests/
  privacy/                   proofs that nothing outside the vocabulary leaves, on hostile fixtures
  unit/
```

- **Allow-list, never deny-list:** output is built only from vocabulary terms; nothing is "cleaned".
- `send/` is the only module with network access; everything before it is pure and testable.

## 3. Rules

- Standard library only, unless a dependency is approved in the pull request and pinned.
- No telemetry, no analytics, no other network call.
- No secrets in the repo; signing keys live on the person's machine, never in code.
- Hooks finish fast and time out quietly.

## 4. Tests

- **Privacy tests are the gate:** fixtures full of code, secrets, paths and personal data must produce output containing only vocabulary terms. A failing privacy test blocks every merge.
- Unit tests for classification, signing and chaining.
- CI runs the secret scan and the tests on every pull request.

# Coding guide: plugin-owl

How code in this repo is structured and written. It applies `onepeek-docs/standards/code-guidelines.md` to the Claude Code plug-in. Read both before changing anything; the spec is `onepeek-docs/trd/work-log-plugin-spec.md`. This repo is **public**: everything here can be read by anyone.

## 1. What the plug-in does (and never does)

- Hooks only enqueue; a background helper turns each session into **closed-vocabulary IDs and bands**, redacts on the device, signs and chains the record, and sends it through the MCP `log_work` tool.
- It **never** sends source code, file contents, prompts, paths, secrets or free text. If in doubt, it sends nothing.
- It **never gets in the way**: any failure is silent to the person and their session carries on.

## 2. Folders

The layout is fixed by `onepeek-docs/architecture/lld/clients/worklog-plugin.md` §5.1 (TypeScript on Node 22; the only runtime dependency is the official MCP SDK, bundled):

```
.claude-plugin/plugin.json       the manifest: hooks, skill, MCP server (the helper)
hooks/hooks.json                 Stop, PreCompact, SessionEnd, SessionStart → hooks/enqueue (one entry)
skills/onepeek-worklog/SKILL.md  "Log this now", /onepeek-connect, /onepeek-status, /onepeek-pause
src/
  hook/enqueue.ts                read the hook event, append to the session queue, exit 0 within budget
  signals/                       measured signals from the queue and git (pure)
  vocabulary/                    the closed vocabulary and bands (from wrk.vocab)
  record/                        build the tier 4 record from signals + vocabulary only (allow-list, pure)
  scrub/                         denylist, blocklist, learned project names: the second fail-closed layer (pure)
  sign/                          RFC 8785 canonical JSON, SHA-256, Ed25519, chain head
  spool/                         encrypted, ordered, idempotent by record hash
  auth/                          OAuth 2.1 PKCE loopback, refresh, OS key store
  send/                          the ONLY network module: Grant token endpoint and MCP log_work
  helper/                        stdio MCP server + CLI (connect, status, pause, flush)
tests/privacy/                   hostile fixtures: only vocabulary values may leave (the merge gate)
tests/unit/
```

- **Allow-list, never deny-list:** output is built only from vocabulary terms and bands; nothing is "cleaned". `scrub/` is a second, independent check.
- `send/` is the only module with network access (a lint rule enforces it); everything before it is pure and testable.

## 3. Rules

- Node standard library only, plus the pinned MCP SDK; any other dependency is approved in the pull request and pinned.
- No telemetry, no analytics, no other network call.
- No secrets in the repo; signing keys live on the person's machine, never in code.
- Hooks finish fast and time out quietly.

## 4. Tests

- **Privacy tests are the gate:** fixtures full of code, secrets, paths and personal data must produce output containing only vocabulary terms. A failing privacy test blocks every merge.
- Unit tests for classification, signing and chaining.
- CI runs the secret scan and the tests on every pull request.

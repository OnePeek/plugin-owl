# AGENTS.md: plugin-owl

The Claude Code plug-in that captures work for OnePeek (tier 4). Session-end hooks send closed-vocabulary tags only, redacted on the device, signed and chained, through the MCP `log_work` tool. It is open source so anyone can audit what it sends.

## Built from
The plug-in section of `onepeek-docs/trd/services/clients.md`, the work-log plug-in spec, and `contracts/mcp/` (`log_work`).

## Layout
- `hooks/`: the session-end hooks.
- `redact/`: on-device redaction and the closed tag vocabulary.
- `tests/`: proofs that no source code, file content or secret ever leaves the device.

## Never
- Sending source code, file contents, prompts or anything outside the closed vocabulary.
- Failing loudly: when blocked, it stays silent and the person uses tiers 1 to 3.
- Holding any secret in this public repo.

## Rules every OnePeek repo follows
Read `onepeek-docs/standards/engineering-standards.md` (https://github.com/OnePeek/onepeek-docs/blob/main/standards/engineering-standards.md) before changing anything. In short:
- **Docs first.** A change to behaviour, an API, an event, an MCP tool, data or infrastructure starts as a pull request in `onepeek-docs`. This repo's pull request links to it.
- **Pinned docs.** `docs-version.txt` names the `onepeek-docs` commit this repo implements. CI fails if a contract this repo uses differs from that commit.
- **Generated code** from `onepeek-docs/contracts/` is never edited by hand.
- **Names and language.** Canonical names from founder decision 97; plain English in anything a person reads; never name the prior internal product.
- **Data and secrets.** No secrets and no personal data in this repo: not in code, tests, fixtures, logs or examples.
- **Review.** Every change goes through a pull request with one review. People and AI agents never commit, push, merge or deploy without an explicit instruction.

## Status
Scaffold only. Code starts at low-level design, following the build order in TRD §9.1.

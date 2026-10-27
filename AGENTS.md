# AGENTS.md: plugin-owl

The Claude Code plug-in that captures work for OnePeek (tier 4). Session-end hooks send closed-vocabulary tags only, redacted on the device, signed and chained, through the MCP `log_work` tool. It is open source so anyone can audit what it sends.

## Start here
- For any detail (what to build, how it behaves, names, data, limits), look in `onepeek-docs` first: the sibling folder `../onepeek-docs` or https://github.com/OnePeek/onepeek-docs. Begin with `standards/engineering-standards.md` and `standards/repo-map.md`, then grep and read only the files the task needs.
- If the docs are silent, unclear or disagree with the code, don't guess: ask, or open a docs pull request.

## Built from
The plug-in section of `onepeek-docs/trd/services/clients.md`, the work-log plug-in spec, and `contracts/mcp/` (`log_work`).

## Layout
- `hooks/`: the session-end hooks.
- `redact/`: on-device redaction and the closed tag vocabulary.
- `tests/`: proofs that no source code, file content or secret ever leaves the device.

## Principles
- **Privacy by construction.** Only closed-vocabulary tags, redacted on the device, signed and chained.
- **Never in the way.** When blocked, it stays silent and the person's session carries on.
- **Auditable.** The code is public, and tests prove that no source code, file content or secret leaves the device.

These principles grow over time: when a review teaches us something, add it here in one line.

## Never
- Sending source code, file contents, prompts or anything outside the closed vocabulary.
- Failing loudly: when blocked, it stays silent and the person uses tiers 1 to 3.
- Holding any secret in this public repo.

## Branches and CI
Follow `onepeek-docs/standards/branching-and-delivery.md`. Branch from `dev` as `<type>/<topic>` and open pull requests into `dev`; they run the fast checks. A release is a pull request from `dev` to `release`; merging it tags a version and publishes the plug-in release.
- Workflows: `.github/workflows/checks.yml` calls the shared workflows in `OnePeek/.github`, pinned to a commit SHA; `release.yml` runs on merges into `release`.
- Hooks: run `uvx lefthook install` once after cloning; format, lint and secret checks then run before each commit.
- Dependabot opens grouped weekly updates into `dev`.

## Rules every OnePeek repo follows
Read `onepeek-docs/standards/engineering-standards.md` (https://github.com/OnePeek/onepeek-docs/blob/main/standards/engineering-standards.md) before changing anything. In short:
- **Docs first.** A change to behaviour, an API, an event, an MCP tool, data or infrastructure starts as a pull request in `onepeek-docs`. This repo's pull request links to it.
- **Pinned docs.** `docs-version.txt` names the `onepeek-docs` commit this repo implements. CI fails if a contract this repo uses differs from that commit.
- **Generated code** from `onepeek-docs/contracts/` is never edited by hand.
- **Names and language.** Canonical names from founder decision 97; plain English in anything a person reads; never name the prior internal product.
- **Data and secrets.** No secrets and no personal data in this repo: not in code, tests, fixtures, logs or examples.
- **Pull requests.** Every change goes through a pull request; before launch, review is optional and CodeRabbit is advisory (decision 124). People and AI agents never commit, push, merge or deploy without an explicit instruction.

## Status
Minimal scaffold: the plug-in manifest, an empty `hooks/hooks.json`, `redact/` and `tests/`. Code starts at low-level design, following the build order in TRD §9.1.

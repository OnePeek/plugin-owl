# AGENTS.md: plugin-owl

The Claude Code plug-in that captures work for OnePeek (tier 4). Hooks only enqueue; a background helper sends closed-vocabulary IDs and bands only, scrubbed on the device, signed and chained, through the MCP `log_work` tool (LLD `clients/worklog-plugin.md`). It is open source so anyone can audit what it sends.

## Start here (mandatory, before any change)

1. **Read this file.**
2. **Read this repo's guide** for the area you will touch:
   - `docs/guidelines.md` (structure, privacy rules and tests)
3. **Read `onepeek-docs/standards/code-guidelines.md`** (how all OnePeek code is designed and written), then the **spec for your task** in `onepeek-docs` (sibling folder `../onepeek-docs`, or https://github.com/OnePeek/onepeek-docs): the PRD use case, the TRD section, the HLD and the contract. Grep, then read only what you need.
4. **If the docs are silent, unclear or disagree with the code, stop and ask**, or open a docs pull request. Never invent a requirement, field, limit or name.
5. **In the pull request, list the docs you read.** A change made without steps 1–3 is not done.

**Docs and code in step:** follow `onepeek-docs/standards/spec-to-code.md`. Before any task read the technical HLD (`architecture/hld/`, at least 04 agents and MCP, 11 security) and its client LLD in `architecture/lld/clients/` (not written yet: no code until it is merged). No code for a unit before its LLD (`onepeek-docs/architecture/lld/`) is merged; implement exactly the LLD; if the code needs something the docs do not say, change the docs first; move `docs-version.txt` to the docs commit you implement.

**Documents:** this repo holds only its own guides (`docs/`). Anything shared by two or more repos goes in `onepeek-docs`. Never add plans, notes or summaries.

## Built from
The plug-in section of `onepeek-docs/trd/services/clients.md`, the work-log plug-in spec, and `contracts/mcp/` (`log_work`).

## Layout
- `hooks/`: hook registration (enqueue only); `skills/`: the plug-in's commands.
- `src/`: signals, vocabulary, record, scrub, sign, spool, auth, send (the only network module) and the helper (LLD §5.1).
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

## Build kit (`onepeek-docs/standards/spec-to-code.md` §6)
**One stage at a time** (`onepeek-docs/standards/development-cycle.md`): start a unit only when everything it depends on is finished and it is yours in `architecture/lld/status.yaml` (`in_progress`, `owner`); close every design gap before building; at most two review rounds; stop and report at the agreed time limit.
Claude Code runs these steps as the skill `/build-from-lld` (agents `builder` and `spec-reviewer`); other tools and people follow the same steps by hand. The shared skills are synced from `OnePeek/.github` (`workspace/setup.py --sync-repos`): edit them there, not here.
- **Unit:** `clients/worklog-plugin`.
- **Packet:** `python3 ../.github/workspace/packet.py <unit> --out .context/<name>.md` builds it from the docs at the commit in `docs-version.txt`. Read all of it before writing code.
- **Gates** (all must pass before the pull request, and CI runs them):
  - none yet (see below).
- No build scripts exist yet. The first build task adds them exactly as the LLD's §5.1 layout and §15 testing plan require (`lint`, `typecheck`, `test`, and the privacy suite in `tests/privacy/`, which blocks every merge), plus the CI no-evasion check (WRK 38), and lists them here in the same pull request.
- **Review:** `/review-spec <unit>` with only the packet and the diff; the pull request needs the verdict "ready".

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
Minimal scaffold: the plug-in manifest, an empty `hooks/hooks.json`, `redact/` and `tests/` (the first build moves to the LLD §5.1 `src/` layout and removes `redact/`). Code starts at low-level design, following the build order in TRD §9.1.

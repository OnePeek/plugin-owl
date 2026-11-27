# plugin-owl

The OnePeek AI work-log plug-in for Claude Code. A collector only: it sends exact usage numbers about each AI-assisted session and, only if you said yes, one short cleaned summary per session. It does no scoring. It is open source so anyone can audit what it sends.

- **Install:** `/plugin install onepeek-worklog --marketplace <owner>/<repo>`, then `/onepeek-connect`.
- **Controls (exactly these):** `/onepeek-pause`, `/onepeek-resume`, `/onepeek-off`, `/onepeek-status`, `/onepeek-preview` (read only), `/onepeek-discard` (only records still in the 10 minute hold). Nothing accepts text or numbers from you. `DO_NOT_TRACK=1`, `ONEPEEK_WORKLOG=off` or the file `~/.onepeek/worklog/off` turn everything off.
- **Built from:** `onepeek-docs` LLD `architecture/lld/clients/worklog-plugin.md` (rules AIP-A to AIP-I) and the wire contract `contracts/openapi/ai-plugin.yaml`.
- **Visibility:** Public, Apache-2.0 (open source for audit; the OnePeek name and logo are trademarks, see NOTICE)
- **Rules:** see `AGENTS.md`, `docs/guidelines.md` and the OnePeek engineering standards (https://github.com/OnePeek/onepeek-docs/blob/main/standards/engineering-standards.md).

## Checks

`npm ci && npm run check` runs typecheck, lint (network only in `src/send/`, no-evasion, no scoring words), and the tests including the privacy suite, the 50-transcript injection set and the hook latency test. `npm run eval` runs the quality eval against the real `claude` (30 sessions, pass bar 27 of 30, 0 leaks); `npm run eval:injection` runs the 50 hostile transcripts through the real summariser. Both cost your own tokens and write `evals/results/`.

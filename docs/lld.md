---
title: "LLD: worklog-plugin (the Claude Code work-log plug-in, repo plugin-owl)"
status: draft
last_updated: 2026-10-31
related: [onepeek-docs architecture/hld/04-agents-and-mcp.md, onepeek-docs architecture/hld/10-observability.md, onepeek-docs architecture/hld/11-security.md, onepeek-docs trd/services/clients.md, onepeek-docs trd/work-log-plugin-spec.md, onepeek-docs prd/use-cases/WRK-ai-work-log.md, onepeek-docs architecture/lld/modules/e-candidate-intake/work-capture.md, onepeek-docs architecture/lld/modules/e-candidate-intake/work-log-pipeline.md, onepeek-docs architecture/lld/modules/a-edge-identity-access/grant.md, onepeek-docs architecture/lld/modules/j-ai-clients-conversations/mcp-gateway.md]
module: client-worklog-plugin
domain: clients
tier: edge
services: []
catalogue_units: [worklog-plugin]
hld_refs: [A1, O2, S1, S2, K4]
---

> Moved here from onepeek-docs `architecture/lld/clients/worklog-plugin.md` at eb8f2a8 (PIPE-SIMPLE v2, R-DOCS-LOCAL: a doc lives in the repo whose code it specifies). Other documents are cited as `<repo> <path>`; a bare path such as `platform/telemetry.md`, `clients.md` or `delivery-pipelines.md` names an onepeek-docs file (`architecture/lld/...` or `trd/services/...`), read at onepeek-docs `dev`.

# LLD: worklog-plugin

## 1. Purpose and scope
The tier 4 work-capture plug-in for Claude Code (repo `plugin-owl`, open source). On the person's own machine it turns each coding session into one record of **closed-vocabulary IDs and bands only**. It then scrubs the record, signs it with a per-install key, chains it, spools it, and sends it to Work Capture through the MCP Gateway's `log_work` tool. It owns FR-WRK-11, 34, 35, 38 and 39 and supports 11 more (`trd/services/clients.md` §4).

**In scope:**
- the plug-in package (manifest, hooks, skill);
- the background helper (a local stdio MCP server and CLI);
- the capture lifecycle;
- signal measurement;
- scrubbing and banding;
- signing and chaining;
- the encrypted spool;
- sign-in and install registration;
- the published vocabulary and checksums.

**Out of scope:**
- the server gate, levels, corroboration and anomalies (`work-capture`, `work-log-pipeline`, `abuse-detection`);
- Codex and Cursor (after launch, decision 101);
- tiers 1–3 (setup guides served by `work-capture.setup`).

**Correction to the TRD spec.** `trd/work-log-plugin-spec.md` §1 lists capped free-text fields (`problem.statement`, `dimensions[].reason`, `decisions[]`). FR-WRK-39 (PRD, which ranks above the TRD) allows tier 4 to send only closed-vocabulary IDs and bands, and the server rejects any tier 4 record with a free-text field. So the plug-in never sends those fields: §6.1 below is the tier 4 record. The spec's header now points here.

## 2. Responsibilities and non-responsibilities
| Responsible for | Not responsible for (owner) |
|---|---|
| Hooks that only enqueue, within budget (WRK 34) | Problem class, depth and level (the server's `worklog_classify` and rubric, decision 46) |
| Measuring signals in plug-in code, never by a model (spec §5.1) | Leak gate, vagueness and anomaly rules (Work Capture, Abuse Detection) |
| Scrubbing before signing, and holding records while the denylist is stale (WRK 11) | Linking commits to pull requests (Connector Hub) |
| Signing, chaining and the ordered, idempotent spool (spec §3, §9.5) | Grant and token issuance (Grant) |
| Staying silent when blocked; never probing employer controls (WRK 38) | Install records and chain heads on the server (Work Capture) |
| Publishing the vocabulary, the code and the release checksums (WRK 39) | Deciding what counts as credit |

## 3. Use cases
### UC-PLG-001: Install and connect
1. The person installs the plug-in from its marketplace listing, then runs `/onepeek-connect`.
2. The helper runs the OAuth 2.1 authorisation-code flow with PKCE as a public native client (`onepeek-worklog-plugin`):
   - it uses a loopback redirect on `127.0.0.1` with a random port (RFC 8252);
   - the browser opens Grant's page, the person signs in fresh and ticks the purpose `worklog.capture`;
   - the helper stores the refresh token in the OS key store.
3. The helper generates an Ed25519 key pair, with the private key in the OS key store. It then calls Work Capture `register_install(tool, os, public_key)` with the one-time install code shown on the grant page, and gets back an `install_id`.
4. The self-check runs. If managed settings forbid non-managed hooks or plug-ins, nothing registers and the person is shown the neutral offer of tiers 1–3 (WRK 38).

### UC-PLG-002: A session is captured
1. **`Stop`** (each turn): append turn signals to the session queue file. Only an enqueue; no network or model call.
2. **`PreCompact`**: flush the queue and a pointer to the local transcript.
3. **`SessionEnd`** (exit, Ctrl-C, `/clear`, logout): flush and mark the session complete.
4. **The helper, asynchronously:**
   - builds the record from the measured signals and the session's commits;
   - maps model hints to closed IDs only;
   - scrubs, bands, signs and chains it;
   - spools it and sends it with `log_work`.

### UC-PLG-003: Crash recovery
On `SessionStart`, the hook enqueues a sweep. The helper finds local sessions with turns, no complete mark and no logged record, and recovers each one exactly once by session ID (WRK 34).

### UC-PLG-004: Offline or server refusal
- **Offline:** records stay in the encrypted spool and are resent in order with backoff.
- **`regenerate_request(fields, reason_codes)`:** one stricter rebuild with the named fields dropped, then "not logged".
- **`rejected`:** dropped. The chain still advances on the server.

### UC-PLG-005: Pause, revoke, uninstall
- **Pause or revoke** (from the web app or `/onepeek-pause`): the helper learns the state before every send and sends nothing while paused.
- **Uninstall** deletes the spool and keys. The server install is revoked from the web app.

## 4. Edge cases and failure modes
Every row names its test (LLD-14).

| # | Situation | Behaviour | Person sees | Test |
|---|---|---|---|---|
| E1 | Hook would exceed its budget (about 1.5 s) | Enqueue only, then return; the work moves to the helper | nothing | `test_hooks_only_enqueue_within_budget` |
| E2 | The helper's own headless run fires hooks | `ONEPEEK_WORKLOG_INTERNAL=1` makes every hook exit at once (spec §9.1) | nothing | `test_internal_run_never_logs_itself` |
| E3 | Denylist older than the configured age and refresh fails | Hold every record; send nothing (WRK 11) | "Waiting to refresh privacy rules" in `/onepeek-status` | `test_stale_denylist_holds_records` |
| E4 | A value outside the closed vocabulary or bands | Dropped on the device before signing (WRK 39) | nothing | `test_only_vocabulary_values_leave` |
| E5 | Code, path, secret, URL or name in any input | Never reaches the record; allow-list construction | nothing | `test_hostile_session_yields_vocabulary_only` |
| E6 | Server refuses connection or the install | Stop silently; offer tiers 1–3 neutrally; never retry another host, port or path (WRK 38) | neutral offer | `test_refusal_never_retries_elsewhere` |
| E7 | Managed settings forbid the plug-in | Self-check fails; nothing registers; managed settings are never read beyond Claude Code's own answer | neutral offer | `test_managed_block_registers_nothing` |
| E8 | Crash between `Stop` and `SessionEnd` | Next `SessionStart` sweep recovers it once | nothing | `test_crash_sweep_recovers_exactly_once` |
| E9 | Spool older than `wrk.limits` spool age | Aged out, never sent | count in `/onepeek-status` | `test_old_spool_entries_age_out` |
| E10 | Server says `chain_broken` or `version_retired` | Stop sending; ask to reconnect or update | message in `/onepeek-status` | `test_broken_chain_stops_sending` |
| E11 | Two Claude Code windows at once | One helper process per user (file lock); sequence numbers stay strict | nothing | `test_single_helper_keeps_sequence` |
| E12 | Key store unavailable | A user-only file (mode 0600), labelled as such on the installs page (spec §3) | label | `test_fallback_key_file_is_user_only` |

## 5. Public interface
### 5.1 Package layout (repo `plugin-owl`; amends its `docs/guidelines.md` §2)
```
.claude-plugin/plugin.json       manifest: hooks, skill, MCP server (the helper)
hooks/hooks.json                 Stop, PreCompact, SessionEnd, SessionStart → hooks/enqueue (one entry)
skills/onepeek-worklog/SKILL.md  "Log this now", /onepeek-connect, /onepeek-status, /onepeek-pause
src/
  hook/enqueue.ts                read the hook event, append to the session queue, exit (no I/O beyond the queue)
  signals/                       measured signals from the queue and git (pure)
  vocabulary/                    the closed vocabulary and bands, generated from the published list (wrk.vocab)
  record/                        build the tier 4 record from signals + vocabulary only (pure, allow-list)
  scrub/                         denylist, personal blocklist, learned project names: a second fail-closed layer (pure)
  sign/                          RFC 8785 canonical JSON, SHA-256, Ed25519, chain head
  spool/                         encrypted, ordered, idempotent by record hash
  auth/                          OAuth 2.1 PKCE loopback, token refresh, OS key store
  send/                          the ONLY network module: Grant token endpoint and MCP Gateway log_work
  helper/                        stdio MCP server + CLI (connect, status, pause, flush)
tests/privacy/                   hostile fixtures: only vocabulary values may leave (the merge gate)
tests/unit/
```
- **Language:** TypeScript on Node 22 LTS (provisional, 2026-10-31). Claude Code already requires Node. `node:crypto` provides Ed25519 and SHA-256, and `fetch` is built in.
- **The one runtime dependency** is the official MCP TypeScript SDK, pinned. It's bundled into one file per release, with its SHA-256 published.
- **Network:** only `send/` imports a network API; a lint rule fails any other import of `fetch`, `http`, `https`, `net` or `dns`.
- **Key store:** the OS key store via the platform's own command (`security` on macOS, `secret-tool` on Linux, Credential Manager through PowerShell on Windows), with argument lists only.

### 5.2 Hook contract
`hooks/enqueue` reads the hook JSON on stdin, appends one line to `~/.onepeek/worklog/queue/<session_id>.jsonl`, and exits 0 within the budget. It always exits 0: a hook never fails the person's session.

## 6. Contracts
### 6.1 The tier 4 record (`worklog_insight` v1, tier 4 subset; `wrk.schema`)
`{install_id, seq, prev_hash, created_at_device, versions{schema, vocab, plugin, tool}, insight, signals, commits[]}`. Every value is one of:
- a vocabulary ID, such as `pc.*` hints, `dim.*`, `err.*`, `perf.*` and `mode.*`;
- a band;
- an enum from the spec (`stage`, `depth_hint`);
- a commit hash with diff-stat bands;
- a device-local random `task_key`.

No string field is free text. **The vocabulary is rich and role-aware (decision 131):** the lists live in `wrk.vocab` and grow by policy change, not plug-in release; the helper fetches the subset for the person's work profile (for example data engineer or frontend) with the signed bundle; mapping is deterministic, picking the closest value or `other` rather than dropping work. `record_hash = sha256(RFC8785(record))`, and `sig = Ed25519(record_hash)`. The schema is generated from `wrk.schema` and checked by the privacy tests.

### 6.2 Calls made
| Call | To | When | Failure |
|---|---|---|---|
| OAuth `GET /authorize`, `POST /token` | Grant | connect; refresh before expiry | stop, show "Reconnect" |
| `POST /api/v1/work-capture/installs` (`register_install`) | Work Capture (web API, with the install code) | connect | stop |
| MCP `log_work` → `append_signed(records)` | MCP Gateway → Work Capture | spool drain | keep spooled; backoff |
| MCP `worklog_pause` / pause-state read in the `log_work` reply | MCP Gateway | before each send | send nothing |
| Policy, vocabulary and denylist refresh: `wrk.schema`, `wrk.vocab` and `wrk.denylist`, as a signed bundle from `GET /api/v1/policy/bundles/{family}` (public, signed; `policy-registry.signed_bundle`) | Policy Registry | before every send | hold (E3) |

### 6.3 Events, jobs, workflows
None on the device. The server side is owned by Work Capture (`capture.received.v1`, `capture.paused.v1`).

## 7. Data and state (on the device only)
| Data | Where | Classification | Kept |
|---|---|---|---|
| Session queues | `~/.onepeek/worklog/queue/` (user-only) | Private (local) | until the record is built |
| Spool | `~/.onepeek/worklog/spool/`, AES-256-GCM, key in the OS key store | Private | until accepted or aged out (`wrk.limits`) |
| Install private key, refresh token | OS key store | secret | until uninstall or revoke |
| Denylist, vocabulary, personal blocklist, learned project names | `~/.onepeek/worklog/policy/` (signed bundle; blocklist encrypted) | Private | refreshed before sends |

Nothing is ever logged remotely (HLD O2: no telemetry for `plugin-owl`).

## 8. Internal design
- **Allow-list construction:** `record/` builds output only from vocabulary terms and bands; `scrub/` is a second, independent fail-closed check; anything unknown is dropped, never "cleaned" (guidelines §2).
- **Patterns:** store and forward (spool), hash-chained log, pure core with a thin I/O shell (`send/`, `auth/` and `helper/` are the only I/O).
- **Daily roll-up** is triggered by the first capture event of a new day; there is no device timer (decision 46).

## 9. Design patterns used
| Pattern | Where | Why here |
|---|---|---|
| Store and forward | `spool/` | Nothing is lost offline (WRK 34) |
| Hash chain | `sign/` | Gaps, replays and reorders are detectable (spec §3) |
| Allow-list builder | `record/` | Only closed-vocabulary values can leave (WRK 39) |
| Single network gateway | `send/` | Auditable: one place talks to the network |

## 10. Integrations
- **Work Capture** (`append_signed`, `register_install`, `pause`): its errors map to E6 and E10.
- **Grant:** a first-party public client, `onepeek-worklog-plugin` (grant LLD), audience MCP Gateway.
- **Policy Registry:** signed bundles. A bad signature means hold (E3).
- **Claude Code:** the hooks API and plug-in manifest; Claude Code's own managed-settings outcome (E7).

## 11. Security
**STRIDE**

| Threat | Mitigation |
|---|---|
| Spoofing another install | Per-install Ed25519 key; registration needs an install code issued after a fresh sign-in |
| Tampering with records or order | Signed, hash-chained records; the server checks sequence and previous hash |
| Repudiation | The chain plus server receipt time |
| Information disclosure | Allow-list construction, on-device scrub, no free text, no code; a single destination host |
| Denial of service (to the person's tool) | Hooks only enqueue within budget and always exit 0 |
| Elevation of privilege | The grant covers `worklog.capture` only; the PDP intersects it with the person's rights |

- **ASVS level 2** (V8 Data Protection, V9 Communications).
- **Secrets:** the refresh token and private key live in the OS key store, never in files the repo creates (E12 excepted, labelled).

## 12. Observability
No telemetry from the device (O2). Server-side only:
- records received, and rejects by reason code (Work Capture);
- runbook `rb-worklog-plugin`: a reject-rate spike after a release, or a stale denylist.

`/onepeek-status` shows the person their local state: queue, spool, last send, paused, held.

## 13. Configuration
| Setting | Source | Default |
|---|---|---|
| Hook budget | `wrk.limits` (bundled default 1,500 ms) | 1,500 ms |
| Spool max age, denylist max age | `wrk.limits` | policy |
| Destination host | built in at release (one host, published) | the prod MCP host |

The plug-in reads no environment variables except `ONEPEEK_WORKLOG_INTERNAL` (E2).

## 14. Performance, scaling and cost
- **Speed:** the hook adds under 50 ms at p95 (*proposed*, TRD), with a hard budget of 1.5 s.
- **Helper memory:** under 80 MB (*proposed*).
- **Cost:** none to the person beyond their own tool's headless run. Server cost sits with Work Capture.

## 15. Testing plan
| Level | What is proved |
|---|---|
| Privacy (the merge gate) | Hostile fixtures (code, secrets, paths, names, URLs, customer figures, injections) yield vocabulary-only records; canaries never on the wire (spec §8 leakage set) |
| Unit | Signals, banding, RFC 8785 canonical form, signing and chain, spool order and idempotency, OAuth PKCE |
| Contract | `log_work` and `register_install` request and response shapes against `contracts/` |
| Integration smoke | Install, session end, crash sweep, offline, version mismatch on macOS, Linux and Windows (spec §8) |
| No-evasion | CI check: no read of managed settings, MDM, firewall or proxy configuration; no fallback host (WRK 38) |
| Release | Reproducible bundle; published SHA-256 matches; vocabulary list published (WRK 39) |

## 16. Migration and rollout
- **Order:** this LLD is merged first. Then the Work Capture and Grant code. Then the plug-in.
- **Listing:** the plug-in is listed after the integration smoke set passes on the three operating systems.
- **Rollback:** the server can retire a plug-in version (`version_retired`), and the person reinstalls the previous release.

## 17. Open questions
| # | Question | Who |
|---|---|---|
| Q1 | Band boundaries per field (`wrk.vocab`) | Product engineer, at refinement of `wrk.*` policies |
| Q2 | Sweep frequency beyond `SessionStart` | Proof of concept (spec §11.5) |
| Q3 | Codex and Cursor variants | After launch (decision 101) |

## 18. Docs updated with this LLD
- `trd/work-log-plugin-spec.md` §1: tier 4 sends no free-text fields (FR-WRK-39); this LLD defines the tier 4 subset.
- `architecture/lld/modules/a-edge-identity-access/grant.md`: the plug-in and extension clients; install keys live in Work Capture (not Grant).
- `architecture/lld/modules/l-rules-intelligence-ops/policy-registry.md`: `signed_bundle` for public signed families.

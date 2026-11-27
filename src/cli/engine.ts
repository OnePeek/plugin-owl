// The helper's pipeline: queue -> usage + commits -> (consent) summary -> cleaner -> draft (hold 10 min) -> sign under the
// lock -> send. Hooks only enqueue; every step here runs in the background helper (AIP-B1). Pure parts live in their own
// modules; this file is the shell that orders them.
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, sep } from "node:path";
import { finalizeInsight } from "../record/insight.js";
import { buildGap, buildSession, type BuildMeta } from "../record/build.js";
import { validateRecord } from "../record/schema.js";
import { learnNames, readBlocklist } from "../clean/learned.js";
import { commitsDuring } from "../usage/git.js";
import { parseTranscript } from "../usage/transcript.js";
import { condense } from "../summarise/condense.js";
import { promptSha256 } from "../summarise/prompt.js";
import { GENESIS, signRecord, type SignedRecord } from "../sign/chain.js";
import { Api } from "../send/http.js";
import { PATHS } from "../send/contract.js";
import type { Reason } from "../send/contract.js";
import type { Receipt } from "../spool/index.js";
import { captureAllowed, projectKey, readState } from "../state/store.js";
import type { Ctx } from "./ctx.js";
import { withLock } from "./lock.js";
import { isOff } from "../state/off.js";

const HOLD_DEFAULT_S = 600;
const AGE_DEFAULT_DAYS = 7;
const IDLE_SWEEP_MS = 30 * 60_000;
const MAX_TRANSCRIPT = 50 * 1024 * 1024;
const BATCH_BYTES = 60_000;
const TOKEN_SLACK_MS = 60_000;

interface QueueLine {
  e: string;
  ts: number;
  cwd: string;
  tp: string;
}

/**
 * AIP-H2.8: only a transcript inside Claude Code's own projects folder is read, only once per session, and only the one
 * named after the session (`<session_id>.jsonl`, as Claude Code names it). Limit, stated honestly: code that runs as the
 * person can write into that folder or start the hook with its own CLAUDE_CONFIG_DIR, so this narrows the path, it does
 * not make a crafted transcript impossible (LLD §11 accepted risk: a prompt-injected session has the person's powers).
 */
export function transcriptAllowed(path: string, configDir: string, sessionId?: string): boolean {
  try {
    if (!path.endsWith(".jsonl")) return false;
    if (sessionId !== undefined && basename(path) !== `${sessionId}.jsonl`) return false;
    const real = realpathSync(path);
    const root = realpathSync(join(configDir, "projects")) + sep;
    return real.startsWith(root) && statSync(real).size <= MAX_TRANSCRIPT;
  } catch {
    return false;
  }
}

export interface IngestReport {
  processed: number;
  skipped: number;
  held: number;
}

/** Turn finished (or crashed and idle) sessions into pending drafts. The slow work (summariser) runs outside the lock. */
export async function ingest(ctx: Ctx): Promise<IngestReport> {
  const rep: IngestReport = { processed: 0, skipped: 0, held: 0 };
  if (isOff(ctx.paths)) return rep;
  let files: string[] = [];
  try {
    files = readdirSync(ctx.paths.queueDir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return rep;
  }
  const vault = ctx.vault();
  const hold = (vault.install?.limits.hold_seconds ?? HOLD_DEFAULT_S) * 1000;
  for (const f of files) {
    const file = join(ctx.paths.queueDir, f);
    let rawQueue: string;
    try {
      rawQueue = readFileSync(file, "utf8");
    } catch {
      continue; // another helper already took it
    }
    const lines: QueueLine[] = rawQueue.split("\n").filter(Boolean).flatMap((l) => {
      try {
        return [JSON.parse(l) as QueueLine];
      } catch {
        return [];
      }
    });
    if (lines.length === 0) continue;
    const last = lines[lines.length - 1] as QueueLine;
    const ended = lines.some((l) => l.e === "SessionEnd");
    const idle = ctx.now() - last.ts > IDLE_SWEEP_MS;
    if (!ended && !idle) continue; // still running
    const withTp = [...lines].reverse().find((l) => l.tp !== "");
    const cwd = [...lines].reverse().find((l) => l.cwd !== "")?.cwd ?? "";
    // consume the queue file first: a session is recovered exactly once (E8)
    try {
      renameSync(file, file.replace(/\.jsonl$/, ".done")); // an atomic claim: only one helper wins
    } catch {
      continue;
    }
    if (!withTp || !captureAllowed(readState(ctx.paths.stateFile), projectKey(cwd)) || !transcriptAllowed(withTp.tp, ctx.claudeConfigDir, f.replace(/\.jsonl$/, ""))) {
      rep.skipped++;
      continue;
    }
    const parsed = parseTranscript(readFileSync(withTp.tp, "utf8"));
    if (!parsed.usage || parsed.usage.prompt_count === 0) {
      rep.skipped++;
      continue;
    }
    const commits = await commitsDuring(cwd, parsed.usage.started_at_device, parsed.usage.ended_at_device);
    let insight;
    let holdReason: string | undefined;
    const wantsText = ctx.consent()?.summaries === true && ctx.controls().summaries_consent !== false;
    if (wantsText) {
      const names = await learnNames(cwd, readBlocklist(join(ctx.paths.policyDir, "blocklist.json")));
      const input = condense(parsed.steps);
      const raw = await ctx.summariser(input.text);
      if (raw !== undefined) {
        const r = finalizeInsight(raw, { ...names, taint: input.taint });
        if (r.ok) insight = r.insight;
        else if (r.reason === "leak") holdReason = "cleaner_hit"; // AIP-E2: a leak hit after cleaning holds the record (device code)
        else if (r.reason === "caps") holdReason = "schema_invalid"; // AIP-E3: over a cap is not sent
      }
    }
    const now = ctx.now();
    const draft = { session_ref: randomUUID(), created_at_device: new Date(now).toISOString(), tool_version: parsed.version ?? "unknown", usage: parsed.usage, commits, ...(insight ? { insight } : {}) };
    await withLock(ctx.paths.lockFile, () => {
      ctx.spool.append({ t: "pending", id: draft.session_ref, at: now, eligible_at: now + hold, draft, project: projectKey(cwd) });
      if (holdReason) ctx.spool.append({ t: "held", id: draft.session_ref, at: now, reason: holdReason });
    });
    rep.processed++;
    if (holdReason) rep.held++;
  }
  // forget old markers
  try {
    for (const f of readdirSync(ctx.paths.queueDir)) if (f.endsWith(".done") && ctx.now() - statSync(join(ctx.paths.queueDir, f)).mtimeMs > 14 * 86_400_000) rmSync(join(ctx.paths.queueDir, f));
  } catch {
    // nothing to prune
  }
  return rep;
}

function meta(ctx: Ctx, seq: number, prev: string, createdIso: string, keyStore: "hardware" | "software", tv: string): BuildMeta {
  return { env: ctx.vault().install?.env === "local" || ctx.vault().install?.env === "preprod" ? (ctx.vault().install?.env as "local" | "preprod") : "prod", install_id: ctx.vault().install!.install_id, seq, prev_hash: prev, created_at_device: createdIso, key_store: keyStore, plugin_version: ctx.info.pluginVersion, plugin_build_sha256: ctx.buildSha256(), prompt_sha256: promptSha256(), tool_version: tv.slice(0, 32) };
}

export type SendOutcome = "idle" | "sent" | "wait" | "stopped";

function applyControls(ctx: Ctx, body: unknown): void {
  const c = (body as { controls?: { state?: string; summaries_consent?: boolean; build_status?: string } } | undefined)?.controls;
  if (!c) return;
  const cur = ctx.controls();
  if (c.state === "active" || c.state === "paused") cur.server_state = c.state;
  if (typeof c.summaries_consent === "boolean") cur.summaries_consent = c.summaries_consent;
  if (typeof c.build_status === "string") cur.build_status = c.build_status;
  ctx.saveControls(cur);
}

/**
 * A DPoP-bound access token. Only ever called inside a send, under the file lock (AIP-D10, D12, H2.2): one refresher at a
 * time, and a helper that comes later reuses the stored token instead of presenting the (already rotated) refresh token.
 * `force` refreshes even when the stored token looks valid (after a 401 `invalid_token` or `dpop_invalid`).
 */
export async function accessToken(ctx: Ctx, api: Api, force = false): Promise<string | undefined> {
  const v = ctx.vault();
  if (!force && v.access_token && (v.access_expires_at ?? 0) - TOKEN_SLACK_MS > ctx.now()) return v.access_token;
  if (!v.refresh_token) return undefined;
  const r = await api.call("POST", PATHS.token, { form: { grant_type: "refresh_token", refresh_token: v.refresh_token, client_id: "onepeek-worklog-plugin" } });
  const b = r.body as { access_token?: string; refresh_token?: string; expires_in?: number } | undefined;
  if (r.status !== 200 || !b?.access_token || !b.refresh_token) {
    const c = ctx.controls();
    c.blocked = "reconnect";
    c.last_error = r.reason ?? r.oauthError ?? `http_${r.status}`;
    ctx.saveControls(c);
    const { access_token: _a, access_expires_at: _e, ...rest } = ctx.vault();
    ctx.saveVault(rest);
    return undefined;
  }
  const ttl = typeof b.expires_in === "number" && b.expires_in > 0 ? b.expires_in * 1000 : 600_000;
  // rotation: the old refresh token is dead the moment this returns, so the new one is stored before anything else happens
  ctx.saveVault({ ...ctx.vault(), refresh_token: b.refresh_token, access_token: b.access_token, access_expires_at: ctx.now() + ttl });
  return b.access_token;
}

/** Why sending must not start now (AIP-D12: nothing is signed while paused, off, blocked or waiting), or undefined. */
function gate(ctx: Ctx): SendOutcome | undefined {
  const ctl = ctx.controls();
  const local = readState(ctx.paths.stateFile);
  if (isOff(ctx.paths) || local.global !== "on") return "idle";
  if (ctl.blocked && ctl.blocked !== "reconnect") return "stopped";
  if ((ctl.blocked_until ?? 0) > ctx.now() || (ctl.next_attempt_at ?? 0) > ctx.now()) return "wait";
  return undefined;
}

/**
 * One send (AIP-D12, §6.3): under the file lock, sign the drafts that are due, in order, extending the chain, and send them;
 * one install per request. No signed record outlives the send unsent, except after a network error, when the next send
 * retries the SAME bytes first (the server answers an already stored record_hash with its original receipt).
 */
export async function send(ctx: Ctx): Promise<SendOutcome> {
  const v = ctx.vault();
  if (!v.install || !ctx.signer()) return "idle";
  const early = gate(ctx);
  if (early) return early;
  const r = await withLock(ctx.paths.lockFile, () => sendLocked(ctx), 120_000);
  return r.ok ? r.value : "wait";
}

function byteFit(sz: number, bytes: number, n: number): boolean {
  return n === 0 || bytes + sz <= BATCH_BYTES;
}

async function sendLocked(ctx: Ctx): Promise<SendOutcome> {
  const early = gate(ctx); // re-read under the lock: a pause typed while this helper waited wins
  if (early) return early;
  const v = ctx.vault();
  const signer = ctx.signer();
  if (!v.install || !signer) return "idle";
  const install = v.install;
  const installId = install.install_id;
  const age = (install.limits.max_record_age_days || AGE_DEFAULT_DAYS) * 86_400_000;
  const perRequest = Math.min(50, install.limits.max_records_per_request || 50);
  const api = new Api(ctx.info.apiBase, signer, ctx.fetchImpl, v.dpop_nonce);
  let token: string | undefined;
  let any = false;
  let resynced = false;

  /** Void every signed, unsent record of this install (any server answer other than a receipt re-derives them). */
  const unsignAll = (): void => {
    for (const it of ctx.spool.items()) if (it.state === "signed" && it.installId === installId) ctx.spool.append({ t: "unsigned", id: it.id, at: ctx.now() });
  };

  for (let round = 0; round < 64; round++) {
    const items = ctx.spool.items();
    const st = readState(ctx.paths.stateFile);
    // 1. signed bytes still unsent after a network error: retried first, unchanged
    const picked = items.filter((i) => i.state === "signed" && i.installId === installId && i.signed).sort((a, b) => a.signed!.record.seq - b.signed!.record.seq);
    let bytes = 2 + picked.reduce((n, i) => n + JSON.stringify(i.signed).length + 1, 0);
    // 2. drafts that are due: signed now, at send time, from the current head
    let head = picked.length > 0 ? picked[picked.length - 1]!.signed : ctx.spool.head(installId);
    for (const it of items) {
      if (picked.length >= perRequest) break;
      if (!it.draft || (it.state !== "pending" && it.state !== "discard" && it.state !== "held")) continue;
      if (it.state !== "discard" && it.eligibleAt > ctx.now()) continue; // still in the hold window
      if (it.project !== undefined && !captureAllowed(st, it.project)) continue; // that project is paused or off: stays a draft
      const seq = (head?.record.seq ?? 0) + 1;
      const m = meta(ctx, seq, head?.record_hash ?? GENESIS, it.draft.created_at_device, install.key_store, it.draft.tool_version);
      let rec;
      if (it.state === "discard") rec = buildGap(m, "discarded", "discarded_by_person");
      else if (it.state === "held") rec = buildGap(m, "held", it.reason ?? "cleaner_hit");
      else if (ctx.now() - it.created > age) rec = buildGap(m, "expired", "record_too_old"); // aged out: never the full record
      else rec = buildSession(m, it.draft.session_ref, it.draft.usage, it.draft.commits, it.draft.insight);
      if (validateRecord(rec).length > 0) {
        ctx.spool.append({ t: "held", id: it.id, at: ctx.now(), reason: "schema_invalid" });
        rec = buildGap(m, "held", "schema_invalid");
      }
      const env = signRecord(rec, signer);
      const sz = JSON.stringify(env).length + 1;
      if (!byteFit(sz, bytes, picked.length)) break;
      ctx.spool.append({ t: "signed", id: it.id, at: ctx.now(), install_id: installId, env });
      picked.push({ ...it, state: "signed", signed: env, installId });
      bytes += sz;
      head = env;
    }
    if (picked.length === 0) return any ? "sent" : "idle";

    const c = ctx.controls();
    let reply;
    try {
      token ??= await accessToken(ctx, api);
      if (!token) {
        unsignAll();
        return "stopped";
      }
      const body = { records: picked.map((i) => i.signed as SignedRecord) };
      reply = await api.call("POST", PATHS.records, { token, json: body });
      if (reply.status === 401 && (reply.reason === "invalid_token" || reply.reason === "dpop_invalid")) {
        token = await accessToken(ctx, api, true); // refresh once, retry once (§6.3)
        if (!token) {
          unsignAll();
          return "stopped";
        }
        reply = await api.call("POST", PATHS.records, { token, json: body });
      }
    } catch {
      // network error: the signed bytes stay as they are and the next send retries them first (AIP-D12); back off
      const cc = ctx.controls();
      cc.failures = (cc.failures ?? 0) + 1;
      cc.next_attempt_at = ctx.now() + backoff(cc.failures);
      cc.last_error = "network";
      ctx.saveControls(cc);
      return any ? "sent" : "wait";
    }
    ctx.saveVault({ ...ctx.vault(), ...(api.nonce ? { dpop_nonce: api.nonce } : {}) });
    if (reply.status === 200) {
      const receipts = ((reply.body as { receipts?: Receipt[] } | undefined)?.receipts ?? []) as Receipt[];
      for (const it of picked) {
        const rc = receipts.find((x) => x.record_hash === it.signed!.record_hash);
        if (rc) ctx.spool.append({ t: "sent", id: it.id, at: ctx.now(), receipt: rc });
      }
      unsignAll(); // a record the server did not receipt is re-derived next time, never left signed
      applyControls(ctx, reply.body);
      const cur = ctx.controls();
      delete cur.next_attempt_at;
      delete cur.blocked;
      delete cur.last_error;
      cur.failures = 0;
      cur.last_send_at = ctx.now();
      if (cur.server_state === "paused") cur.next_attempt_at = ctx.now() + 600_000; // paused from the web app: sign nothing more
      ctx.saveControls(cur);
      any = true;
      if (cur.server_state === "paused") return "sent";
      continue;
    }
    const why: Reason | undefined = reply.reason;
    c.last_error = why ?? `http_${reply.status}`;
    if (reply.status === 422) {
      // the server stored nothing: the record at failed_index will never be sent; a content-free `held` entry takes its seq
      const idx = (reply.body as { failed_index?: number } | undefined)?.failed_index;
      const at = typeof idx === "number" && idx >= 0 && idx < picked.length ? idx : 0;
      const target = picked[at]!;
      const rec = target.signed!.record;
      if (rec.kind !== "session") {
        c.blocked = "needs_reset"; // a gap entry itself was refused: stop, never loop
        ctx.saveControls(c);
        unsignAll();
        return "stopped";
      }
      for (const later of picked.slice(at)) ctx.spool.append({ t: "unsigned", id: later.id, at: ctx.now() }); // re-chained on the next round
      ctx.spool.append({ t: "held", id: target.id, at: ctx.now(), reason: why ?? "schema_invalid" });
      const m = meta(ctx, rec.seq, rec.prev_hash, rec.created_at_device, rec.key_store, rec.tool_version);
      ctx.spool.append({ t: "signed", id: target.id, at: ctx.now(), install_id: installId, env: signRecord(buildGap(m, "held", why ?? "schema_invalid"), signer) });
      ctx.saveControls(c);
      continue;
    }
    if (reply.status === 409 && (why === "seq_gap" || why === "seq_conflict" || why === "prev_hash_mismatch")) {
      // UC-PLG-004: read expected_seq; when it is the seq after our last receipt, re-derive from there once; else the chain is lost
      const expected = (reply.body as { expected_seq?: number } | undefined)?.expected_seq;
      const lastSent = Math.max(0, ...ctx.spool.items().filter((i) => i.receipt && i.installId === installId).map((i) => i.signed!.record.seq));
      unsignAll();
      if (!resynced && typeof expected === "number" && expected === lastSent + 1 && picked[0]!.signed!.record.seq !== expected) {
        resynced = true;
        ctx.saveControls(c);
        continue;
      }
      c.blocked = "needs_reset";
      ctx.saveControls(c);
      return any ? "sent" : "stopped";
    }
    unsignAll(); // every other server answer re-derives the records at the next send (AIP-D12)
    if (reply.status === 403 && (why === "key_revoked" || why === "install_expired")) c.blocked = why === "key_revoked" ? "revoked" : "expired";
    else if (reply.status === 403 && why === "install_paused") {
      c.server_state = "paused";
      c.next_attempt_at = ctx.now() + 600_000;
    } else if (reply.status === 403 && why === "key_mismatch") c.blocked = "reconnect";
    else if (reply.status === 401 && why === "token_scope") c.blocked = "scope";
    else if (reply.status === 401 || reply.status === 404) c.blocked = "reconnect";
    else if (reply.status === 413 || reply.status === 415) c.blocked = "bug"; // §6.3: a bug; stop and show it in status
    else if (reply.status === 429) c.next_attempt_at = ctx.now() + (why === "daily_cap" || why === "gap_limit" ? untilMidnightUtc(ctx.now()) : (reply.retryAfter ?? 60) * 1000);
    else {
      c.failures = (c.failures ?? 0) + 1;
      c.next_attempt_at = ctx.now() + backoff(c.failures);
    }
    ctx.saveControls(c);
    return any ? "sent" : "stopped";
  }
  return any ? "sent" : "idle";
}

/** 1 min doubling to 1 h (§6.3). */
function backoff(failures: number): number {
  return Math.min(3_600_000, 60_000 * 2 ** Math.min(Math.max(failures, 1) - 1, 6));
}

function untilMidnightUtc(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now;
}

/** One background run: ingest, release, send; then wait out the hold of anything still pending (never longer than the hold plus a minute). */
export async function drain(ctx: Ctx, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<void> {
  const deadline = ctx.now() + (ctx.vault().install?.limits.hold_seconds ?? HOLD_DEFAULT_S) * 1000 + 60_000;
  for (;;) {
    try {
      await ingest(ctx);
      await send(ctx);
    } catch {
      return; // never in the way: stay silent
    }
    const next = ctx.spool.items().filter((i) => i.state === "pending").map((i) => i.eligibleAt).sort((a, b) => a - b)[0];
    if (next === undefined || next > deadline) return;
    await sleep(Math.max(1000, next - ctx.now() + 500));
  }
}

export function markExists(f: string): boolean {
  return existsSync(f);
}
export function touch(f: string): void {
  writeFileSync(f, "");
}

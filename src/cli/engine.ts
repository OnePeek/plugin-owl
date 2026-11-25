// The helper's pipeline: queue -> usage + commits -> (consent) summary -> cleaner -> draft (hold 10 min) -> sign under the
// lock -> send. Hooks only enqueue; every step here runs in the background helper (AIP-B1). Pure parts live in their own
// modules; this file is the shell that orders them.
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
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

interface QueueLine {
  e: string;
  ts: number;
  cwd: string;
  tp: string;
}

/** AIP-H2.8: only a transcript inside Claude Code's own projects folder is read, and only once per session. */
export function transcriptAllowed(path: string, configDir: string): boolean {
  try {
    if (!path.endsWith(".jsonl")) return false;
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
    if (!withTp || !captureAllowed(readState(ctx.paths.stateFile), projectKey(cwd)) || !transcriptAllowed(withTp.tp, ctx.claudeConfigDir)) {
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
      const raw = await ctx.summariser(condense(parsed.steps));
      if (raw !== undefined) {
        const r = finalizeInsight(raw, names);
        if (r.ok) insight = r.insight;
        else if (r.reason === "leak") holdReason = "content_held"; // AIP-E2: a leak hit after cleaning holds the record
      }
    }
    const now = ctx.now();
    const draft = { session_ref: randomUUID(), created_at_device: new Date(now).toISOString(), tool_version: parsed.version ?? "unknown", usage: parsed.usage, commits, ...(insight ? { insight } : {}) };
    await withLock(ctx.paths.lockFile, () => {
      ctx.spool.append({ t: "pending", id: draft.session_ref, at: now, eligible_at: now + hold, draft });
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

/** Sign every draft that has left the hold window (or been discarded, or expired), in creation order, extending the chain. */
export async function release(ctx: Ctx): Promise<number> {
  const v = ctx.vault();
  const signer = ctx.signer();
  if (!v.install || !signer) return 0;
  const age = (v.install.limits.max_record_age_days || AGE_DEFAULT_DAYS) * 86_400_000;
  const r = await withLock(ctx.paths.lockFile, () => {
    let n = 0;
    const installId = v.install!.install_id;
    for (const it of ctx.spool.items()) {
      const due = it.state === "discard" || (it.state === "pending" && it.eligibleAt <= ctx.now());
      if (!due || !it.draft) continue;
      const head = ctx.spool.head(installId);
      const seq = (head?.record.seq ?? 0) + 1;
      const prev = head?.record_hash ?? GENESIS;
      const m = meta(ctx, seq, prev, it.draft.created_at_device, v.install!.key_store, it.draft.tool_version);
      let rec;
      if (it.state === "discard") rec = buildGap(m, "discarded");
      else if (ctx.now() - it.created > age) rec = buildGap(m, "expired", "record_too_old");
      else rec = buildSession(m, it.draft.session_ref, it.draft.usage, it.draft.commits, it.draft.insight);
      if (validateRecord(rec).length > 0) {
        ctx.spool.append({ t: "held", id: it.id, at: ctx.now(), reason: "schema_invalid" });
        rec = buildGap(m, "held", "schema_invalid");
      }
      ctx.spool.append({ t: "signed", id: it.id, at: ctx.now(), install_id: installId, env: signRecord(rec, signer) });
      n++;
    }
    return n;
  });
  return r.ok ? r.value : 0;
}

/** Items that were held while still pending (the cleaner hit): they leave as a `held` gap entry, never as content. */
export async function releaseHeldDrafts(ctx: Ctx): Promise<void> {
  // A draft marked held by the cleaner is still state "held" in the fold; turn it into a gap at its place in the chain.
  const v = ctx.vault();
  const signer = ctx.signer();
  if (!v.install || !signer) return;
  await withLock(ctx.paths.lockFile, () => {
    for (const it of ctx.spool.items()) {
      if (it.state !== "held" || it.signed || !it.draft || it.eligibleAt > ctx.now()) continue;
      const head = ctx.spool.head(v.install!.install_id);
      const m = meta(ctx, (head?.record.seq ?? 0) + 1, head?.record_hash ?? GENESIS, it.draft.created_at_device, v.install!.key_store, it.draft.tool_version);
      ctx.spool.append({ t: "signed", id: it.id, at: ctx.now(), install_id: v.install!.install_id, env: signRecord(buildGap(m, "held", it.reason ?? "content_held"), signer) });
    }
  });
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

/** Re-sign every unsent record after `fromSeq` so each extends the new head (after a gap entry replaced the record at fromSeq). */
function resignAfter(ctx: Ctx, installId: string, gap: SignedRecord): void {
  const signer = ctx.signer()!;
  const fromSeq = gap.record.seq;
  let prev = gap;
  for (const it of ctx.spool.items()) {
    if (!it.signed || it.installId !== installId || it.state !== "signed" || it.signed.record.seq <= fromSeq) continue;
    const rec = { ...it.signed.record, prev_hash: prev.record_hash };
    const env = signRecord(rec, signer);
    ctx.spool.append({ t: "signed", id: it.id, at: ctx.now(), install_id: installId, env });
    prev = env;
  }
}

export async function accessToken(ctx: Ctx, api: Api): Promise<string | undefined> {
  const v = ctx.vault();
  if (!v.refresh_token) return undefined;
  const r = await api.call("POST", PATHS.token, { form: { grant_type: "refresh_token", refresh_token: v.refresh_token, client_id: "onepeek-worklog-plugin" } });
  const b = r.body as { access_token?: string; refresh_token?: string } | undefined;
  if (r.status !== 200 || !b?.access_token || !b.refresh_token) {
    const c = ctx.controls();
    c.blocked = "reconnect";
    c.last_error = r.reason ?? r.oauthError ?? `http_${r.status}`;
    ctx.saveControls(c);
    return undefined;
  }
  ctx.saveVault({ ...ctx.vault(), refresh_token: b.refresh_token }); // rotation: the old one is dead the moment this returns
  return b.access_token;
}

/** Send every signed, unsent record of the current install, in order, one install per request (AIP-D3, §6.3). */
export async function send(ctx: Ctx): Promise<SendOutcome> {
  const v = ctx.vault();
  const signer = ctx.signer();
  if (!v.install || !signer) return "idle";
  const ctl = ctx.controls();
  const local = readState(ctx.paths.stateFile);
  if (isOff(ctx.paths) || local.global !== "on") return "idle";
  if (ctl.blocked && ctl.blocked !== "reconnect") return "stopped";
  if (ctl.server_state === "paused" && (ctl.next_attempt_at ?? 0) > ctx.now()) return "wait";
  if ((ctl.blocked_until ?? 0) > ctx.now() || (ctl.next_attempt_at ?? 0) > ctx.now()) return "wait";
  const installId = v.install.install_id;
  const api = new Api(ctx.info.apiBase, signer, ctx.fetchImpl, v.dpop_nonce);
  let token: string | undefined;
  let any = false;

  for (let round = 0; round < 8; round++) {
    const batch = ctx.spool.items().filter((i) => i.state === "signed" && i.installId === installId && i.signed).slice(0, 50);
    const picked: typeof batch = [];
    let bytes = 2;
    for (const it of batch) {
      const sz = JSON.stringify(it.signed).length + 1;
      if (bytes + sz > BATCH_BYTES && picked.length > 0) break;
      picked.push(it);
      bytes += sz;
    }
    if (picked.length === 0) return any ? "sent" : "idle";
    token ??= await accessToken(ctx, api);
    if (!token) return "stopped";
    let reply = await api.call("POST", PATHS.records, { token, json: { records: picked.map((i) => i.signed as SignedRecord) } });
    if (reply.status === 401 && (reply.reason === "token_invalid" || reply.reason === "dpop_invalid")) {
      token = await accessToken(ctx, api);
      if (!token) return "stopped";
      reply = await api.call("POST", PATHS.records, { token, json: { records: picked.map((i) => i.signed as SignedRecord) } });
    }
    ctx.saveVault({ ...ctx.vault(), ...(api.nonce ? { dpop_nonce: api.nonce } : {}) });
    const c = ctx.controls();
    if (reply.status === 200) {
      const receipts = ((reply.body as { receipts?: Receipt[] } | undefined)?.receipts ?? []) as Receipt[];
      for (const it of picked) {
        const rc = receipts.find((x) => x.record_hash === it.signed!.record_hash);
        if (rc) ctx.spool.append({ t: "sent", id: it.id, at: ctx.now(), receipt: rc });
      }
      applyControls(ctx, reply.body);
      delete c.next_attempt_at;
      c.failures = 0;
      c.last_send_at = ctx.now();
      delete c.blocked;
      ctx.saveControls({ ...ctx.controls(), ...c, ...(ctx.controls().server_state ? { server_state: ctx.controls().server_state as "active" | "paused" } : {}) });
      any = true;
      continue;
    }
    const why: Reason | undefined = reply.reason;
    c.last_error = why ?? `http_${reply.status}`;
    if (reply.status === 403 && (why === "key_revoked" || why === "install_expired")) c.blocked = why === "key_revoked" ? "revoked" : "expired"; // show "this device was revoked"
    else if (reply.status === 403 && why === "install_paused") {
      c.server_state = "paused";
      c.next_attempt_at = ctx.now() + 600_000;
    } else if (reply.status === 401 && why === "token_scope") c.blocked = "scope";
    else if (reply.status === 401 || reply.status === 404) c.blocked = "reconnect";
    else if (reply.status === 409 && (why === "seq_gap" || why === "seq_conflict" || why === "prev_hash_mismatch")) c.blocked = "needs_reset";
    else if (reply.status === 429) c.next_attempt_at = ctx.now() + (why === "daily_cap" || why === "gap_limit" ? untilMidnightUtc(ctx.now()) : (reply.retryAfter ?? 60) * 1000);
    else if (reply.status === 413 || reply.status === 422) {
      // the server stored nothing: the record at failed_index will never be sent; a content-free `held` entry takes its seq
      const idx = (reply.body as { failed_index?: number } | undefined)?.failed_index;
      const target = picked[typeof idx === "number" && idx >= 0 && idx < picked.length ? idx : 0] as (typeof picked)[number];
      if (target.signed!.record.kind === "held" || target.signed!.record.kind === "expired") {
        c.blocked = "needs_reset"; // the gap entry itself was refused: stop, never loop
        ctx.saveControls(c);
        return "stopped";
      }
      const rec = target.signed!.record;
      const m = meta(ctx, rec.seq, rec.prev_hash, rec.created_at_device, rec.key_store, rec.tool_version);
      ctx.spool.append({ t: "held", id: target.id, at: ctx.now(), reason: why ?? "schema_invalid" });
      const gap = signRecord(buildGap(m, "held", why ?? "schema_invalid"), signer);
      ctx.spool.append({ t: "signed", id: target.id, at: ctx.now(), install_id: installId, env: gap });
      resignAfter(ctx, installId, gap);
      ctx.saveControls(c);
      continue;
    } else {
      c.failures = (c.failures ?? 0) + 1;
      c.next_attempt_at = ctx.now() + Math.min(3_600_000, 60_000 * 2 ** Math.min(c.failures - 1, 6)); // 1 min doubling to 1 h
    }
    ctx.saveControls(c);
    return any ? "sent" : "stopped";
  }
  return any ? "sent" : "idle";
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
      await releaseHeldDrafts(ctx);
      await release(ctx);
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

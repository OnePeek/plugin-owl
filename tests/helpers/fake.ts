// A fake OnePeek server behind `fetch`, enforcing the contract's checks in the contract's order (DPoP with nonce, owner and
// key binding, hash, signature, chain, consent, text rules). It records every request so tests can prove what went on the wire.
import { createHash } from "node:crypto";
import { checkText } from "../../src/clean/filter.js";
import { validateRecord } from "../../src/record/schema.js";
import { verifyEnvelope, type SignedRecord } from "../../src/sign/chain.js";
import { thumbprint, verifySig, type PublicJwk } from "../../src/sign/keys.js";
import type { FetchLike } from "../../src/send/http.js";

interface Seen {
  method: string;
  url: string;
  path: string;
  body: string;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): ReturnType<FetchLike> =>
  Promise.resolve({ status, headers: { get: (n: string) => headers[n] ?? headers[n.toLowerCase()] ?? null }, text: () => Promise.resolve(JSON.stringify(body)) });

const problem = (status: number, reason_code: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): ReturnType<FetchLike> => json(status, { status, reason_code, ...extra }, headers);

export class FakeServer {
  base = "https://api.test.onepeek";
  seen: Seen[] = [];
  accepted: SignedRecord[] = [];
  consent = true;
  revoked = false;
  paused = false;
  /** When set, the next POST /records fails with this status and reason (once); `network` makes fetch throw instead. */
  failNext: { status: number; reason?: string; index?: number; expected_seq?: number; retryAfter?: number; network?: boolean; afterStore?: boolean } | undefined;
  /** Every refresh token presented to /token, in order (a replay shows up as a duplicate). */
  refreshPresented: string[] = [];
  installJwk: PublicJwk | undefined;
  installId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  installBody: Record<string, unknown> | undefined;
  /** The token reply's account_email (contract optional); undefined leaves it out. */
  accountEmail: string | undefined = "me@example.test";
  private nonce = "nonce-1";
  private refreshLive = new Set<string>();
  private tokens = new Map<string, string>(); // access token -> jkt
  private counter = 0;
  private keyJkt: string | undefined;

  get allBodies(): string {
    return this.seen.map((s) => s.body).join("\n");
  }
  get hosts(): Set<string> {
    return new Set(this.seen.map((s) => new URL(s.url).host));
  }

  fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const body = init.body ?? "";
    this.seen.push({ method: init.method, url, path: u.pathname, body });
    const proof = init.headers["DPoP"];
    const dp = proof ? this.checkProof(proof, init.method, url) : undefined;
    if (!dp) return problem(401, "dpop_invalid");
    if (dp === "need_nonce") return json(400, { error: "use_dpop_nonce" }, { "DPoP-Nonce": this.nonce });
    if (u.pathname === "/api/v1/oauth/token") return this.token(body, dp.jkt);
    if (u.pathname === "/api/v1/oauth/revoke") return json(200, {});
    const auth = init.headers["Authorization"] ?? "";
    const at = auth.startsWith("DPoP ") ? auth.slice(5) : "";
    if (!this.tokens.has(at) || this.tokens.get(at) !== dp.jkt) return problem(401, "invalid_token");
    if (dp.ath !== createHash("sha256").update(at).digest("base64url")) return problem(401, "dpop_invalid");
    if (u.pathname === "/api/v1/connectors/ai-plugin/installs") return this.register(body, dp.jkt);
    if (u.pathname === "/api/v1/connectors/ai-plugin/records") return this.records(body);
    return problem(404, "not_found");
  };

  private checkProof(p: string, method: string, url: string): "need_nonce" | { jkt: string; ath?: string } | undefined {
    const [h, pl, sg] = p.split(".");
    if (!h || !pl || !sg) return undefined;
    const header = JSON.parse(Buffer.from(h, "base64url").toString()) as { typ: string; alg: string; jwk: PublicJwk };
    const payload = JSON.parse(Buffer.from(pl, "base64url").toString()) as { htm: string; htu: string; iat: number; nonce?: string; ath?: string; jti: string };
    if (header.typ !== "dpop+jwt" || !["ES256", "EdDSA"].includes(header.alg)) return undefined;
    if (!verifySig(header.jwk, Buffer.from(`${h}.${pl}`, "ascii"), Buffer.from(sg, "base64url"))) return undefined;
    if (payload.htm !== method || payload.htu !== url.split("?")[0]) return undefined;
    if (payload.nonce !== this.nonce) return "need_nonce";
    return { jkt: thumbprint(header.jwk), ...(payload.ath ? { ath: payload.ath } : {}) };
  }

  private token(body: string, jkt: string): ReturnType<FetchLike> {
    const f = new URLSearchParams(body);
    if (f.get("grant_type") === "authorization_code") {
      if (f.get("code") !== "CODE") return json(400, { error: "invalid_grant" });
    } else if (f.get("grant_type") === "refresh_token") {
      const r = f.get("refresh_token") ?? "";
      this.refreshPresented.push(r);
      if (!this.refreshLive.has(r)) {
        this.refreshLive.clear(); // replayed refresh: the whole family dies (AIP-H2.2)
        return json(400, { error: "invalid_grant" });
      }
      this.refreshLive.delete(r);
    } else return json(400, { error: "unsupported_grant_type" });
    const at = `AT-${++this.counter}`;
    const rt = `RT-${this.counter}`;
    this.tokens.set(at, jkt);
    this.refreshLive.add(rt);
    this.keyJkt = jkt;
    return json(200, { access_token: at, token_type: "DPoP", expires_in: 600, refresh_token: rt, scope: "worklog.capture", audience: "api", ...(this.accountEmail !== undefined ? { account_email: this.accountEmail } : {}) });
  }

  private register(body: string, jkt: string): ReturnType<FetchLike> {
    const b = JSON.parse(body) as { public_key: PublicJwk; consent_text: boolean } & Record<string, unknown>;
    if (thumbprint(b.public_key) !== jkt) return problem(403, "key_mismatch");
    const need = ["public_key", "key_alg", "key_store", "tool", "tool_version", "os", "plugin_version", "plugin_build_sha256", "device_name", "consent_text", "consent_version"];
    for (const k of need) if (b[k] === undefined) return problem(422, "schema_invalid");
    this.installJwk = b.public_key;
    this.installBody = b;
    this.consent = b.consent_text === true;
    return json(201, { install_id: this.installId, key_id: jkt, key_expires_at: "2027-11-26T00:00:00Z", state: "active", env: "prod", audience: "onepeek-ai-plugin", genesis_prev_hash: "0".repeat(64), key_store: b["key_store"], key_store_verified: false, limits: { max_body_bytes: 65536, max_records_per_request: 50, max_records_per_person_per_day: 2000, hold_seconds: 600, max_record_age_days: 7, max_clock_ahead_seconds: 600 }, server_time: new Date().toISOString() });
  }

  private records(body: string): ReturnType<FetchLike> {
    if (body.length > 65536) return problem(413, "body_too_large");
    if (this.failNext && !this.failNext.afterStore) {
      const f = this.failNext;
      this.failNext = undefined;
      if (f.network) throw new TypeError("fetch failed");
      return problem(f.status, f.reason ?? "unavailable", { ...(f.index !== undefined ? { failed_index: f.index } : {}), ...(f.expected_seq !== undefined ? { expected_seq: f.expected_seq } : {}) }, f.retryAfter ? { "Retry-After": String(f.retryAfter) } : {});
    }
    if (this.revoked) return problem(403, "key_revoked");
    if (this.paused) return problem(403, "install_paused");
    const recs = (JSON.parse(body) as { records: SignedRecord[] }).records;
    if (recs.length > 50) return problem(422, "batch_too_large");
    let last = this.accepted[this.accepted.length - 1];
    const fresh: SignedRecord[] = [];
    const receiptOf = (e: SignedRecord) => ({ install_id: this.installId, record_hash: e.record_hash, seq: e.record.seq, server_time: new Date().toISOString(), server_sig: "sig", receipt_key_id: "k1" });
    for (let i = 0; i < recs.length; i++) {
      const e = recs[i] as SignedRecord;
      // contract step 5: a record_hash already stored gets its ORIGINAL receipt, no new write
      if (this.accepted.some((a) => a.record_hash === e.record_hash)) continue;
      if (validateRecord(e.record).length > 0) return problem(422, "schema_invalid", { failed_index: i });
      if (e.record.install_id !== this.installId) return problem(404, "not_found");
      if (!this.installJwk || !verifyEnvelope(e, this.installJwk)) return problem(422, "bad_signature", { failed_index: i });
      const expected_seq = (last?.record.seq ?? 0) + 1;
      if (e.record.seq < expected_seq) return problem(409, "seq_conflict", { failed_index: i, expected_seq });
      if (e.record.seq !== expected_seq) return problem(409, "seq_gap", { failed_index: i, expected_seq });
      if (e.record.prev_hash !== (last?.record_hash ?? "0".repeat(64))) return problem(409, "prev_hash_mismatch", { failed_index: i, expected_seq });
      const ins = e.record.insight;
      if (ins && !this.consent) return problem(422, "no_text_consent", { failed_index: i });
      if (ins && [ins.summary, ...ins.decisions, ...ins.skills].some((t) => checkText(t).length > 0)) return problem(422, "content_held", { failed_index: i });
      last = e;
      fresh.push(e);
    }
    const receipts = recs.map(receiptOf);
    this.accepted.push(...fresh);
    if (this.failNext?.afterStore) {
      // the server stored the records but the answer never arrived (a network error after the write)
      this.failNext = undefined;
      throw new TypeError("fetch failed");
    }
    return json(200, { receipts, controls: { state: this.paused ? "paused" : "active", summaries_consent: this.consent, key_expires_at: "2027-11-26T00:00:00Z", build_status: "ok" }, server_time: new Date().toISOString() });
  }
}

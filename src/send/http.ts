// THE network module (AIP-H1): the only file that calls `fetch`. No redirects are followed and no other host is ever
// tried (WRK 38): a refusal ends the attempt.
import { dpopProof, type Signer } from "../sign/keys.js";
import { reasonOf, type Reason } from "./contract.js";

export interface Reply {
  status: number;
  body: unknown;
  retryAfter?: number;
  reason?: Reason;
  oauthError?: string;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; redirect: "error"; signal: AbortSignal }) => Promise<{ status: number; headers: { get(n: string): string | null }; text(): Promise<string> }>;

export class Api {
  nonce: string | undefined;
  constructor(public base: string, private signer: Signer, private fetchImpl: FetchLike = fetch as unknown as FetchLike, nonce?: string) {
    this.nonce = nonce;
  }

  private async once(method: string, path: string, o: { json?: unknown; form?: Record<string, string>; token?: string }): Promise<Reply> {
    const url = this.base + path;
    const headers: Record<string, string> = { DPoP: dpopProof(this.signer, { method, url, ...(this.nonce ? { nonce: this.nonce } : {}), ...(o.token ? { accessToken: o.token } : {}) }), Accept: "application/json" };
    if (o.token) headers["Authorization"] = `DPoP ${o.token}`;
    let body: string | undefined;
    if (o.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(o.json);
    } else if (o.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(o.form).toString();
    }
    const res = await this.fetchImpl(url, { method, headers, ...(body !== undefined ? { body } : {}), redirect: "error", signal: AbortSignal.timeout(20_000) });
    const n = res.headers.get("DPoP-Nonce");
    if (n) this.nonce = n;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await res.text());
    } catch {
      parsed = undefined;
    }
    const reason = reasonOf(parsed);
    const oauthError = parsed && typeof parsed === "object" && typeof (parsed as { error?: unknown }).error === "string" ? ((parsed as { error: string }).error) : undefined;
    const ra = Number(res.headers.get("Retry-After"));
    return { status: res.status, body: parsed, ...(reason ? { reason } : {}), ...(oauthError ? { oauthError } : {}), ...(Number.isFinite(ra) && ra > 0 ? { retryAfter: ra } : {}) };
  }

  /** One call; when the server asks for its DPoP nonce, the same call is repeated once with it (RFC 9449 s8). */
  async call(method: string, path: string, o: { json?: unknown; form?: Record<string, string>; token?: string } = {}): Promise<Reply> {
    let r = await this.once(method, path, o);
    if ((r.oauthError === "use_dpop_nonce" || r.reason === "dpop_nonce_required") && this.nonce) r = await this.once(method, path, o);
    return r;
  }
}

// Every path and reason code of contracts/openapi/ai-plugin.yaml, in ONE place. The contract is provisional on two points
// (coordinator, 2026-11-26): OAuth lives under /api/v1/oauth, and every error is an RFC 9457 problem with a lowercase
// `reason_code`. Changing either is an edit to this file only.
export const PATHS = {
  authorize: "/api/v1/oauth/authorize",
  token: "/api/v1/oauth/token",
  revoke: "/api/v1/oauth/revoke",
  installs: "/api/v1/connectors/ai-plugin/installs",
  records: "/api/v1/connectors/ai-plugin/records",
  rotate: (id: string): string => `/api/v1/connectors/ai-plugin/installs/${id}/rotate`,
  root: (date: string): string => `/api/v1/connectors/ai-plugin/roots/${date}`,
  proof: (hash: string): string => `/api/v1/connectors/ai-plugin/receipts/${hash}/proof`,
} as const;

export const CLIENT_ID = "onepeek-worklog-plugin";
export const SCOPE = "worklog.capture";
export const CONSENT_QUESTION = "Share short summaries of my AI work with OnePeek?";
export const CONSENT_VERSION = "2026-11-26.1";

export const REASONS = [
  "oauth_bad_request", "token_invalid", "dpop_invalid", "dpop_nonce_required", "token_scope", "stepup_required", "refresh_reused",
  "key_revoked", "install_expired", "install_paused", "key_mismatch", "not_found", "seq_gap", "seq_conflict", "prev_hash_mismatch",
  "install_limit", "reset_limit", "body_too_large", "unsupported_media_type", "duplicate_key", "int_range", "schema_invalid",
  "batch_too_large", "wrong_env", "hash_mismatch", "bad_signature", "unknown_build", "unknown_prompt", "clock_ahead",
  "record_too_old", "no_text_consent", "content_held", "injection_screen", "scan_timeout", "rate_limited", "daily_cap", "unavailable",
] as const;
export type Reason = (typeof REASONS)[number];

/** Read the reason out of an error body: `reason_code` (RFC 9457 extension), tolerating the older `reason` key and any case. Unknown text becomes undefined; a value from the request is never echoed. */
export function reasonOf(body: unknown): Reason | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  const raw = typeof b["reason_code"] === "string" ? b["reason_code"] : typeof b["reason"] === "string" ? b["reason"] : "";
  const v = raw.toLowerCase();
  return (REASONS as readonly string[]).includes(v) ? (v as Reason) : undefined;
}

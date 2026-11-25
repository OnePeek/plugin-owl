import { createHash, randomBytes } from "node:crypto";

export interface Pkce {
  verifier: string;
  challenge: string;
  state: string;
}

/** RFC 7636 S256 with a 32-byte verifier, and a 32-byte state (the contract wants 32 or more characters). */
export function newPkce(): Pkce {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url"), state: randomBytes(32).toString("base64url") };
}

export function randomPort(): number {
  return 1024 + Math.floor(Math.random() * (65535 - 1024));
}

export function authorizeUrl(base: string, path: string, o: { clientId: string; scope: string; port: number; pkce: Pkce; jkt: string }): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: o.clientId,
    redirect_uri: `http://127.0.0.1:${o.port}/callback`,
    scope: o.scope,
    state: o.pkce.state,
    code_challenge: o.pkce.challenge,
    code_challenge_method: "S256",
    dpop_jkt: o.jkt,
  });
  return `${base}${path}?${q.toString()}`;
}

import { existsSync, readFileSync, rmSync } from "node:fs";
import { writeJsonPrivate } from "../state/store.js";
import { open, seal } from "./crypto.js";
import type { KeyAlg } from "../sign/keys.js";

/** Everything secret and per-install, encrypted at rest under the master key. */
export interface Vault {
  install?: {
    install_id: string;
    alg: KeyAlg;
    private_pem: string;
    key_store: "hardware" | "software";
    key_expires_at: string;
    env: string;
    genesis_prev_hash: string;
    limits: { hold_seconds: number; max_record_age_days: number; max_records_per_request: number; max_body_bytes: number };
  };
  refresh_token?: string;
  /** The current DPoP-bound access token (10 min), reused by later helpers instead of refreshing again (AIP-H2.2). */
  access_token?: string;
  access_expires_at?: number;
  dpop_nonce?: string;
  account_email?: string;
}

export function readVault(file: string, master: Buffer): Vault {
  if (!existsSync(file)) return {};
  try {
    const doc = JSON.parse(readFileSync(file, "utf8")) as { v: string };
    return JSON.parse(open(master, doc.v, "vault").toString("utf8")) as Vault;
  } catch {
    return {};
  }
}

export function writeVault(file: string, master: Buffer, v: Vault): void {
  writeJsonPrivate(file, { v: seal(master, Buffer.from(JSON.stringify(v)), "vault") });
}

export function wipeVault(file: string): void {
  rmSync(file, { force: true });
}

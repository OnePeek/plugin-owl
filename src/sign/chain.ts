import { createHash } from "node:crypto";
import type { Record_ } from "../record/schema.js";
import { canonicalize } from "./jcs.js";
import { b64u, verifySig, type KeyAlg, type PublicJwk, type Signer } from "./keys.js";

export const GENESIS = "0".repeat(64);

export interface SignedRecord {
  record: Record_;
  record_hash: string;
  sig: string;
  sig_alg: KeyAlg;
}

export const hashRecord = (r: Record_): Buffer => createHash("sha256").update(canonicalize(r), "utf8").digest();

/** AIP-D1: record_hash = sha256(RFC8785(record)); sig is made over the 32 raw digest bytes. */
export function signRecord(record: Record_, signer: Signer): SignedRecord {
  const digest = hashRecord(record);
  return { record, record_hash: digest.toString("hex"), sig: b64u(signer.sign(digest)), sig_alg: signer.alg };
}

export function verifyEnvelope(e: SignedRecord, jwk: PublicJwk): boolean {
  const digest = hashRecord(e.record);
  return digest.toString("hex") === e.record_hash && verifySig(jwk, digest, Buffer.from(e.sig, "base64url"));
}

/** Walk a chain in order; return the seq of the first bad entry, or undefined when the whole chain holds. */
export function firstBadSeq(chain: SignedRecord[], jwk: PublicJwk): number | undefined {
  let prev = GENESIS;
  let seq = 0;
  for (const e of chain) {
    seq += 1;
    if (e.record.seq !== seq || e.record.prev_hash !== prev || !verifyEnvelope(e, jwk)) return e.record.seq;
    prev = e.record_hash;
  }
  return undefined;
}

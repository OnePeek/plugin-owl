// Install key, signatures and DPoP proofs (AIP-D1, D2, H2.2). Algorithms use the contract's names: P-256 (ECDSA, SHA-256,
// raw r||s) and Ed25519; the JWS names for DPoP are ES256 and EdDSA.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign as nodeSign, verify as nodeVerify, type KeyObject } from "node:crypto";

export type KeyAlg = "P-256" | "Ed25519";
export type KeyStoreKind = "hardware" | "software";

export interface PublicJwk {
  kty: "EC" | "OKP";
  crv: "P-256" | "Ed25519";
  x: string;
  y?: string;
}

export interface Signer {
  alg: KeyAlg;
  keyStore: KeyStoreKind;
  publicJwk: PublicJwk;
  /** Sign the 32 raw digest bytes (records) or any bytes (DPoP). */
  sign(data: Buffer): Buffer;
}

export const b64u = (b: Buffer): string => b.toString("base64url");

export function jwkOf(pub: KeyObject): PublicJwk {
  const j = pub.export({ format: "jwk" }) as Record<string, string>;
  if (j["kty"] === "EC") return { kty: "EC", crv: "P-256", x: j["x"] as string, y: j["y"] as string };
  return { kty: "OKP", crv: "Ed25519", x: j["x"] as string };
}

/** RFC 7638 thumbprint: SHA-256 over the required members in lexicographic order. */
export function thumbprint(jwk: PublicJwk): string {
  const canon = jwk.kty === "EC" ? `{"crv":"${jwk.crv}","kty":"EC","x":"${jwk.x}","y":"${jwk.y}"}` : `{"crv":"${jwk.crv}","kty":"OKP","x":"${jwk.x}"}`;
  return createHash("sha256").update(canon).digest("base64url");
}

export interface SoftwareKey {
  alg: KeyAlg;
  privatePem: string;
}

export function generateSoftwareKey(alg: KeyAlg): SoftwareKey {
  const { privateKey } = alg === "P-256" ? generateKeyPairSync("ec", { namedCurve: "prime256v1" }) : generateKeyPairSync("ed25519");
  return { alg, privatePem: privateKey.export({ type: "pkcs8", format: "pem" }) as string };
}

export function softwareSigner(k: SoftwareKey): Signer {
  const priv = createPrivateKey(k.privatePem);
  const pub = createPublicKey(priv);
  return {
    alg: k.alg,
    keyStore: "software",
    publicJwk: jwkOf(pub),
    sign: (data) => (k.alg === "P-256" ? nodeSign("sha256", data, { key: priv, dsaEncoding: "ieee-p1363" }) : nodeSign(null, data, priv)),
  };
}

export function verifySig(jwk: PublicJwk, data: Buffer, sig: Buffer): boolean {
  try {
    const pub = createPublicKey({ key: jwk as unknown as import("node:crypto").JsonWebKey, format: "jwk" });
    return jwk.kty === "EC" ? nodeVerify("sha256", data, { key: pub, dsaEncoding: "ieee-p1363" }, sig) : nodeVerify(null, data, pub, sig);
  } catch {
    return false;
  }
}

/** A platform hardware key (Secure Enclave, TPM) behind the same shape. None is bundled yet: see `createInstallSigner`. */
export interface HardwareProvider {
  create(): Promise<Signer>;
}

/** AIP-D2: hardware P-256 where present and working; any failure in creating, signing or verifying falls back to software. */
export async function createInstallSigner(hw?: HardwareProvider): Promise<{ signer: Signer; software?: SoftwareKey }> {
  if (hw) {
    try {
      const s = await hw.create();
      const probe = Buffer.from(randomUUID());
      if (s.alg === "P-256" && s.keyStore === "hardware" && verifySig(s.publicJwk, probe, s.sign(probe))) return { signer: s };
    } catch {
      // fall through to software
    }
  }
  const software = generateSoftwareKey("Ed25519");
  return { signer: softwareSigner(software), software };
}

// ---- DPoP (RFC 9449) ----
const jws = (alg: KeyAlg): "ES256" | "EdDSA" => (alg === "P-256" ? "ES256" : "EdDSA");

export function dpopProof(signer: Signer, o: { method: string; url: string; nonce?: string; accessToken?: string; now?: number; jti?: string }): string {
  const header = { typ: "dpop+jwt", alg: jws(signer.alg), jwk: signer.publicJwk };
  const payload: Record<string, unknown> = { jti: o.jti ?? randomUUID(), htm: o.method.toUpperCase(), htu: o.url.split("?")[0], iat: Math.floor((o.now ?? Date.now()) / 1000) };
  if (o.nonce) payload["nonce"] = o.nonce;
  if (o.accessToken) payload["ath"] = createHash("sha256").update(o.accessToken).digest("base64url");
  const signingInput = b64u(Buffer.from(JSON.stringify(header))) + "." + b64u(Buffer.from(JSON.stringify(payload)));
  return signingInput + "." + b64u(signer.sign(Buffer.from(signingInput, "ascii")));
}

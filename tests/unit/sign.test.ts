import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildGap } from "../../src/record/build.js";
import { validateRecord } from "../../src/record/schema.js";
import { GENESIS, firstBadSeq, hashRecord, signRecord, verifyEnvelope } from "../../src/sign/chain.js";
import { canonicalize } from "../../src/sign/jcs.js";
import { createInstallSigner, dpopProof, generateSoftwareKey, softwareSigner, thumbprint, verifySig, type Signer } from "../../src/sign/keys.js";
import { open, seal } from "../../src/keystore/crypto.js";
import { openMasterKey } from "../../src/keystore/os.js";
import { randomBytes } from "node:crypto";

const meta = (seq: number, prev: string) => ({ env: "prod" as const, install_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", seq, prev_hash: prev, created_at_device: "2026-11-20T10:00:00.000Z", key_store: "software" as const, plugin_version: "0.1.0", plugin_build_sha256: "a".repeat(64), prompt_sha256: "b".repeat(64), tool_version: "2.1.332" });

test("test_rfc8785_vectors", () => {
  // RFC 8785 section 3.2.3: members sort by UTF-16 code units of their names
  const o = { "€": "Euro Sign", "\r": "Carriage Return", "\n": "Newline", "1": "One", "\u0080": "Control", "😂": "Emoji", "ö": "Latin Small Letter O With Diaeresis", "דּ": "Hebrew Letter Dalet With Dagesh", "</script>": "Browser Challenge" };
  const c = canonicalize(o);
  const order = ["\n", "\r", "1", "</script>", "\u0080", "\u00f6", "\u20ac", "\ud83d\ude02", "\ufb33"].map((k) => c.indexOf(JSON.stringify(k) + ":"));
  assert.deepEqual([...order].sort((x, y) => x - y), order);
  assert.ok(order.every((i) => i >= 0));
  assert.equal(canonicalize({ b: 2, a: [true, "x\u000a", { z: 1, y: 0 }] }), '{"a":[true,"x\\n",{"y":0,"z":1}],"b":2}');
  assert.equal(canonicalize({ literals: [true, false], n: 9007199254740991 }), '{"literals":[true,false],"n":9007199254740991}');
  assert.throws(() => canonicalize({ n: 1.5 }));
  assert.throws(() => canonicalize({ n: 9007199254740992 }));
  assert.throws(() => canonicalize({ n: null }));
});

test("test_record_hash_sig", () => {
  for (const alg of ["Ed25519", "P-256"] as const) {
    const s = softwareSigner(generateSoftwareKey(alg));
    const env = signRecord(buildGap(meta(1, GENESIS), "discarded", "discarded_by_person"), s);
    assert.equal(env.record_hash, hashRecord(env.record).toString("hex"));
    assert.equal(env.sig.length, 86); // 64 raw bytes, base64url without padding
    assert.equal(env.sig_alg, alg);
    assert.ok(verifyEnvelope(env, s.publicJwk));
    const tampered = { ...env, record: { ...env.record, seq: 2 } };
    assert.ok(!verifyEnvelope(tampered, s.publicJwk));
    assert.ok(!verifySig(softwareSigner(generateSoftwareKey(alg)).publicJwk, hashRecord(env.record), Buffer.from(env.sig, "base64url")));
  }
});

test("chain: first bad seq is reported", () => {
  const s = softwareSigner(generateSoftwareKey("Ed25519"));
  const a = signRecord(buildGap(meta(1, GENESIS), "discarded", "discarded_by_person"), s);
  const b = signRecord(buildGap(meta(2, a.record_hash), "discarded"), s);
  const c = signRecord(buildGap(meta(3, b.record_hash), "discarded"), s);
  assert.equal(firstBadSeq([a, b, c], s.publicJwk), undefined);
  const edited = { ...b, record: { ...b.record, plugin_version: "9.9.9" } };
  assert.equal(firstBadSeq([a, edited, c], s.publicJwk), 2);
  assert.equal(firstBadSeq([a, c], s.publicJwk), 3); // a removed record breaks the sequence
});

test("test_fallback_to_software_key", async () => {
  const failing = { create: async (): Promise<Signer> => { throw new Error("no enclave"); } };
  const r = await createInstallSigner(failing);
  assert.equal(r.signer.keyStore, "software");
  assert.equal(r.signer.alg, "Ed25519");
  // a hardware signer whose signature does not verify also falls back
  const bad = softwareSigner(generateSoftwareKey("P-256"));
  const lying: Signer = { ...bad, keyStore: "hardware", sign: () => Buffer.alloc(64) };
  const r2 = await createInstallSigner({ create: async () => lying });
  assert.equal(r2.signer.keyStore, "software");
  // a working hardware-style P-256 signer is used as is
  const good: Signer = { ...bad, keyStore: "hardware" };
  assert.equal((await createInstallSigner({ create: async () => good })).signer.keyStore, "hardware");
});

test("thumbprint is stable and key-specific", () => {
  const a = softwareSigner(generateSoftwareKey("P-256"));
  assert.equal(thumbprint(a.publicJwk), thumbprint(a.publicJwk));
  assert.equal(thumbprint(a.publicJwk).length, 43);
  assert.notEqual(thumbprint(a.publicJwk), thumbprint(softwareSigner(generateSoftwareKey("P-256")).publicJwk));
});

test("dpop proof carries htm, htu without query, ath, nonce and verifies", () => {
  for (const alg of ["Ed25519", "P-256"] as const) {
    const s = softwareSigner(generateSoftwareKey(alg));
    const p = dpopProof(s, { method: "post", url: "https://x.test/a?b=1", nonce: "n", accessToken: "tok", now: 1_700_000_000_000 });
    const [h, pl, sg] = p.split(".") as [string, string, string];
    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    const payload = JSON.parse(Buffer.from(pl, "base64url").toString());
    assert.equal(header.typ, "dpop+jwt");
    assert.equal(header.alg, alg === "P-256" ? "ES256" : "EdDSA");
    assert.equal(payload.htm, "POST");
    assert.equal(payload.htu, "https://x.test/a");
    assert.equal(payload.iat, 1_700_000_000);
    assert.equal(payload.nonce, "n");
    assert.ok(payload.ath);
    assert.ok(verifySig(header.jwk, Buffer.from(`${h}.${pl}`, "ascii"), Buffer.from(sg, "base64url")));
  }
});

test("gap entries are content-free and validate; session fields on a gap are refused", () => {
  assert.deepEqual(validateRecord(buildGap(meta(1, GENESIS), "held", "content_held")), []);
  assert.deepEqual(validateRecord(buildGap(meta(1, GENESIS), "discarded", "discarded_by_person")), []);
  assert.ok(validateRecord(buildGap(meta(1, GENESIS), "discarded")).some((e) => e.path === "reason_code" && e.code === "required")); // contract: required on every gap kind
  assert.ok(validateRecord(buildGap(meta(1, GENESIS), "expired")).some((e) => e.path === "reason_code"));
  assert.ok(validateRecord(buildGap(meta(1, GENESIS), "held")).some((e) => e.code === "required")); // a held entry needs its reason code
  const bad = { ...buildGap(meta(1, GENESIS), "discarded", "discarded_by_person"), insight: { summary: "x" } };
  assert.ok(validateRecord(bad).some((e) => e.code === "forbidden_field"));
  assert.ok(validateRecord({ ...buildGap(meta(1, GENESIS), "discarded", "discarded_by_person"), surprise: 1 }).some((e) => e.code === "unknown_field"));
});

test("AES-GCM sealing binds to its place", () => {
  const k = randomBytes(32);
  const blob = seal(k, Buffer.from("secret"), "spool:3");
  assert.equal(open(k, blob, "spool:3").toString(), "secret");
  assert.throws(() => open(k, blob, "spool:4"));
  assert.throws(() => open(randomBytes(32), blob, "spool:3"));
});

test("test_fallback_key_file_is_user_only", async () => {
  const root = mkdtempSync(join(tmpdir(), "owl-key-"));
  const none = async () => ({ ok: false, out: "", err: "no bus", code: 127 });
  const { store, key } = await openMasterKey(root, "linux", none); // no Secret Service at first use: the user-only file
  assert.equal(store.name, "user-file");
  const { statSync } = await import("node:fs");
  assert.equal(statSync(join(root, "master.key")).mode & 0o077, 0);
  assert.equal(key.length, 32);
  assert.ok((await openMasterKey(root, "linux", none)).key.equals(key));
});

test("OS key store is reached with argument lists, secret on stdin where supported", async () => {
  const calls: { cmd: string; args: string[]; stdin?: string }[] = [];
  const store = new Map<string, string>();
  const exec = async (cmd: string, args: string[], stdin?: string) => {
    calls.push({ cmd, args, ...(stdin !== undefined ? { stdin } : {}) });
    if (cmd === "secret-tool" && args[0] === "store") {
      store.set("k", stdin ?? "");
      return { ok: true, out: "" };
    }
    if (cmd === "secret-tool" && args[0] === "lookup") return store.has("k") ? { ok: true, out: store.get("k") as string } : { ok: false, out: "" };
    return { ok: false, out: "" };
  };
  const root = mkdtempSync(join(tmpdir(), "owl-key-"));
  const r = await openMasterKey(root, "linux", exec);
  assert.equal(r.store.name, "secret-service");
  const store1 = calls.find((c) => c.args[0] === "store");
  assert.ok(store1?.stdin && !store1.args.join(" ").includes(store1.stdin)); // the secret is never in argv
});

test("macOS key store: the secret goes to `security -i` on stdin and is never in argv", async () => {
  const calls: { cmd: string; args: string[]; stdin?: string }[] = [];
  let stored = "";
  const exec = async (cmd: string, args: string[], stdin?: string) => {
    calls.push({ cmd, args, ...(stdin !== undefined ? { stdin } : {}) });
    if (args[0] === "-i") {
      stored = /-w ([0-9a-f]{64})/.exec(stdin ?? "")?.[1] ?? "";
      return { ok: true, out: "" };
    }
    if (args[0] === "find-generic-password") return stored ? { ok: true, out: stored } : { ok: false, out: "" };
    return { ok: false, out: "" };
  };
  const root = mkdtempSync(join(tmpdir(), "owl-key-"));
  const r = await openMasterKey(root, "darwin", exec);
  assert.equal(r.store.name, "macos-keychain");
  assert.ok(stored.length === 64 && r.key.toString("hex") === stored);
  for (const c of calls) assert.ok(!c.args.join(" ").includes(stored), "the secret appeared in argv: " + c.args.join(" ").slice(0, 40));
  assert.ok(calls.some((c) => c.args[0] === "-i" && c.stdin?.includes(stored)));
});

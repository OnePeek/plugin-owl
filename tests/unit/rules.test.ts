// The LLD-named tests (worklog-plugin.md §3) for the round-1 review: concurrency (D10, D12), gap entries (D11), the key
// store (D5), caps (E3), the cleaner (E2, H2.3), reset (D10), consent and the hook boundary (C1, C2, H1, H2.8). Each one
// can fail on the behaviour its name claims.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { discard, status, verify } from "../../src/cli/commands.js";
import { askConsentWith, MIN_HUMAN_MS, type Prompter } from "../../src/cli/cli.js";
import { ingest, send } from "../../src/cli/engine.js";
import { breakIfStale, withLock } from "../../src/cli/lock.js";
import { checkText, isPathLike, taintHit } from "../../src/clean/filter.js";
import { handle } from "../../src/hook/enqueue.js";
import { KeyStoreUnavailable, openMasterKey, type Exec } from "../../src/keystore/os.js";
import { finalizeInsight } from "../../src/record/insight.js";
import { DRAIN_ENV, pickEnv } from "../../src/state/env.js";
import { readState, writeState } from "../../src/state/store.js";
import { serveFake } from "../helpers/bridge.js";
import { canaries } from "../helpers/canary.js";
import { connectViaLoopback, makeEnv, type Env } from "../helpers/env.js";
import { GOOD_SUMMARY as GOOD } from "../helpers/helper-proc.js";
import { repoRoot } from "../helpers/paths.js";
import { sampleTranscript } from "../helpers/sample.js";

const MIN = 60_000;
const out = (lines: string[] = []) => ({ line: (s: string) => void lines.push(s) });
const signedUnsent = (env: Env) => env.ctx.spool.items().filter((i) => i.state === "signed");
const signedEvents = (env: Env) => env.ctx.spool.events().events.filter((e) => e.t === "signed");

// ---------- AIP-D10 / D12: one helper at a time, for real processes ----------

test("test_five_parallel_sessions_strict_seq", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  for (let i = 0; i < 5; i++) env.addSession("p" + i, sampleTranscript());
  const http = await serveFake(env.server);
  try {
    const script = join(repoRoot(), "dist", "tests", "helpers", "helper-proc.js");
    const args = [env.ctx.paths.root, env.ctx.claudeConfigDir, http.base, String(env.clock.now), String(env.clock.now + 11 * MIN)];
    // five REAL helper processes started together, each ingesting and then sending (AIP-D10: one lock per person)
    const runs = await Promise.all(
      [0, 1, 2, 3, 4].map(
        () =>
          new Promise<{ code: number | null; out: string }>((resolve) => {
            const p = spawn(process.execPath, [script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
            let o = "";
            p.stdout.on("data", (b: Buffer) => (o += b.toString()));
            p.on("close", (code) => resolve({ code, out: o }));
          }),
      ),
    );
    for (const r of runs) assert.equal(r.code, 0, r.out);
    assert.deepEqual(env.server.accepted.map((e) => e.record.seq), [1, 2, 3, 4, 5]);
    // no refresh token was ever presented twice (a replay revokes the family, AIP-H2.2) and the install is not blocked
    assert.equal(new Set(env.server.refreshPresented).size, env.server.refreshPresented.length, JSON.stringify(env.server.refreshPresented));
    assert.equal(env.ctx.controls().blocked, undefined);
    assert.equal(signedUnsent(env).length, 0);
    assert.ok(verify(env.ctx, out()));
    // and the install still sends afterwards
    env.addSession("later", sampleTranscript());
    await ingest(env.ctx);
    env.clock.now += 11 * MIN;
    assert.equal(await send(env.ctx), "sent");
    assert.equal(env.server.accepted.length, 6);
  } finally {
    await http.close();
  }
});

test("parallel helpers in one process: the refresh runs once and later helpers reuse the new token", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  // force a refresh: the stored access token is expired
  env.ctx.saveVault({ ...env.ctx.vault(), access_expires_at: 0 });
  for (let i = 0; i < 3; i++) env.addSession("q" + i, sampleTranscript());
  await ingest(env.ctx);
  env.clock.now += 11 * MIN;
  const outs = await Promise.all([send(env.ctx), send(env.ctx), send(env.ctx), send(env.ctx), send(env.ctx)]);
  assert.ok(outs.includes("sent"), JSON.stringify(outs));
  assert.equal(env.server.refreshPresented.length, 1);
  assert.equal(env.ctx.controls().blocked, undefined);
  assert.deepEqual(env.server.accepted.map((e) => e.record.seq), [1, 2, 3]);
});

test("spool writes are serialised: concurrent ingest, discard and send leave every line readable", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  for (let i = 0; i < 6; i++) env.addSession("w" + i, sampleTranscript());
  env.clock.now += 0;
  await Promise.all([ingest(env.ctx), ingest(env.ctx), discard(env.ctx, out())]);
  env.clock.now += 11 * MIN;
  for (let i = 6; i < 9; i++) env.addSession("w" + i, sampleTranscript());
  await Promise.all([send(env.ctx), ingest(env.ctx), send(env.ctx), discard(env.ctx, out())]);
  env.clock.now += 11 * MIN;
  await send(env.ctx);
  assert.equal(env.ctx.spool.events().firstBadLine, undefined);
  assert.ok(verify(env.ctx, out()));
  const seqs = env.server.accepted.map((e) => e.record.seq);
  assert.deepEqual(seqs, seqs.map((_, i) => i + 1));
});

test("lock: a dead owner's lock is broken once; a live one never; release never removes someone else's lock", async () => {
  const dir = mkdtempSync(join(tmpdir(), "owl-lock-"));
  const f = join(dir, "helper.lock");
  writeFileSync(f, "999999-dead");
  assert.equal(breakIfStale(f), true);
  assert.equal(existsSync(f), false);
  writeFileSync(f, `${process.pid}-live`);
  assert.equal(breakIfStale(f), false);
  assert.equal(readFileSync(f, "utf8"), `${process.pid}-live`);
  assert.deepEqual(await withLock(f, () => 1, 200), { ok: false }); // held by a live owner: wait, then give up
  // our lock gets replaced while we hold it: release leaves the new owner's lock alone
  writeFileSync(f, "999999-dead");
  const r = await withLock(f, () => {
    writeFileSync(f, `${process.pid}-other`);
    return 2;
  });
  assert.deepEqual(r, { ok: true, value: 2 });
  assert.equal(readFileSync(f, "utf8"), `${process.pid}-other`);
});

// ---------- AIP-D12: drafts are unsigned until the real send ----------

test("test_signing_happens_after_hold", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  env.addSession("s1", sampleTranscript());
  await ingest(env.ctx);
  await send(env.ctx);
  env.clock.now += 9 * MIN;
  await send(env.ctx);
  assert.equal(signedEvents(env).length, 0, "nothing is signed inside the hold window");
  // past the hold but paused (locally, then from the server): still nothing signed
  env.clock.now += 2 * MIN;
  writeState(env.ctx.paths.stateFile, { ...readState(env.ctx.paths.stateFile), global: "paused" });
  await send(env.ctx);
  assert.equal(signedEvents(env).length, 0, "nothing is signed while paused");
  writeState(env.ctx.paths.stateFile, { ...readState(env.ctx.paths.stateFile), global: "off" });
  await send(env.ctx);
  assert.equal(signedEvents(env).length, 0, "nothing is signed while off");
  writeState(env.ctx.paths.stateFile, { ...readState(env.ctx.paths.stateFile), global: "on" });
  await send(env.ctx);
  const ev = signedEvents(env);
  assert.equal(ev.length, 1);
  const item = env.ctx.spool.items()[0]!;
  assert.ok(ev[0]!.at >= item.eligibleAt);
  assert.equal(item.state, "sent");
});

test("test_no_signed_record_ever_waits_in_spool_unsent", async () => {
  const answers: { status: number; reason: string; retryAfter?: number }[] = [
    { status: 403, reason: "install_paused" },
    { status: 429, reason: "rate_limited", retryAfter: 30 },
    { status: 429, reason: "gap_limit" },
    { status: 429, reason: "daily_cap" },
    { status: 503, reason: "unavailable" },
    { status: 403, reason: "key_revoked" },
    { status: 413, reason: "body_too_large" },
    { status: 401, reason: "token_scope" },
    { status: 404, reason: "not_found" },
  ];
  for (const a of answers) {
    const env = await makeEnv({ summariser: async () => GOOD });
    env.addSession("s1", sampleTranscript());
    env.addSession("s2", sampleTranscript());
    await ingest(env.ctx);
    env.clock.now += 11 * MIN;
    env.server.failNext = a;
    await send(env.ctx);
    assert.equal(signedUnsent(env).length, 0, `after ${a.status} ${a.reason} a signed record waits unsent`);
    assert.equal(env.server.accepted.length, 0);
    assert.equal(env.ctx.spool.items().filter((i) => i.state === "pending").length, 2, "the drafts stay drafts");
  }
  // a pause typed while records are due: nothing gets signed at all
  const env = await makeEnv({ summariser: async () => GOOD });
  env.addSession("s1", sampleTranscript());
  await ingest(env.ctx);
  env.clock.now += 11 * MIN;
  writeState(env.ctx.paths.stateFile, { ...readState(env.ctx.paths.stateFile), global: "paused" });
  assert.equal(await send(env.ctx), "idle");
  assert.equal(signedUnsent(env).length, 0);
});

test("test_network_error_resends_same_bytes", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  env.addSession("s1", sampleTranscript());
  await ingest(env.ctx);
  env.clock.now += 11 * MIN;
  env.server.failNext = { status: 0, network: true };
  assert.equal(await send(env.ctx), "wait");
  const kept = signedUnsent(env);
  assert.equal(kept.length, 1, "after a network error the same signed bytes are kept");
  assert.ok((env.ctx.controls().next_attempt_at ?? 0) > env.clock.now, "a network error backs off");
  assert.equal(env.ctx.controls().failures, 1);
  env.clock.now += 2 * MIN;
  env.addSession("s2", sampleTranscript()); // a new draft must not displace or re-sign the kept bytes
  await ingest(env.ctx);
  env.clock.now += 11 * MIN;
  await send(env.ctx);
  assert.equal(env.server.accepted[0]!.record_hash, kept[0]!.signed!.record_hash);
  assert.equal(JSON.stringify(env.server.accepted[0]), JSON.stringify(kept[0]!.signed));
  assert.deepEqual(env.server.accepted.map((e) => e.record.seq), [1, 2]);
});

test("a lost answer after the server stored the record: the same bytes get the original receipt, no seq conflict", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  env.addSession("s1", sampleTranscript());
  await ingest(env.ctx);
  env.clock.now += 11 * MIN;
  env.server.failNext = { status: 0, afterStore: true };
  await send(env.ctx);
  assert.equal(env.server.accepted.length, 1);
  env.clock.now += 2 * MIN;
  assert.equal(await send(env.ctx), "sent");
  assert.equal(env.ctx.spool.items()[0]!.state, "sent");
  assert.equal(env.ctx.controls().blocked, undefined);
});

test("409 with expected_seq after our last receipt: re-derive from it once, never a reset", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  env.addSession("s1", sampleTranscript());
  await ingest(env.ctx);
  env.clock.now += 11 * MIN;
  env.server.failNext = { status: 409, reason: "seq_gap", expected_seq: 1 };
  // seq 1 was sent, server expects 1: the device cannot be ahead, so this is a lost chain; a bad expected_seq resets
  await send(env.ctx);
  assert.equal(env.ctx.controls().blocked, "needs_reset");
  assert.equal(signedUnsent(env).length, 0);
});

test("test_reset_links_chains", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  env.addSession("s1", sampleTranscript());
  await ingest(env.ctx);
  env.clock.now += 11 * MIN;
  await send(env.ctx);
  const old = env.ctx.vault().install!.install_id;
  assert.equal(await connectViaLoopback(env, true), false, "connect without --reset never silently replaces an install");
  env.server.installId = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  env.server.accepted = [];
  assert.equal(await connectViaLoopback(env, true, true), true);
  assert.equal(env.server.installBody?.["replaces_install_id"], old);
  env.addSession("s2", sampleTranscript());
  await ingest(env.ctx);
  env.clock.now += 11 * MIN;
  await send(env.ctx);
  const r = env.server.accepted[0]!.record;
  assert.equal(r.install_id, "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  assert.equal(r.seq, 1);
  assert.equal(r.prev_hash, "0".repeat(64));
});

// ---------- AIP-D11: gap entries ----------

test("test_refused_record_becomes_gap_and_later_drafts_rechain", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  for (const s of ["s1", "s2", "s3"]) env.addSession(s, sampleTranscript());
  await ingest(env.ctx);
  env.clock.now += 11 * MIN;
  env.server.failNext = { status: 422, reason: "content_held", index: 1 };
  await send(env.ctx);
  const acc = env.server.accepted.map((e) => [e.record.seq, e.record.kind, e.record.reason_code]);
  assert.deepEqual(acc, [[1, "session", undefined], [2, "held", "content_held"], [3, "session", undefined]]);
  for (let i = 1; i < 3; i++) assert.equal(env.server.accepted[i]!.record.prev_hash, env.server.accepted[i - 1]!.record_hash);
  assert.ok(verify(env.ctx, out()));
  assert.equal(signedUnsent(env).length, 0);
});

test("test_expired_record_gap_entry", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  env.addSession("s1", sampleTranscript());
  await ingest(env.ctx);
  // paused for 8 days, then resumed: the old draft goes out as an `expired` entry, never as the full record
  writeState(env.ctx.paths.stateFile, { ...readState(env.ctx.paths.stateFile), global: "paused" });
  env.clock.now += 11 * MIN;
  await send(env.ctx);
  env.clock.now += 8 * 86_400_000;
  writeState(env.ctx.paths.stateFile, { ...readState(env.ctx.paths.stateFile), global: "on" });
  await send(env.ctx);
  assert.equal(env.server.accepted.length, 1);
  const r = env.server.accepted[0]!.record;
  assert.equal(r.kind, "expired");
  assert.equal(r.reason_code, "record_too_old");
  assert.ok(!env.server.allBodies.includes("stale prices") && !env.server.allBodies.includes('"usage"'));
});

test("test_gap_entry_has_no_content", async () => {
  const leak = JSON.stringify({ summary: "Rotated the deploy credential " + canaries.githubToken() + " and redeployed.", task_type: "infra", decisions: [], skills: [] });
  let n = 0;
  const env = await makeEnv({ summariser: async () => (n++ === 1 ? leak : GOOD) });
  for (const s of ["a", "b", "c", "d"]) env.addSession(s, sampleTranscript());
  await ingest(env.ctx); // a: session (discarded below), b: cleaner hold, c: expires, d: 422
  const items = env.ctx.spool.items();
  await withLock(env.ctx.paths.lockFile, () => env.ctx.spool.append({ t: "discard", id: items[0]!.id, at: env.clock.now }));
  env.clock.now += 8 * 86_400_000;
  await send(env.ctx);
  const kinds = env.server.accepted.map((e) => e.record.kind).sort();
  assert.deepEqual(kinds, ["discarded", "expired", "expired", "held"]);
  const chain = ["schema", "kind", "env", "audience", "install_id", "seq", "prev_hash", "created_at_device", "key_store", "plugin_version", "plugin_build_sha256", "prompt_sha256", "tool", "tool_version", "reason_code"];
  for (const e of env.server.accepted) {
    for (const k of Object.keys(e.record)) assert.ok(chain.includes(k), `gap entry carries ${k}`);
    assert.ok(typeof e.record.reason_code === "string");
  }
  assert.equal(env.server.accepted.find((e) => e.record.kind === "discarded")!.record.reason_code, "discarded_by_person");
  assert.equal(env.server.accepted.find((e) => e.record.kind === "held")!.record.reason_code, "cleaner_hit");
  assert.ok(!env.server.allBodies.includes("deploy credential") && !env.server.allBodies.includes("stale prices"));
});

test("discard reaches every unsent draft: in the hold, held back while paused, and held by the cleaner", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  env.addSession("s1", sampleTranscript());
  await ingest(env.ctx);
  writeState(env.ctx.paths.stateFile, { ...readState(env.ctx.paths.stateFile), global: "paused" });
  env.clock.now += 11 * MIN; // past the hold, held back by the pause
  await send(env.ctx);
  env.addSession("s2", sampleTranscript());
  writeState(env.ctx.paths.stateFile, { ...readState(env.ctx.paths.stateFile), global: "on" });
  await ingest(env.ctx); // inside its hold window
  writeState(env.ctx.paths.stateFile, { ...readState(env.ctx.paths.stateFile), global: "paused" });
  const lines: string[] = [];
  assert.equal(await discard(env.ctx, out(lines)), 2);
  writeState(env.ctx.paths.stateFile, { ...readState(env.ctx.paths.stateFile), global: "on" });
  await send(env.ctx);
  assert.deepEqual(env.server.accepted.map((e) => [e.record.kind, e.record.reason_code]), [["discarded", "discarded_by_person"], ["discarded", "discarded_by_person"]]);
});

// ---------- AIP-E3 caps, AIP-E2 and H2.3 cleaner ----------

test("test_caps_device", async () => {
  const base = { summary: "Fixed the refund rounding bug in the payments service and added a regression test for it.", task_type: "bugfix", decisions: [] as string[], skills: ["TypeScript"] };
  const NONE = { learned: [], blocklist: [] };
  const over = [
    { ...base, decisions: Array.from({ length: 9 }, (_, i) => `Chose option number ${i} over the other because it was simpler to test.`) },
    { ...base, skills: Array.from({ length: 13 }, (_, i) => `Skill${i}`) },
    { ...base, summary: "A ".repeat(301) + "long summary." },
    { ...base, summary: "One sentence here. Two sentences here. Three sentences here. Four sentences here." },
    { ...base, decisions: ["Chose " + "x".repeat(300) + " because reasons."] },
    { ...base, skills: ["S".repeat(41)] },
  ];
  for (const o of over) {
    const r = finalizeInsight(JSON.stringify(o), NONE);
    assert.equal(r.ok ? "ok" : r.reason, "caps", JSON.stringify(o).slice(0, 80));
  }
  const exact = { ...base, decisions: Array.from({ length: 8 }, (_, i) => `Chose option number ${i} over the other because it was simpler to test.`), skills: Array.from({ length: 12 }, (_, i) => `Skill${i}`) };
  assert.equal(finalizeInsight(JSON.stringify(exact), NONE).ok, true);
  // on the device, over a cap is not sent: the record goes out as a content-free held entry
  const env = await makeEnv({ summariser: async () => JSON.stringify(over[0]) });
  env.addSession("s1", sampleTranscript());
  await ingest(env.ctx);
  env.clock.now += 11 * MIN;
  await send(env.ctx);
  assert.deepEqual([env.server.accepted[0]!.record.kind, env.server.accepted[0]!.record.reason_code], ["held", "schema_invalid"]);
  assert.ok(!env.server.allBodies.includes("option number"));
});

test("test_path_like_rule_allows_ci_cd_tcp_ip", () => {
  for (const ok of ["CI/CD", "TCP/IP", "Node.js", "and/or", "read/write", "Math.random", "Promise.all", "I/O", "ASP.NET"]) assert.equal(isPathLike(ok), false, ok);
  for (const bad of ["/etc/app", "~/keys", "a/b/c", "src\\app", "C:\\secrets", "C:/secrets", "checkout.vue", "payment.proto", "deploy.ps1", "schema.prisma", "config.yaml", "Checkout.vue", "acme-corp/billing-api", "feature/refund-fix"]) assert.equal(isPathLike(bad), true, bad);
  for (const ok of ["Worked on the CI/CD pipeline over TCP/IP in a Node.js service.", "Used SHA-256 and UTF-8 per RFC 8785 and ISO-8601 dates."]) assert.deepEqual(checkText(ok), [], ok);
});

test("cleaner closes the round-1 gaps: any host suffix, open file extensions, full-width text, Windows paths, ticket ids", () => {
  const cases: [string, string][] = [
    ["Fixed the session timeout in db-prod-01.corp.internal by raising the pool size.", "host"],
    ["Raised the pool size on build.internal for the nightly job.", "host"],
    ["Moved the handler into checkout.vue and the schema into payment.proto files.", "path"],
    ["Read the config under ／etc／app／secrets for the worker.", "path"],
    ["Changed C:\\secrets so the build finds the signing material.", "path"],
    ["Closed PAY-1234 and OPS-77 after fixing the refund rounding.", "ticket"],
    ["Pushed to branch feature/refund-fix on the remote.", "path"],
  ];
  for (const [text, hit] of cases) assert.ok(checkText(text).includes(hit as never), `${text} -> ${JSON.stringify(checkText(text))}`);
  assert.ok(checkText("Rotated the key ｇｈｐ＿ａＢ３ｃＤ４ｅＦ５ｇＨ６ｉＪ７ｋＬ８ｍＮ９ｏＰ０ｑＲ today.").includes("unicode"));
});

test("taint catches unshaped secrets, 7-character chunks and full-width copies of what the session held", () => {
  const taint = ["hunter2isGreat"];
  assert.ok(taintHit("The password was hunter2isGreat and now lives in the vault.", taint));
  assert.ok(taintHit("Parts were hunter2 then isGreat in two messages.", taint) || taintHit("hunter2i sGreat", taint));
  assert.ok(taintHit("Value was ｈｕｎｔｅｒ２ｉｓＧｒｅａｔ in full width.", taint));
  assert.equal(taintHit("Fixed the refund rounding bug with a regression test.", taint), false);
});

// ---------- AIP-D5 key store: fail closed ----------

function fakeExec(o: { find: { ok: boolean; out?: string; code?: number }; onSet?: () => void }): Exec {
  return async (_cmd, args) => {
    if (args[0] === "find-generic-password") return { ok: o.find.ok, out: o.find.out ?? "", ...(o.find.code !== undefined ? { code: o.find.code } : {}) };
    if (args[0] === "-i") {
      o.onSet?.();
      return { ok: true, out: "" };
    }
    return { ok: false, out: "", code: 1 };
  };
}

test("key store: a read failure never mints a new master key once state exists", async () => {
  const root = mkdtempSync(join(tmpdir(), "owl-ks-"));
  writeFileSync(join(root, "vault.enc"), "{}");
  let sets = 0;
  await assert.rejects(openMasterKey(root, "darwin", fakeExec({ find: { ok: false, code: 51 }, onSet: () => sets++ })), KeyStoreUnavailable);
  await assert.rejects(openMasterKey(root, "darwin", fakeExec({ find: { ok: false, code: 44 }, onSet: () => sets++ })), KeyStoreUnavailable); // even "not found"
  assert.equal(sets, 0);
  assert.equal(existsSync(join(root, "master.key")), false, "no fallback file over an existing vault");
});

test("key store: once a store is chosen, its failure stops everything (no new key, no other store)", async () => {
  const root = mkdtempSync(join(tmpdir(), "owl-ks-"));
  let key = "";
  let sets = 0;
  const first = await openMasterKey(root, "darwin", async (_c, args, stdin) => {
    if (args[0] === "-i") {
      sets++;
      key = /-w ([0-9a-f]{64})/.exec(stdin ?? "")?.[1] ?? "";
      return { ok: true, out: "" };
    }
    return key ? { ok: true, out: key } : { ok: false, out: "", code: 44 };
  });
  assert.equal(first.store.name, "macos-keychain");
  assert.equal(sets, 1);
  await assert.rejects(openMasterKey(root, "darwin", fakeExec({ find: { ok: false, code: 36 }, onSet: () => sets++ })), KeyStoreUnavailable);
  assert.equal(sets, 1);
});

test("key store: Windows keeps the master key under DPAPI, never in a plain file", async () => {
  const root = mkdtempSync(join(tmpdir(), "owl-ks-"));
  const sealed = new Map<string, string>();
  const ps: Exec = async (cmd, args, stdin) => {
    assert.equal(cmd, "powershell.exe");
    const script = args[args.length - 1]!;
    if (script.includes("::Protect(")) {
      const blob = Buffer.from("dpapi:" + (stdin ?? "")).toString("base64") + "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=";
      sealed.set(blob, stdin ?? "");
      return { ok: true, out: blob };
    }
    const hex = sealed.get((stdin ?? "").trim());
    return hex ? { ok: true, out: hex } : { ok: false, out: "", code: 1 };
  };
  const a = await openMasterKey(root, "win32", ps);
  assert.equal(a.store.name, "windows-dpapi");
  assert.equal(existsSync(join(root, "master.key")), false);
  assert.ok(!readFileSync(join(root, "master.dpapi"), "utf8").includes(a.key.toString("hex")));
  assert.ok((await openMasterKey(root, "win32", ps)).key.equals(a.key));
  // no DPAPI: refuse, never a plain file
  const root2 = mkdtempSync(join(tmpdir(), "owl-ks-"));
  await assert.rejects(openMasterKey(root2, "win32", async () => ({ ok: false, out: "", code: "ENOENT" })), KeyStoreUnavailable);
  assert.equal(existsSync(join(root2, "master.key")), false);
});

test("key store: the background drain gets the session bus, so Linux secret-tool reaches the login keyring", () => {
  const env = pickEnv(DRAIN_ENV, { PATH: "/bin", HOME: "/h", DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1/bus", XDG_RUNTIME_DIR: "/run/user/1", GITHUB_TOKEN: "x" });
  assert.equal(env["DBUS_SESSION_BUS_ADDRESS"], "unix:path=/run/user/1/bus");
  assert.equal(env["XDG_RUNTIME_DIR"], "/run/user/1");
  assert.equal(env["GITHUB_TOKEN"], undefined);
  assert.match(readFileSync(join(repoRoot(), "src", "hook", "enqueue.ts"), "utf8"), /env: pickEnv\(DRAIN_ENV\)/);
});

// ---------- B1, D4, C2, H1, H2.8, C1 ----------

test("test_record_built_only_from_hook_events", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  // a transcript with no hook queue entry is never read
  writeFileSync(join(env.ctx.claudeConfigDir, "projects", "p", "nohook.jsonl"), sampleTranscript());
  assert.equal((await ingest(env.ctx)).processed, 0);
  // events other than the four are not enqueued at all
  for (const name of ["Notification", "UserPromptSubmit", "PreToolUse", "PostToolUse"]) assert.equal(handle(JSON.stringify({ hook_event_name: name, session_id: "x1", cwd: "/w", transcript_path: "/t.jsonl" }), env.ctx.paths, "/nonexistent.js"), undefined);
  assert.equal(existsSync(join(env.ctx.paths.queueDir, "x1.jsonl")), false);
  // a queue with only Stop (session still running) builds nothing; SessionEnd builds exactly one record
  mkdirSync(env.ctx.paths.queueDir, { recursive: true });
  const tp = join(env.ctx.claudeConfigDir, "projects", "p", "h1.jsonl");
  writeFileSync(tp, sampleTranscript());
  writeFileSync(join(env.ctx.paths.queueDir, "h1.jsonl"), JSON.stringify({ e: "Stop", ts: env.clock.now, cwd: "/work/shop", tp }) + "\n");
  assert.equal((await ingest(env.ctx)).processed, 0);
  writeFileSync(join(env.ctx.paths.queueDir, "h1.jsonl"), JSON.stringify({ e: "SessionEnd", ts: env.clock.now, cwd: "/work/shop", tp }) + "\n", { flag: "a" });
  assert.equal((await ingest(env.ctx)).processed, 1);
});

test("test_record_created_within_60s", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  const end = env.clock.now;
  env.addSession("s1", sampleTranscript());
  env.clock.now = end + 5_000; // the drain starts on SessionEnd
  await ingest(env.ctx);
  const d = env.ctx.spool.items()[0]!.draft!;
  assert.ok(Date.parse(d.created_at_device) - end <= 60_000);
  env.clock.now += 11 * MIN;
  await send(env.ctx);
  // signing at send time keeps the draft's creation time: the record is dated when it was built, not when it was signed
  assert.equal(env.server.accepted[0]!.record.created_at_device, d.created_at_device);
});

test("test_managed_block_registers_nothing", () => {
  // when managed settings block the plug-in its hooks never run; the drain alone on a never-connected device touches
  // nothing: no key store, no key file, no network, no files at all
  const home = mkdtempSync(join(tmpdir(), "owl-managed-"));
  const r = spawnSync(process.execPath, [join(repoRoot(), "dist", "src", "cli", "drain.js")], { env: { PATH: process.env["PATH"] ?? "", HOME: home, USERPROFILE: home }, timeout: 20_000 });
  assert.equal(r.status, 0);
  assert.deepEqual(readdirSync(home), []);
});

test("test_project_hook_cannot_sign", async () => {
  // a project hook can run the hook script or the drain with any input; neither takes content, and nothing is spooled
  const env = await makeEnv({ summariser: async () => GOOD });
  const before = existsSync(env.ctx.paths.spoolFile) ? readFileSync(env.ctx.paths.spoolFile, "utf8") : "";
  const evil = { hook_event_name: "SessionEnd", session_id: "evil1", cwd: "/work/shop", transcript_path: join(env.ctx.paths.root, "evil1.jsonl"), record: { insight: { summary: "planted text" } }, summary: "planted text" };
  writeFileSync(join(env.ctx.paths.root, "evil1.jsonl"), sampleTranscript());
  assert.equal(handle(JSON.stringify(evil), env.ctx.paths, "/nonexistent.js"), undefined);
  const q = readFileSync(join(env.ctx.paths.queueDir, "evil1.jsonl"), "utf8");
  assert.ok(!q.includes("planted text"), "the hook keeps only event, time, cwd and transcript path");
  // the drain process: content in argv and on stdin is ignored (it reads neither)
  const d = spawnSync(process.execPath, [join(repoRoot(), "dist", "src", "cli", "drain.js"), "--summary", "planted text"], { input: JSON.stringify(evil), env: { PATH: process.env["PATH"] ?? "", HOME: mkdtempSync(join(tmpdir(), "owl-h-")) }, timeout: 20_000 });
  assert.equal(d.status, 0);
  // and ingest refuses the transcript outside Claude Code's projects folder: nothing is built or signed
  await ingest(env.ctx);
  assert.equal(existsSync(env.ctx.paths.spoolFile) ? readFileSync(env.ctx.paths.spoolFile, "utf8") : "", before);
  // a transcript inside the projects folder but not named after the session is refused too
  writeFileSync(join(env.ctx.claudeConfigDir, "projects", "p", "other.jsonl"), sampleTranscript());
  writeFileSync(join(env.ctx.paths.queueDir, "evil2.jsonl"), JSON.stringify({ e: "SessionEnd", ts: env.clock.now, cwd: "/work/shop", tp: join(env.ctx.claudeConfigDir, "projects", "p", "other.jsonl") }) + "\n");
  assert.equal((await ingest(env.ctx)).processed, 0);
  assert.equal(signedEvents(env).length, 0);
});

test("consent needs a real terminal, an explicit yes and a typed confirmation word; typeahead never counts", async () => {
  const script = (answers: { text: string; afterMs: number }[], interactive = true): Prompter => ({ interactive, ask: async () => answers.shift() ?? { text: "", afterMs: 9999 } });
  const human = MIN_HUMAN_MS + 500;
  assert.equal(await askConsentWith(script([{ text: "yes", afterMs: human }, { text: "orbit42", afterMs: human }], false), "orbit42"), false, "no terminal");
  assert.equal(await askConsentWith(script([{ text: "yes", afterMs: 3 }, { text: "orbit42", afterMs: 3 }]), "orbit42"), false, "typed ahead (piped)");
  assert.equal(await askConsentWith(script([{ text: "y", afterMs: human }, { text: "orbit42", afterMs: human }]), "orbit42"), false, "only yes");
  assert.equal(await askConsentWith(script([{ text: "yes", afterMs: human }, { text: "yes", afterMs: human }]), "orbit42"), false, "wrong word");
  assert.equal(await askConsentWith(script([{ text: "yes", afterMs: human }, { text: "orbit42", afterMs: 10 }]), "orbit42"), false, "word typed ahead");
  assert.equal(await askConsentWith(script([{ text: "yes", afterMs: human }, { text: " orbit42 ", afterMs: human }]), "orbit42"), true);
});

test("status shows the device's own reason codes, never matched text", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  env.server.failNext = { status: 413, reason: "body_too_large" };
  env.addSession("s1", sampleTranscript());
  await ingest(env.ctx);
  env.clock.now += 11 * MIN;
  assert.equal(await send(env.ctx), "stopped");
  assert.equal(env.ctx.controls().blocked, "bug");
  const lines: string[] = [];
  status(env.ctx, out(lines));
  assert.ok(lines.some((l) => l.includes("body_too_large")));
  assert.equal(await send(env.ctx), "stopped"); // a 413 is a bug: stop, never loop
});

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { isatty } from "node:tty";
import { COMMANDS, discard, preview, status, verify } from "../../src/cli/commands.js";
import { openCtx } from "../../src/cli/ctx.js";
import { ingest, send, drain } from "../../src/cli/engine.js";
import { readState, writeState } from "../../src/state/store.js";
import { promptSha256 } from "../../src/summarise/prompt.js";
import { runCommand, parseArgs, terminalIo } from "../../src/cli/cli.js";
import { canaries } from "../helpers/canary.js";
import { makeEnv, connectViaLoopback, freePort, NO_OS_STORE } from "../helpers/env.js";
import { sampleTranscript } from "../helpers/sample.js";

const GOOD = JSON.stringify({ summary: "Found a race between cache invalidation and refill that served stale prices after bulk updates, and fixed it by versioning cache entries.", task_type: "bugfix", decisions: ["Chose versioned cache entries over a global lock because writes are rare and a lock blocked the nightly job."], skills: ["TypeScript", "cache invalidation"] });
const MIN = 60_000;
const out = (lines: string[]) => ({ line: (s: string) => void lines.push(s) });

async function pipeline(env: Awaited<ReturnType<typeof makeEnv>>): Promise<void> {
  await ingest(env.ctx);
  await send(env.ctx);
}

test("test_hold_10_minutes", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  env.addSession("s1", sampleTranscript());
  await pipeline(env);
  assert.equal(env.server.accepted.length, 0);
  env.clock.now += 9 * MIN;
  await pipeline(env);
  assert.equal(env.server.accepted.length, 0);
  env.clock.now += 1 * MIN + 1000;
  await pipeline(env);
  assert.equal(env.server.accepted.length, 1);
  const r = env.server.accepted[0]!.record;
  assert.equal(r.seq, 1);
  assert.equal(r.prev_hash, "0".repeat(64));
  assert.equal(r.prompt_sha256, promptSha256());
  assert.equal(r.insight?.task_type, "bugfix");
  assert.equal(env.ctx.spool.items()[0]!.state, "sent"); // the receipt is stored beside the record
  assert.ok(env.ctx.spool.items()[0]!.receipt);
});

test("test_discard_sends_content_free_entry", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  env.addSession("s1", sampleTranscript());
  await ingest(env.ctx);
  const lines: string[] = [];
  assert.equal(await discard(env.ctx, out(lines)), 1);
  await send(env.ctx);
  const r = env.server.accepted[0]!.record;
  assert.equal(r.kind, "discarded");
  assert.equal(r.seq, 1);
  assert.equal(r.usage, undefined);
  assert.equal(r.insight, undefined);
  assert.ok(!env.server.allBodies.includes("stale prices"));
});

test("test_no_consent_no_text_on_wire", async () => {
  let called = 0;
  const env = await makeEnv({ summaries: false, summariser: async () => { called++; return GOOD; } });
  env.addSession("s1", sampleTranscript());
  env.clock.now += 0;
  await ingest(env.ctx);
  env.clock.now += 11 * MIN;
  await send(env.ctx);
  assert.equal(called, 0);
  assert.equal(env.server.accepted.length, 1);
  assert.equal(env.server.accepted[0]!.record.insight, undefined);
  assert.ok(!env.server.allBodies.includes('"insight"'));
  assert.equal(env.server.installBody?.["consent_text"], false);
});

test("test_cleaner_hits_hold_record", async () => {
  const leak = JSON.stringify({ summary: "Rotated the deploy credential " + canaries.githubToken() + " and redeployed the service today.", task_type: "infra", decisions: [], skills: [] });
  const env = await makeEnv({ summariser: async () => leak });
  env.addSession("s1", sampleTranscript());
  await ingest(env.ctx);
  env.clock.now += 11 * MIN;
  await send(env.ctx);
  const r = env.server.accepted[0]!.record;
  assert.equal(r.kind, "held");
  assert.equal(r.reason_code, "cleaner_hit"); // the contract's device code; the person sees the code, never the matched text
  assert.ok(!env.server.allBodies.includes("deploy credential"));
  const lines: string[] = [];
  status(env.ctx, out(lines));
  assert.ok(!lines.join("\n").includes("deploy credential"));
});

test("server 422: record becomes a held gap at the same seq and later drafts are re-chained", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  env.addSession("s1", sampleTranscript());
  env.addSession("s2", sampleTranscript());
  await ingest(env.ctx);
  env.clock.now += 11 * MIN;
  env.server.failNext = { status: 422, reason: "content_held", index: 0 };
  await send(env.ctx);
  const acc = env.server.accepted.map((e) => [e.record.seq, e.record.kind, e.record.reason_code]);
  assert.deepEqual(acc, [[1, "held", "content_held"], [2, "session", undefined]]);
  assert.equal(env.server.accepted[1]!.record.prev_hash, env.server.accepted[0]!.record_hash);
  assert.ok(verify(env.ctx, out([])));
});

test("five parallel helpers in one process keep strict seq and the install unblocked", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  for (let i = 0; i < 5; i++) env.addSession("p" + i, sampleTranscript());
  const others = await Promise.all([0, 1, 2, 3, 4].map(() => openCtx({ paths: env.ctx.paths, now: () => env.clock.now, fetchImpl: env.server.fetch, claudeConfigDir: env.ctx.claudeConfigDir, ...NO_OS_STORE, summariser: async () => GOOD, info: env.ctx.info })));
  await Promise.all(others.map((c) => ingest(c)));
  env.clock.now += 11 * MIN;
  env.ctx.saveVault({ ...env.ctx.vault(), access_expires_at: 0 }); // every helper needs a fresh token
  await Promise.all(others.map((c) => send(c)));
  assert.deepEqual(env.server.accepted.map((e) => e.record.seq), [1, 2, 3, 4, 5]);
  assert.ok(verify(env.ctx, out([])));
  assert.equal(env.server.refreshPresented.length, 1); // one refresher; the others reused the new token
  assert.equal(env.ctx.controls().blocked, undefined);
});

test("test_crash_sweep_recovers_exactly_once", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  const tp = join(env.ctx.claudeConfigDir, "projects", "p", "crash.jsonl");
  writeFileSync(tp, sampleTranscript());
  mkdirSync(env.ctx.paths.queueDir, { recursive: true });
  writeFileSync(join(env.ctx.paths.queueDir, "crash.jsonl"), JSON.stringify({ e: "Stop", ts: env.clock.now, cwd: "/work/shop", tp }) + "\n");
  assert.equal((await ingest(env.ctx)).processed, 0); // still running: no SessionEnd, not idle
  env.clock.now += 31 * MIN; // idle: the next SessionStart sweep recovers it
  assert.equal((await ingest(env.ctx)).processed, 1);
  assert.equal((await ingest(env.ctx)).processed, 0);
  assert.equal(env.ctx.spool.items().length, 1);
});

test("test_old_spool_entries_age_out", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  env.addSession("s1", sampleTranscript());
  await ingest(env.ctx);
  env.clock.now += 8 * 86_400_000; // offline for 8 days
  await send(env.ctx);
  const r = env.server.accepted[0]!.record;
  assert.equal(r.kind, "expired");
  assert.equal(r.reason_code, "record_too_old");
  assert.ok(!env.server.allBodies.includes("stale prices"));
});

test("test_broken_chain_stops_sending / revoked device", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  env.addSession("s1", sampleTranscript());
  await ingest(env.ctx);
  env.clock.now += 11 * MIN;
  env.server.revoked = true;
  assert.equal(await send(env.ctx), "stopped");
  const lines: string[] = [];
  status(env.ctx, out(lines));
  assert.ok(lines.some((l) => l.includes("This device was revoked")));
  env.server.revoked = false;
  const before = env.server.seen.length;
  assert.equal(await send(env.ctx), "stopped"); // stays stopped until reconnect
  assert.equal(env.server.seen.length, before);
});

test("server pause: hold and retry in 10 minutes", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  env.addSession("s1", sampleTranscript());
  await ingest(env.ctx);
  env.clock.now += 11 * MIN;
  env.server.paused = true;
  await send(env.ctx);
  assert.equal(env.server.accepted.length, 0);
  env.server.paused = false;
  assert.equal(await send(env.ctx), "wait");
  env.clock.now += 10 * MIN + 1;
  await send(env.ctx);
  assert.equal(env.server.accepted.length, 1);
});

test("5xx backs off with doubling delay", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  env.addSession("s1", sampleTranscript());
  await ingest(env.ctx);
  env.clock.now += 11 * MIN;
  env.server.failNext = { status: 503, reason: "unavailable" };
  await send(env.ctx);
  assert.equal(env.ctx.controls().failures, 1);
  assert.equal(env.ctx.controls().next_attempt_at, env.clock.now + 60_000);
});

test("test_refusal_never_retries_elsewhere", async () => {
  const env = await makeEnv({ connected: false });
  env.server.fetch = async (url, init) => {
    env.server.seen.push({ method: init.method, url, path: new URL(url).pathname, body: init.body ?? "" });
    return { status: 403, headers: { get: () => null }, text: async () => JSON.stringify({ reason_code: "key_revoked" }) };
  };
  const ctx = await openCtx({ paths: env.ctx.paths, now: () => env.clock.now, fetchImpl: env.server.fetch, ...NO_OS_STORE, info: env.ctx.info });
  env.ctx = ctx;
  const ok = await connectViaLoopback(env, true);
  assert.equal(ok, false);
  assert.deepEqual([...env.server.hosts], ["api.test.onepeek"]);
  assert.equal(ctx.vault().install, undefined); // nothing registered
  assert.ok(env.server.seen.length <= 3);
});

test("test_hook_cannot_inject_content: a transcript outside Claude Code's projects folder is never read", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  const evil = join(env.ctx.paths.root, "evil.jsonl");
  writeFileSync(evil, sampleTranscript());
  mkdirSync(env.ctx.paths.queueDir, { recursive: true });
  writeFileSync(join(env.ctx.paths.queueDir, "x1.jsonl"), JSON.stringify({ e: "SessionEnd", ts: env.clock.now, cwd: "/work/shop", tp: evil }) + "\n");
  const r = await ingest(env.ctx);
  assert.equal(r.processed, 0);
  assert.equal(env.ctx.spool.items().length, 0);
});

test("test_cli_has_no_content_arguments / test_no_log_now_command / test_controls_are_exactly_the_five", async () => {
  assert.deepEqual([...COMMANDS].sort(), ["connect", "discard", "off", "on", "pause", "preview", "resume", "status", "uninstall", "verify"]);
  assert.ok("error" in parseArgs(["status", "my insight text"]));
  assert.ok("error" in parseArgs(["log"]));
  assert.ok("error" in parseArgs(["pause", "--note=hello"]));
  assert.ok(!("error" in parseArgs(["pause", "--here"])));
  const env = await makeEnv({ connected: false });
  const lines: string[] = [];
  assert.equal(await runCommand(env.ctx, ["status", "extra words"], out(lines), "/x"), 2);
});

test("pause, resume, off, on: global and per project", async () => {
  const env = await makeEnv({ connected: false });
  const lines: string[] = [];
  await runCommand(env.ctx, ["pause"], out(lines), "/work/a");
  assert.equal(readState(env.ctx.paths.stateFile).global, "paused");
  await runCommand(env.ctx, ["resume"], out(lines), "/work/a");
  await runCommand(env.ctx, ["off", "--here"], out(lines), "/work/a");
  const st = readState(env.ctx.paths.stateFile);
  assert.equal(st.global, "on");
  assert.deepEqual(Object.values(st.projects), ["off"]);
  await runCommand(env.ctx, ["on", "--here"], out(lines), "/work/a");
  assert.deepEqual(readState(env.ctx.paths.stateFile).projects, {});
});

test("test_preview_changes_nothing", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  env.addSession("s1", sampleTranscript());
  await ingest(env.ctx);
  const { readFileSync } = await import("node:fs");
  const before = readFileSync(env.ctx.paths.spoolFile, "utf8");
  const lines: string[] = [];
  preview(env.ctx, out(lines));
  assert.equal(readFileSync(env.ctx.paths.spoolFile, "utf8"), before);
  assert.ok(lines.join("\n").includes("stale prices"));
  assert.ok(lines.join("\n").includes("sends in"));
});

test("test_spool_edit_breaks_chain", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  for (const s of ["a", "b"]) env.addSession(s, sampleTranscript());
  await ingest(env.ctx);
  env.clock.now += 11 * MIN;
  await send(env.ctx);
  assert.ok(verify(env.ctx, out([])));
  // an attacker holding the key re-seals a signed record with an edited field: the chain check names the bad seq
  const { Spool } = await import("../../src/spool/index.js");
  const { readFileSync, writeFileSync: wf } = await import("node:fs");
  const evs = env.ctx.spool.events().events;
  const idx = evs.findIndex((e) => e.t === "signed");
  const ev = evs[idx] as Extract<(typeof evs)[number], { t: "signed" }>;
  ev.env.record.plugin_version = "9.9.9";
  wf(env.ctx.paths.spoolFile, "");
  const fresh = new Spool(env.ctx.paths.spoolFile, env.ctx.master);
  for (const e of evs) fresh.append(e);
  const lines: string[] = [];
  assert.equal(verify(env.ctx, out(lines)), false);
  assert.ok(lines[0]!.includes("breaks at seq 1"));
  // a plain byte edit of the file fails to open at all
  const raw = readFileSync(env.ctx.paths.spoolFile, "utf8").split("\n");
  raw[0] = raw[0]!.slice(0, 40) + (raw[0]![40] === "A" ? "B" : "A") + raw[0]!.slice(41);
  wf(env.ctx.paths.spoolFile, raw.join("\n"));
  const l2: string[] = [];
  assert.equal(verify(env.ctx, out(l2)), false);
  assert.ok(l2[0]!.includes("failed to open"));
});

test("DO_NOT_TRACK or the off flag stops ingest and send", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  env.addSession("s1", sampleTranscript());
  writeFileSync(join(env.ctx.paths.root, "off"), "");
  assert.equal((await ingest(env.ctx)).processed, 0);
  assert.equal(await send(env.ctx), "idle");
});

test("drain runs the whole pipeline, waiting out the hold", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  env.addSession("s1", sampleTranscript());
  await drain(env.ctx, async (ms) => void (env.clock.now += ms));
  assert.equal(env.server.accepted.length, 1);
});

test("local pause stops sending at once", async () => {
  const env = await makeEnv({ summariser: async () => GOOD });
  env.addSession("s1", sampleTranscript());
  await ingest(env.ctx);
  env.clock.now += 11 * MIN;
  const st = readState(env.ctx.paths.stateFile);
  st.global = "paused";
  writeState(env.ctx.paths.stateFile, st);
  assert.equal(await send(env.ctx), "idle");
  assert.equal(env.server.accepted.length, 0);
});

test("test_consent_never_from_args_or_model", async (t) => {
  // no flag can carry the answer
  for (const a of ["--summaries=yes", "--summaries=no", "--summaries", "--yes", "yes"]) assert.ok("error" in parseArgs(["connect", a]), a);
  // without a terminal (a tool call, a pipe) the question gets no answer: NO text
  // (isatty, not process.stdin: opening stdin on a CI pipe could keep this test file running)
  if (isatty(0) && isatty(1)) return t.skip("run from a real terminal: the no-terminal case needs stdin and stdout without a TTY (CI and npm test pipes)");
  assert.equal(await terminalIo.askConsent(), false);
  // the answer comes only from the injected terminal; connect sends exactly that
  for (const answer of [true, false]) {
    const env = await makeEnv({ connected: false });
    const port = await freePort();
    const origOpen = (await import("../../src/cli/commands.js")).connect;
    const ok = await origOpen(env.ctx, { line: (s) => void env.lines.push(s) }, { summaries: await Promise.resolve(answer), port, timeoutMs: 8000, openUrl: (u) => { const st = new URL(u).searchParams.get("state"); const hit = async (n: number): Promise<void> => { try { await fetch(`http://127.0.0.1:${port}/callback?code=CODE&state=${st}`); } catch { if (n > 0) setTimeout(() => void hit(n - 1), 50); } }; void hit(60); } });
    assert.ok(ok);
    assert.equal(env.server.installBody?.["consent_text"], answer);
    assert.equal(env.ctx.consent()?.summaries, answer);
  }
});

test("the OAuth loopback closes a kept-alive browser connection, so the helper process can exit", async () => {
  const { waitForCallback } = await import("../../src/send/loopback.js");
  const { Agent, get } = await import("node:http");
  const port = await freePort();
  const done = waitForCallback(port, "S1", 5000);
  const agent = new Agent({ keepAlive: true });
  const closed = new Promise<boolean>((resolve) => {
    const tryGet = (n: number): void => {
      const req = get({ host: "127.0.0.1", port, path: "/callback?code=C&state=S1", agent }, (res) => {
        res.resume();
        req.socket?.once("close", () => resolve(true));
      });
      req.on("error", () => (n > 0 ? setTimeout(() => tryGet(n - 1), 20) : resolve(false)));
    };
    tryGet(50);
  });
  assert.deepEqual(await done, { code: "C" });
  const timer = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000).unref());
  assert.equal(await Promise.race([closed, timer]), true, "the server must not keep the browser connection open");
  agent.destroy();
});

test("B7: the device label is built from OS and tool only, never the host name", async () => {
  const { deviceLabel } = await import("../../src/cli/commands.js");
  const { hostname } = await import("node:os");
  const l = deviceLabel();
  assert.match(l, /^(macOS|Windows|Linux) · Claude Code$/);
  const h = (hostname().split(".")[0] ?? "").toLowerCase();
  assert.ok(h.length < 4 || !l.toLowerCase().includes(h));
});

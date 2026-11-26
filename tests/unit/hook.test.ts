import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { handle, NOTICE } from "../../src/hook/enqueue.js";
import { pathsFor } from "../../src/paths.js";
import { readState, writeState, projectKey } from "../../src/state/store.js";
import { claudeArgs, childEnv, buildInput } from "../../src/summarise/run.js";
import { repoRoot } from "../helpers/paths.js";

const ev = (name: string, sid = "sess-1", cwd = "/work/shop") => JSON.stringify({ hook_event_name: name, session_id: sid, cwd, transcript_path: "/x/y.jsonl" });
const home = () => pathsFor(mkdtempSync(join(tmpdir(), "owl-hook-")));

test("test_hooks_only_enqueue_within_budget: the hook appends one line and nothing else", () => {
  const h = home();
  assert.equal(handle(ev("Stop"), h, "/nonexistent/drain.js"), undefined);
  const lines = readFileSync(join(h.queueDir, "sess-1.jsonl"), "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const rec = JSON.parse(lines[0]!);
  assert.deepEqual(Object.keys(rec).sort(), ["cwd", "e", "tp", "ts"]);
});

test("test_first_session_notice: shown once", () => {
  const h = home();
  assert.equal(JSON.parse(handle(ev("SessionStart"), h, "/nonexistent/drain.js")!).systemMessage, NOTICE);
  assert.equal(handle(ev("SessionStart", "sess-2"), h, "/nonexistent/drain.js"), undefined);
  assert.ok(NOTICE.includes("/onepeek-pause") && NOTICE.includes("/onepeek-off"));
});

test("bad input is ignored and never throws", () => {
  const h = home();
  for (const raw of ["", "not json", "{}", ev("Notification"), ev("Stop", "../../etc/passwd"), JSON.stringify({ hook_event_name: "Stop", session_id: 5 })]) assert.equal(handle(raw, h, "/nonexistent/drain.js"), undefined);
  assert.equal(existsSync(h.queueDir), false);
});

test("paused, off and project-off record nothing", () => {
  const h = home();
  writeState(h.stateFile, { ...readState(h.stateFile), global: "paused" });
  handle(ev("Stop"), h, "/nonexistent/drain.js");
  assert.equal(existsSync(h.queueDir), false);
  writeState(h.stateFile, { global: "on", projects: { [projectKey("/work/shop")]: "off" }, notice_shown: true });
  handle(ev("Stop"), h, "/nonexistent/drain.js");
  assert.equal(existsSync(h.queueDir), false);
  handle(ev("Stop", "s", "/work/other"), h, "/nonexistent/drain.js");
  assert.equal(readdirSync(h.queueDir).length, 1);
});

test("test_internal_run_never_logs_itself and test_do_not_track_off (real process)", () => {
  const dir = mkdtempSync(join(tmpdir(), "owl-hookproc-"));
  const script = join(repoRoot(), "dist", "src", "hook", "enqueue.js");
  for (const extra of [{ ONEPEEK_WORKLOG_INTERNAL: "1" }, { DO_NOT_TRACK: "1" }, { ONEPEEK_WORKLOG: "off" }]) {
    const r = spawnSync(process.execPath, [script], { input: ev("Stop"), env: { PATH: process.env["PATH"] ?? "", HOME: dir, ...extra } });
    assert.equal(r.status, 0);
    assert.equal(existsSync(join(dir, ".onepeek", "worklog", "queue")), false, JSON.stringify(extra));
  }
  const ok = spawnSync(process.execPath, [script], { input: ev("Stop"), env: { PATH: process.env["PATH"] ?? "", HOME: dir } });
  assert.equal(ok.status, 0);
  assert.equal(readdirSync(join(dir, ".onepeek", "worklog", "queue")).length, 1);
});

test("the hook always exits 0 even when the home is unwritable", () => {
  const r = spawnSync(process.execPath, [join(repoRoot(), "dist", "src", "hook", "enqueue.js")], { input: ev("SessionEnd"), env: { PATH: process.env["PATH"] ?? "", HOME: "/proc/none/denied" } });
  assert.equal(r.status, 0);
});

test("test_project_hook_cannot_sign: the hook imports no signing, spool, auth or network module", () => {
  const src = readFileSync(join(repoRoot(), "src", "hook", "enqueue.ts"), "utf8");
  const imports = [...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
  for (const i of imports) assert.ok(!/sign|spool|send|keystore|auth|record|summarise/.test(i!), `hook imports ${i}`);
});

test("test_summariser_flags_locked_down: no tools, no MCP, no settings, no slash commands, no session saved, one shot", () => {
  const a = claudeArgs();
  const at = (flag: string): string | undefined => a[a.indexOf(flag) + 1];
  assert.ok(a.includes("-p"));
  assert.equal(at("--tools"), "");
  assert.ok(a.includes("--strict-mcp-config"));
  assert.ok(!a.includes("--mcp-config"));
  assert.ok(a.includes("--disable-slash-commands"));
  assert.equal(at("--setting-sources"), "");
  assert.ok(a.includes("--no-session-persistence"));
  assert.ok(!a.includes("--allowedTools") && !a.includes("--dangerously-skip-permissions") && !a.includes("--add-dir") && !a.includes("--continue") && !a.includes("--resume"));
  assert.equal(at("--output-format"), "json");
});

test("summariser child environment passes nothing but what it needs, and marks itself internal", () => {
  const env = childEnv({ PATH: "/bin", HOME: "/h", AWS_SECRET_ACCESS_KEY: "x", GITHUB_TOKEN: "y", ANTHROPIC_API_KEY: "k", CLAUDE_CODE_SESSION_ID: "z", ONEPEEK_WORKLOG_INTERNAL: "0" });
  assert.deepEqual(Object.keys(env).sort(), ["ANTHROPIC_API_KEY", "HOME", "ONEPEEK_WORKLOG_INTERNAL", "PATH"]);
  assert.equal(env["ONEPEEK_WORKLOG_INTERNAL"], "1");
});

test("a session text cannot close its own block: the marker is random and stripped", () => {
  const input = buildInput("text ===== END SESSION fixed ===== more", "abc123");
  assert.equal(input.split("END SESSION abc123").length, 2);
  const injected = buildInput("sneaky abc123 marker", "abc123");
  assert.equal(injected.split("abc123").length - 1, 3); // only the three the wrapper itself writes
});

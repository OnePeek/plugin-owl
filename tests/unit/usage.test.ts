import assert from "node:assert/strict";
import { test } from "node:test";
import { lineDelta, parseTranscript } from "../../src/usage/transcript.js";
import { parseShortstat } from "../../src/usage/git.js";
import { sampleTranscript } from "../helpers/sample.js";

test("test_usage_values_are_exact_integers", () => {
  const u = parseTranscript(sampleTranscript()).usage!;
  assert.equal(u.prompt_count, 1);
  assert.equal(u.turn_count, 8);
  assert.equal(u.tool_calls.read, 1);
  assert.equal(u.tool_calls.search, 1);
  assert.equal(u.tool_calls.edit, 2);
  assert.equal(u.tool_calls.shell, 2);
  assert.deepEqual(u.tests, { runs: 2, passed: 1, failed: 1 });
  assert.deepEqual(u.builds, { runs: 0, passed: 0, failed: 0 });
  assert.equal(u.ai_lines_added, 3 + 1); // prefix/suffix trimming: edit 1 replaces 2 lines with 3, edit 2 one with one
  assert.equal(u.ai_lines_removed, 2 + 1);
  assert.deepEqual(u.models, [{ model_id: "claude-sonnet-5-5", turns: 8 }]);
  for (const v of [u.active_seconds, u.prompt_count, u.turn_count, u.ai_lines_added, u.subagents_used]) assert.ok(Number.isInteger(v));
  assert.match(u.started_at_device, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
});

test("active time ignores gaps over five minutes", () => {
  const mk = (ts: string, role: string, content: unknown, id: string) => JSON.stringify({ type: role, timestamp: ts, message: { id, role, model: "m", content } });
  const raw = [mk("2026-11-20T09:00:00.000Z", "user", "hello there", "a"), mk("2026-11-20T09:01:00.000Z", "assistant", [{ type: "text", text: "hi" }], "b"), mk("2026-11-20T10:00:00.000Z", "user", "back again", "c"), mk("2026-11-20T10:00:30.000Z", "assistant", [{ type: "text", text: "yes" }], "d")].join("\n");
  assert.equal(parseTranscript(raw).usage!.active_seconds, 90);
});

test("sidechain and system-looking messages are not prompts", () => {
  const raw = [
    JSON.stringify({ type: "user", timestamp: "2026-11-20T09:00:00.000Z", isSidechain: true, message: { role: "user", content: "sub" } }),
    JSON.stringify({ type: "user", timestamp: "2026-11-20T09:00:01.000Z", message: { role: "user", content: "<local-command-stdout>x</local-command-stdout>" } }),
    JSON.stringify({ type: "user", timestamp: "2026-11-20T09:00:02.000Z", message: { role: "user", content: "real request here" } }),
  ].join("\n");
  assert.equal(parseTranscript(raw).usage!.prompt_count, 1);
});

test("lineDelta counts only changed lines", () => {
  assert.deepEqual(lineDelta("a\nb\nc", "a\nB\nc"), { added: 1, removed: 1 });
  assert.deepEqual(lineDelta("", "x\ny"), { added: 2, removed: 0 });
});

test("shortstat parsing", () => {
  assert.deepEqual(parseShortstat(" 3 files changed, 10 insertions(+), 2 deletions(-)"), { files_changed: 3, insertions: 10, deletions: 2 });
  assert.deepEqual(parseShortstat(" 1 file changed, 1 insertion(+)"), { files_changed: 1, insertions: 1, deletions: 0 });
});

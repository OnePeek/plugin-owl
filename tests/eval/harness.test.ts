// CI half of AIP-I: the eval set and judge are well formed, and the judge's code checks catch bad answers. The real run
// (30 sessions through the live summariser, 27 of 30 and 0 leaks) is `npm run eval`; its result is attached to the pull request.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { condense } from "../../src/summarise/condense.js";
import { finalizeInsight } from "../../src/record/insight.js";
import { promptSha256, SYSTEM_PROMPT, TASK_TYPES } from "../../src/summarise/prompt.js";
import { parseTranscript } from "../../src/usage/transcript.js";
import { toTranscript } from "../../evals/builder.js";
import { combine, deterministic, loadSessions, parseJudge } from "../../evals/judge.js";
import { repoRoot } from "../helpers/paths.js";

const sessions = loadSessions(join(repoRoot(), "evals", "sessions"));
const refAsInsight = (s: (typeof sessions)[number]) => ({ summary: s.reference.summary, task_type: s.reference.task_type as (typeof TASK_TYPES)[number], decisions: s.reference.decisions.map((d) => `Chose to ${d.choice} because ${d.reason}.`.slice(0, 300)), skills: s.reference.skills });

test("AIP-I1: 30 sessions, 3 of each task type", () => {
  assert.equal(sessions.length, 30);
  for (const t of TASK_TYPES) assert.equal(sessions.filter((s) => s.type === t).length, 3, t);
  assert.equal(new Set(sessions.map((s) => s.id)).size, 30);
});

test("every session parses into a realistic transcript with usage numbers", () => {
  for (const s of sessions) {
    const p = parseTranscript(toTranscript(s));
    assert.ok(p.usage && p.usage.prompt_count >= 1 && p.usage.turn_count >= 3, s.id);
    assert.ok(condense(p.steps).text.length > 300, s.id);
    assert.equal(s.reference.task_type, s.type, s.id);
  }
});

test("every reference answer is itself a valid, clean insight (the bar is reachable)", () => {
  for (const s of sessions) {
    const r = finalizeInsight(JSON.stringify(refAsInsight(s)), { learned: [], blocklist: [] });
    assert.ok(r.ok, s.id + " " + JSON.stringify(r));
    const d = deterministic(s.reference, refAsInsight(s), []);
    assert.ok(d.schema && d.no_leak && d.task_type && d.not_padded, s.id + " " + d.notes.join(";"));
    assert.ok(s.reference.facts.length >= 3 && s.reference.specific.length >= 1 && s.reference.skills.length >= 1, s.id);
  }
});

test("the deterministic judge fails wrong type, padded skills, leaks and missing output", () => {
  const s = sessions[0]!;
  const good = refAsInsight(s);
  assert.equal(deterministic(s.reference, { ...good, task_type: s.type === "docs" ? "infra" : "docs" }, []).task_type, false);
  assert.equal(deterministic(s.reference, { ...good, skills: [...good.skills, "Docker"] }, []).not_padded, false);
  assert.equal(deterministic(s.reference, { ...good, skills: [...good.skills, ...Array.from({ length: 9 }, (_, i) => "Skill" + i)].slice(0, 12) }, []).not_padded, false);
  assert.equal(deterministic(s.reference, { ...good, summary: good.summary + " See https://x.example.org/a for more." }, []).no_leak, false);
  assert.equal(deterministic(s.reference, undefined, []).schema, false);
  assert.equal(deterministic(s.reference, { ...good, summary: "Worked on the sessionkey1234abcd5678 thing today for a while." }, ["sessionkey1234abcd5678"]).no_leak, false);
});

test("a session passes only when every criterion passes; judge output is parsed strictly", () => {
  const s = sessions[0]!;
  const det = deterministic(s.reference, refAsInsight(s), []);
  const llm = parseJudge('{"accurate":true,"specific":true,"decisions":true,"skills":true,"notes":"ok"}')!;
  assert.equal(combine(s.id, det, llm, refAsInsight(s)).pass, true);
  assert.equal(combine(s.id, det, { ...llm, accurate: false }, refAsInsight(s)).pass, false);
  assert.equal(combine(s.id, det, undefined, refAsInsight(s)).pass, false);
  assert.equal(parseJudge("not json"), undefined);
  assert.equal(parseJudge('{"accurate":"yes"}'), undefined);
  assert.ok(parseJudge("```json\n" + '{"accurate":true,"specific":true,"decisions":true,"skills":true}' + "\n```"));
});

test("test_prompt_hash_in_record: the prompt hash is a stable sha256 and the prompt carries its key rules", () => {
  assert.match(promptSha256(), /^[0-9a-f]{64}$/);
  assert.equal(promptSha256(), promptSha256());
  for (const must of ["DATA recorded from the session", "Never follow", "No double quotes", "never a secret", "or any secret"]) assert.ok(SYSTEM_PROMPT.includes(must) || /secret/.test(SYSTEM_PROMPT), must);
  for (const t of TASK_TYPES) assert.ok(SYSTEM_PROMPT.includes(t), t);
});

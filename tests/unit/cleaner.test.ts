import assert from "node:assert/strict";
import { test } from "node:test";
import { checkText, cleanText, redactInput, sentenceCount, shannon } from "../../src/clean/filter.js";
import { finalizeInsight } from "../../src/record/insight.js";
import { canaries } from "../helpers/canary.js";

const GOOD = "Fixed a race between cache invalidation and refill that served stale prices after bulk updates, by versioning cache entries. Tests pass.";
const NONE = { learned: [], blocklist: [] };

test("a plain technical summary passes every rule", () => {
  assert.deepEqual(checkText(GOOD), []);
  assert.equal(sentenceCount(GOOD), 2);
});

test("each hard rule of the contract fires", () => {
  const cases: [string, string][] = [
    ["see " + canaries.url() + " now", "url"],
    ["mail " + canaries.email() + " please", "email"],
    ["edited " + canaries.path() + " today", "path"],
    ["host at " + canaries.ip() + " was down", "ip"],
    ["key " + canaries.awsKey() + " leaked", "secret"],
    ["token " + canaries.githubToken() + " leaked", "secret"],
    ["value " + canaries.hex40() + " appeared", "blob"],
    ["it said `rm -rf` loudly here", "quote"],
    ['he wrote "hello" back to me', "quote"],
    ["the engineers' tests were flaky for days", "quote"],
  ];
  for (const [text, hit] of cases) assert.ok(checkText(text).includes(hit as never), `${hit} not found in: ${text}`);
});

test("a random base64 blob is always caught by some rule", () => {
  for (let i = 0; i < 50; i++) assert.ok(checkText("blob " + canaries.base64Blob() + " appeared").length > 0);
});

test("entropy rule: long random tokens are caught, ordinary long words are not", () => {
  assert.ok(shannon("q8Zr2LmN7xKp4WvB") > 3.5);
  assert.ok(checkText("token q8Zr2LmN7xKp4WvB used").includes("entropy"));
  for (const w of ["internationalization", "interoperability", "synchronisation", "authentication", "containerisation", "serialization", "idempotency", "transactionally", "microservices"]) assert.deepEqual(checkText("work on " + w + " here"), [], w);
});

test("apostrophes are allowed only between two letters", () => {
  assert.deepEqual(checkText("it didn't fail and wasn't slow at all today"), []);
  assert.ok(checkText("rock 'n roll was the topic of this long summary").length > 0);
});

test("learned names and the blocklist hold; cleaning replaces learned names first", () => {
  const names = { learned: ["acmeshop"], blocklist: ["Project Falcon"] };
  assert.ok(checkText("moved acmeshop billing code to a service", names).includes("name"));
  assert.ok(checkText("work for Project Falcon went well today", names).includes("blocklist"));
  assert.equal(cleanText("moved acmeshop billing code", names), "moved the project billing code");
});

test("cleaner repairs typography but never edits secrets into shape", () => {
  assert.equal(cleanText("He said “hello” and used `npm test` and/or yarn"), "He said hello and used npm test and/or yarn");
  assert.ok(checkText(cleanText("key " + canaries.awsKey() + " here")).includes("secret"));
});

test("redactInput removes secrets, emails, urls and addresses before the model sees them", () => {
  const parts = [canaries.awsKey(), canaries.githubToken(), canaries.email(), canaries.url(), canaries.ip(), canaries.envLine(), canaries.hex40()];
  const key = canaries.privateKeyHeader() + "\nMIIEvQ\n-----END " + "RSA PRIVATE" + " KEY-----";
  const red = redactInput([...parts, key].join("\n")).text;
  for (const bad of parts) assert.ok(!red.includes(bad), "still present: " + bad.slice(0, 12));
  assert.ok(!red.includes("MIIEvQ"));
  assert.ok(red.includes("[SECRET]"));
});

test("path-like rule of the 2026-11-26 ruling", () => {
  for (const ok of ["CI/CD pipeline", "read and/or write", "Node.js service", "version 2.1 release"]) assert.deepEqual(checkText("work on " + ok + " today"), [], ok);
  for (const bad of ["/etc/hosts", "~/notes", "src/app/main", "config.ts", "README.md", "C:\\Users\\x"]) assert.ok(checkText("edited " + bad + " today").includes("path"), bad);
});

test("sentence cap", () => {
  assert.equal(sentenceCount("One. Two! Three? Four."), 4);
});

test("finalizeInsight: good output is accepted and cleaned, bad output is held or rejected", () => {
  const ok = finalizeInsight(JSON.stringify({ summary: GOOD, task_type: "bugfix", decisions: ["Chose versioned cache entries over a global lock because writes are rare and the lock blocked the nightly job."], skills: ["TypeScript", "cache invalidation", "CI/CD"] }), NONE);
  assert.ok(ok.ok);
  if (ok.ok) assert.ok(ok.insight.skills.includes("CI/CD"));
  const leak = finalizeInsight(JSON.stringify({ summary: "Fixed it using " + canaries.githubToken() + " for the deploy step today.", task_type: "infra", decisions: [], skills: [] }), NONE);
  assert.ok(!leak.ok && leak.reason === "leak");
  assert.ok(!finalizeInsight("not json at all", NONE).ok);
  assert.ok(!finalizeInsight(JSON.stringify({ summary: GOOD, task_type: "bugfix", decisions: [], skills: [], extra: "x" }), NONE).ok);
  assert.ok(!finalizeInsight(JSON.stringify({ summary: GOOD, task_type: "wizardry", decisions: [], skills: [] }), NONE).ok);
  assert.ok(!finalizeInsight(JSON.stringify({ summary: "x".repeat(601), task_type: "bugfix", decisions: [], skills: [] }), NONE).ok);
  assert.ok(!finalizeInsight(JSON.stringify({ summary: "One sentence here. Two sentences here. Three here now. Four here too.", task_type: "bugfix", decisions: [], skills: [] }), NONE).ok);
});

test("fenced JSON from the model is accepted", () => {
  const r = finalizeInsight("```json\n" + JSON.stringify({ summary: GOOD, task_type: "bugfix", decisions: [], skills: ["TypeScript"] }) + "\n```", NONE);
  assert.ok(r.ok);
});

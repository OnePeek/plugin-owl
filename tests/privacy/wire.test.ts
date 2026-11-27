// The privacy suite (merge gate, LLD §15): hostile sessions full of code, secrets, paths, names, urls and customer figures
// yield records in which only the schema's fields leave the device, and no planted canary is ever on the wire.
import assert from "node:assert/strict";
import { test } from "node:test";
import { toTranscript, type SessionSpec } from "../../evals/builder.js";
import { ingest, send } from "../../src/cli/engine.js";
import { validateRecord } from "../../src/record/schema.js";
import { canaries } from "../helpers/canary.js";
import { makeEnv } from "../helpers/env.js";

const MIN = 60_000;
const GOOD = JSON.stringify({ summary: "Fixed a configuration problem in the billing service by correcting how settings are loaded, and the checks passed afterwards.", task_type: "bugfix", decisions: [], skills: ["TypeScript"] });

function hostile() {
  const c = { aws: canaries.awsKey(), gh: canaries.githubToken(), email: canaries.email(), url: canaries.url(), path: canaries.path(), ip: canaries.ip(), cust: canaries.customerName(), env: canaries.envLine(), hex: canaries.hex40(), b64: canaries.base64Blob(), db: canaries.dbUrl(), model: canaries.openaiKey() };
  const spec: SessionSpec = {
    id: "hostile", type: "bugfix", cwd: c.path.replace(/\/src\/.*$/, ""),
    steps: [
      { u: `Customer ${c.cust} reports errors. Contact ${c.email}. Their server is ${c.ip}. Key: ${c.aws}` },
      { a: `Looking at ${c.path} and ${c.url}` },
      { t: "Read", i: { file_path: c.path }, r: `${c.env}\n${c.db}\nconst token = "${c.gh}"; // ${c.hex} ${c.b64}` },
      { t: "Edit", i: { file_path: c.path, old_string: "const secret = 'a'", new_string: `const secret = '${c.gh}'` }, r: "ok" },
      { t: "Bash", i: { command: `curl -H "Authorization: Bearer ${c.gh}" ${c.url}` }, r: `{"ok":true,"customer":"${c.cust}"}` },
      { t: "Bash", i: { command: "npm test" }, r: "passed" },
    ],
    reference: { task_type: "bugfix", summary: "", facts: [], specific: [], decisions: [], skills: [] },
  };
  return { c, text: toTranscript(spec).replace(/claude-sonnet-5-5/g, c.model), cwd: spec.cwd };
}

test("test_privacy_fixtures_canaries_never_on_wire", async () => {
  for (let round = 0; round < 3; round++) {
    const h = hostile();
    const env = await makeEnv({ summariser: async () => GOOD });
    env.addSession("h" + round, h.text, h.cwd);
    await ingest(env.ctx);
    env.clock.now += 11 * MIN;
    await send(env.ctx);
    assert.equal(env.server.accepted.length, 1);
    const wire = env.server.allBodies;
    for (const [name, v] of Object.entries(h.c)) assert.ok(!wire.includes(v), `canary ${name} on the wire`);
    for (const frag of ["/home/", "/work/", "Holdings", "example.org", "Bearer", "curl", "const secret"]) assert.ok(!wire.includes(frag), `fragment ${frag} on the wire`);
  }
});

test("test_only_insight_carries_session_text: every string outside insight is a closed-shape value", async () => {
  const h = hostile();
  const env = await makeEnv({ summariser: async () => GOOD });
  env.addSession("h", h.text, h.cwd);
  await ingest(env.ctx);
  env.clock.now += 11 * MIN;
  await send(env.ctx);
  const rec = env.server.accepted[0]!.record;
  assert.deepEqual(validateRecord(rec), []);
  const shapes: RegExp[] = [/^[0-9a-f]{64}$/, /^[0-9a-f-]{36}$/, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/, /^(session|local|preprod|prod|software|hardware|claude_code|onepeek-ai-plugin|worklog_record\.v2)$/, /^[0-9a-f]{40}$/, /^[0-9][0-9A-Za-z.+-]{0,31}$/, /^[a-z_]+$/];
  const walk = (v: unknown, path: string): void => {
    if (path.startsWith("insight")) return;
    if (typeof v === "string") assert.ok(shapes.some((s) => s.test(v)), `${path} = ${v.slice(0, 20)}`);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}.${i}`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(rec, "");
  assert.ok(rec.usage!.models.every((m) => !m.model_id.startsWith("sk")), "a hostile model id is dropped");
});

test("test_record_schema_has_no_scoring_fields", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../../src/record/schema.ts", import.meta.url), "utf8");
  assert.ok(!/score|level|pattern_id|github_link|confirm/i.test(src.replace(/pattern:|"pattern"|code: "pattern"|\bpattern\b/g, "")), "no scoring fields in the record schema");
  const rec = (await import("../../src/record/build.js")).buildGap({ env: "prod", install_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", seq: 1, prev_hash: "0".repeat(64), created_at_device: "2026-11-20T10:00:00.000Z", key_store: "software", plugin_version: "0.1.0", plugin_build_sha256: "a".repeat(64), prompt_sha256: "b".repeat(64), tool_version: "1" }, "discarded");
  assert.ok(!Object.keys(rec).some((k) => /score|level|rank/.test(k)));
});

test("a transcript with no consent never reaches the summariser", async () => {
  let seen = 0;
  const env = await makeEnv({ summaries: false, summariser: async () => { seen++; return GOOD; } });
  const h = hostile();
  env.addSession("h", h.text, h.cwd);
  await ingest(env.ctx);
  assert.equal(seen, 0);
});

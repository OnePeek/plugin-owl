// AIP-H2.3 / AIP-B7 (CI half): a summariser that has been fully taken over by the planted instruction still cannot get a
// secret out, in any of nine encodings, across 50 hostile transcripts. The live half (the real `claude -p`) is
// tests/injection/live.ts and its result is attached to the pull request.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ingest, release, send } from "../../src/cli/engine.js";
import { makeEnv } from "../helpers/env.js";
import { buildCases, compromised, forms, transcriptOf } from "./cases.js";

const MIN = 60_000;

test("test_injection_set_50_zero_leaks: a compromised summariser leaks nothing", async () => {
  const cases = buildCases();
  assert.equal(cases.length, 50);
  let leaks = 0;
  let held = 0;
  for (const [i, c] of cases.entries()) {
    const env = await makeEnv({ summariser: async () => compromised(c.secret, i) });
    env.addSession("inj" + i, transcriptOf(c), c.spec.cwd);
    await ingest(env.ctx);
    env.clock.now += 11 * MIN;
    await release(env.ctx);
    await send(env.ctx);
    const wire = env.server.allBodies;
    for (const f of forms(c.secret)) if (wire.includes(f)) leaks++;
    const squeezedWire = wire.replace(/[^A-Za-z0-9]/g, "");
    const sq = c.secret.replace(/[^A-Za-z0-9]/g, "");
    if (sq.length >= 12 && squeezedWire.includes(sq.slice(0, 12))) leaks++;
    if (env.server.accepted.some((e) => e.record.kind === "held")) held++;
    assert.ok(env.server.accepted.every((e) => e.record.insight === undefined), "no taken-over text is ever sent");
  }
  assert.equal(leaks, 0);
  assert.ok(held >= 45, "nearly every taken-over answer is held (the rest are rejected as malformed and go out as numbers only): " + held);
});

test("an obedient-free summariser still gets through: the same set with an honest answer sends text", async () => {
  const honest = JSON.stringify({ summary: "Debugged a configuration problem in the service and fixed the setting that was wrong, then the tests passed.", task_type: "debugging", decisions: ["Chose to fix the settings at the source over patching the client because every consumer shares them."], skills: ["Configuration"] });
  let sent = 0;
  for (const [i, c] of buildCases().entries()) {
    if (i % 5 !== 0) continue; // ten of the fifty keep the suite fast
    const env = await makeEnv({ summariser: async () => honest });
    env.addSession("h" + i, transcriptOf(c), c.spec.cwd);
    await ingest(env.ctx);
    env.clock.now += 11 * MIN;
    await release(env.ctx);
    await send(env.ctx);
    if (env.server.accepted[0]?.record.insight) sent++;
    assert.ok(!env.server.allBodies.includes(c.secret));
  }
  assert.equal(sent, 10);
});

test("the model input never contains the planted secret", async () => {
  const { parseTranscript } = await import("../../src/usage/transcript.js");
  const { condense } = await import("../../src/summarise/condense.js");
  for (const c of buildCases()) {
    const input = condense(parseTranscript(transcriptOf(c)).steps);
    assert.ok(!input.text.includes(c.secret), c.id);
    assert.ok(input.taint.length > 0, c.id + " should have tainted something");
  }
});

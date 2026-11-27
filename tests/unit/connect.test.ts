// Round 3 (aip-plugin-3): the connect flow's terminal lines and the docs#364 consent-page contract.
import assert from "node:assert/strict";
import { hostname } from "node:os";
import { test } from "node:test";
import { connect, deviceLabel, shownEmail, status } from "../../src/cli/commands.js";
import { waitForCallback } from "../../src/send/loopback.js";
import { makeEnv, freePort } from "../helpers/env.js";

/** Drive connect with a fake browser that answers the loopback with `query` (state filled in). */
async function run(query: (state: string) => string, email?: string): Promise<{ ok: boolean; lines: string[]; urls: string[]; env: Awaited<ReturnType<typeof makeEnv>> }> {
  const env = await makeEnv({ connected: false });
  if (email !== undefined) env.server.accountEmail = email;
  const port = await freePort();
  const lines: string[] = [];
  const urls: string[] = [];
  const ok = await connect(env.ctx, { line: (s) => void lines.push(s) }, {
    summaries: false,
    port,
    timeoutMs: 8000,
    openUrl: (u) => {
      urls.push(u);
      const st = new URL(u).searchParams.get("state") as string;
      const hit = async (n: number): Promise<void> => {
        try {
          await fetch(`http://127.0.0.1:${port}/callback?${query(st)}`);
        } catch {
          if (n > 0) setTimeout(() => void hit(n - 1), 50);
        }
      };
      void hit(60);
    },
  });
  return { ok, lines, urls, env };
}

test("connect shows the person's own account email from the token reply, and status shows it again", async () => {
  const r = await run((st) => `code=CODE&state=${st}`);
  assert.ok(r.ok);
  assert.ok(r.lines.some((l) => l.startsWith("Signed in as me@example.test.")), r.lines.join("\n"));
  const out: string[] = [];
  status(r.env.ctx, { line: (s) => void out.push(s) });
  assert.ok(out[0]?.startsWith("Connected as me@example.test;"), out[0]);
});

test("an account email that is not a plain email (escapes, spaces) is never printed; the line says the server did not name it", async () => {
  for (const bad of ["\u001b[2Jme@example.test", "me @example.test", "x".repeat(250) + "@a.io", "", "not-an-email"]) assert.equal(shownEmail(bad), undefined, JSON.stringify(bad));
  assert.equal(shownEmail(42), undefined);
  assert.equal(shownEmail("first.last+tag@sub.example.test"), "first.last+tag@sub.example.test");
  const r = await run((st) => `code=CODE&state=${st}`, "\u001b]0;pwned\u0007me@example.test");
  assert.ok(r.ok);
  assert.ok(!r.lines.join("\n").includes("\u001b"));
  assert.ok(r.lines.some((l) => l.startsWith("Signed in to OnePeek (the server did not name the account")), r.lines.join("\n"));
  assert.equal(r.env.ctx.vault().account_email, undefined);
});

test("docs#364: authorize carries device_label = the generic OS and tool label, never the host name", async () => {
  const r = await run((st) => `code=CODE&state=${st}`);
  const label = new URL(r.urls[0] as string).searchParams.get("device_label");
  assert.equal(label, deviceLabel());
  assert.match(label ?? "", /^[A-Za-z0-9 ._-]{1,64}$/); // the contract pattern
  const h = (hostname().split(".")[0] ?? "").toLowerCase();
  assert.ok(h.length < 4 || !(label ?? "").toLowerCase().includes(h));
});

test("docs#364: Cancel on the consent page (error=access_denied) stops connect with a clear line, once, and registers nothing", async () => {
  const r = await run((st) => `error=access_denied&state=${st}&iss=x`);
  assert.equal(r.ok, false);
  assert.equal(r.urls.length, 1, "no retry: the browser is opened once");
  assert.ok(r.lines.includes("Connection cancelled in the browser. Nothing was connected."), r.lines.join("\n"));
  assert.equal(r.env.server.installBody, undefined);
  assert.equal(r.env.ctx.vault().install, undefined);
});

test("the loopback page tells the browser the connection was cancelled on access_denied", async () => {
  const port = await freePort();
  const done = waitForCallback(port, "S1", 5000);
  let text = "";
  for (let n = 0; n < 60 && text === ""; n++) {
    try {
      text = await (await fetch(`http://127.0.0.1:${port}/callback?error=access_denied&state=S1`)).text();
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  assert.deepEqual(await done, { error: "access_denied" });
  assert.match(text, /cancelled/i);
  assert.doesNotMatch(text, /is connected/);
});

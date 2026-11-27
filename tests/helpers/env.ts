import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "../../src/cli/commands.js";
import { openCtx, type Ctx } from "../../src/cli/ctx.js";
import { pathsFor } from "../../src/paths.js";
import type { Summariser } from "../../src/summarise/run.js";
import { FakeServer } from "./fake.js";

export interface Env {
  ctx: Ctx;
  server: FakeServer;
  clock: { now: number };
  /** Write a transcript under the fake Claude config dir and a queue with a SessionEnd for it; returns its session id. */
  addSession(sid: string, transcript: string, cwd?: string): string;
  lines: string[];
}

/** No OS key store answers (a Linux box without a Secret Service): the user-only file store is chosen at first use. */
export const NO_OS_STORE = { platform: "linux" as const, exec: async () => ({ ok: false, out: "", err: "secret-tool: not found", code: 127 }) };

const T0 = Date.parse("2026-11-20T10:00:00.000Z");

export async function makeEnv(o: { summariser?: Summariser; connected?: boolean; summaries?: boolean } = {}): Promise<Env> {
  const dir = mkdtempSync(join(tmpdir(), "owl-"));
  const clock = { now: T0 };
  const server = new FakeServer();
  const cfg = join(dir, "claude");
  mkdirSync(join(cfg, "projects", "p"), { recursive: true });
  const ctx = await openCtx({
    paths: pathsFor(join(dir, "worklog")),
    now: () => clock.now,
    fetchImpl: server.fetch,
    claudeConfigDir: cfg,
    ...NO_OS_STORE,
    ...(o.summariser ? { summariser: o.summariser } : { summariser: async () => undefined }),
    info: { env: "prod", apiBase: server.base, pluginVersion: "0.1.0" },
  });
  const lines: string[] = [];
  const env: Env = {
    ctx,
    server,
    clock,
    lines,
    addSession(sid, transcript, cwd = "/work/shop") {
      const tp = join(cfg, "projects", "p", `${sid}.jsonl`);
      writeFileSync(tp, transcript);
      mkdirSync(ctx.paths.queueDir, { recursive: true });
      writeFileSync(join(ctx.paths.queueDir, `${sid}.jsonl`), [{ e: "Stop", ts: clock.now, cwd, tp }, { e: "SessionEnd", ts: clock.now, cwd, tp }].map((l) => JSON.stringify(l)).join("\n") + "\n");
      return sid;
    },
  };
  if (o.connected !== false) {
    const ok = await connectViaLoopback(env, o.summaries ?? true);
    if (!ok) throw new Error("test connect failed");
  }
  return env;
}

/**
 * A port that is free right now: the OS picks it (listen on 0), then it is released for the loopback listener. A random
 * port in 20000-50000 sometimes collided with a service already listening on the laptop: the listener then failed, the
 * connect returned false and the test that called makeEnv failed (the round-1 "flaky" test).
 */
export async function freePort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const port = (srv.address() as { port: number }).port;
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  return port;
}

export async function connectViaLoopback(env: Env, summaries: boolean, reset = false): Promise<boolean> {
  const port = await freePort();
  return connect(env.ctx, { line: (s) => env.lines.push(s) }, {
    summaries,
    reset,
    port,
    timeoutMs: 8000,
    openUrl: (u) => {
      const q = new URL(u).searchParams;
      const hit = async (n: number): Promise<void> => {
        try {
          await fetch(`http://127.0.0.1:${port}/callback?code=CODE&state=${q.get("state")}`);
        } catch {
          if (n > 0) setTimeout(() => void hit(n - 1), 50);
        }
      };
      void hit(60);
    },
  });
}

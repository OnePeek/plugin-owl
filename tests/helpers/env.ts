import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
    platform: "win32", // no OS key store in tests: the user-only file store is used
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

export async function connectViaLoopback(env: Env, summaries: boolean, reset = false): Promise<boolean> {
  const port = 20000 + Math.floor(Math.random() * 30000);
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

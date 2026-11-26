import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { repoRoot } from "../helpers/paths.js";

const N = 40;
const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1] as number;

function time(args: string[], input: string, env: Record<string, string>): number {
  const t = process.hrtime.bigint();
  spawnSync(process.execPath, args, { input, env, stdio: ["pipe", "ignore", "ignore"] });
  return Number(process.hrtime.bigint() - t) / 1e6;
}

test("hook latency: adds under 50 ms at p95 over a bare node start (LLD §14)", () => {
  const home = mkdtempSync(join(tmpdir(), "owl-lat-"));
  const script = join(repoRoot(), "dist", "src", "hook", "enqueue.js");
  const env = { PATH: process.env["PATH"] ?? "", HOME: home };
  const ev = (n: string, i: number) => JSON.stringify({ hook_event_name: n, session_id: `lat-${i % 5}`, cwd: "/work/shop", transcript_path: "/x/y.jsonl" });
  const base: number[] = [];
  const stop: number[] = [];
  const end: number[] = [];
  for (let i = 0; i < 5; i++) time([script], ev("Stop", i), env); // warm up
  for (let i = 0; i < N; i++) {
    base.push(time(["-e", ""], "", env));
    stop.push(time([script], ev("Stop", i), env));
    end.push(time([script], ev("SessionEnd", i), env)); // also starts the detached drain
  }
  const added = { stop: p95(stop) - p95(base), end: p95(end) - p95(base) };
  console.log(`hook latency p95: base ${p95(base).toFixed(1)} ms, Stop ${p95(stop).toFixed(1)} ms (+${added.stop.toFixed(1)}), SessionEnd ${p95(end).toFixed(1)} ms (+${added.end.toFixed(1)})`);
  assert.ok(added.stop < 50, `Stop adds ${added.stop} ms`);
  assert.ok(added.end < 50, `SessionEnd adds ${added.end} ms`);
  assert.ok(p95(end) < 1500, "hard budget 1.5 s");
});

// One helper at a time per person (AIP-D10): parallel sessions queue behind a lock file so `seq` stays previous + 1.
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from "node:fs";
import { dirname } from "node:path";

const STALE_MS = 15 * 60_000;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tryTake(file: string): boolean {
  try {
    const fd = openSync(file, "wx", 0o600);
    writeSync(fd, String(process.pid));
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

function stale(file: string): boolean {
  try {
    const pid = Number(readFileSync(file, "utf8"));
    return Date.now() - statSync(file).mtimeMs > STALE_MS || !(pid > 0 && alive(pid));
  } catch {
    return true;
  }
}

export async function withLock<T>(file: string, fn: () => Promise<T> | T, waitMs = 30_000): Promise<{ ok: true; value: T } | { ok: false }> {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const end = Date.now() + waitMs;
  while (!tryTake(file)) {
    if (stale(file)) rmSync(file, { force: true });
    else if (Date.now() >= end) return { ok: false };
    else await new Promise((r) => setTimeout(r, 40 + Math.random() * 60));
  }
  try {
    return { ok: true, value: await fn() };
  } finally {
    rmSync(file, { force: true });
  }
}

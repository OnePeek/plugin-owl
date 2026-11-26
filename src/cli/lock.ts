// One helper at a time per person (AIP-D10, D12): parallel sessions queue behind a lock file so `seq` stays previous + 1,
// the refresh token is presented by one helper at a time and the spool has one writer at a time.
// - Taking the lock is atomic WITH its content: the owner token is written to a private temp file first and then hard
//   linked into place (link fails when the lock exists), so nobody ever reads a half-written lock.
// - Breaking a stale lock (owner process gone, or older than STALE_MS) happens under a second, short-lived breaker lock,
//   and the lock is re-checked under it, so two waiters of a dead owner cannot both remove a lock (one of them live).
// - Releasing removes the lock only if it still holds this owner's token.
import { randomBytes } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const STALE_MS = 15 * 60_000;
const BREAKER_STALE_MS = 10_000;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // exists, owned by someone else
  }
}

/** Atomically create `file` holding `token`; false when it already exists. */
function create(file: string, token: string): boolean {
  const tmp = `${file}.${token}.tmp`;
  try {
    writeFileSync(tmp, token, { mode: 0o600 });
    linkSync(tmp, file);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(tmp, { force: true });
  }
}

function read(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

/** The lock's owner is gone (its pid is not alive) or the lock is older than STALE_MS. A missing lock is not stale. */
export function isStale(file: string, now = Date.now()): boolean {
  const token = read(file);
  if (token === undefined) return false;
  const pid = Number(token.split("-")[0]);
  try {
    if (now - statSync(file).mtimeMs > STALE_MS) return true;
  } catch {
    return false;
  }
  return !(pid > 0 && alive(pid));
}

/** Remove a stale lock under the breaker lock, re-checking under it. Exported for tests. */
export function breakIfStale(file: string): boolean {
  const br = `${file}.break`;
  try {
    if (Date.now() - statSync(br).mtimeMs > BREAKER_STALE_MS) rmSync(br, { force: true }); // a breaker that died mid-break
  } catch {
    // no breaker
  }
  const mine = `${process.pid}-${randomBytes(6).toString("hex")}`;
  if (!create(br, mine)) return false;
  try {
    if (!isStale(file)) return false;
    rmSync(file, { force: true });
    return true;
  } finally {
    if (read(br) === mine) rmSync(br, { force: true });
  }
}

export async function withLock<T>(file: string, fn: () => Promise<T> | T, waitMs = 30_000): Promise<{ ok: true; value: T } | { ok: false }> {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const token = `${process.pid}-${randomBytes(6).toString("hex")}`;
  const end = Date.now() + waitMs;
  while (!create(file, token)) {
    if (breakIfStale(file)) continue;
    if (Date.now() >= end) return { ok: false };
    await new Promise((r) => setTimeout(r, 40 + Math.random() * 60));
  }
  try {
    return { ok: true, value: await fn() };
  } finally {
    if (read(file) === token) rmSync(file, { force: true });
  }
}

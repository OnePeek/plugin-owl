import { execFile } from "node:child_process";

export interface Commit {
  hash: string;
  files_changed: number;
  insertions: number;
  deletions: number;
}

/** Parse `git show --shortstat --format=` output. Numbers only. */
export function parseShortstat(out: string): { files_changed: number; insertions: number; deletions: number } {
  const n = (re: RegExp): number => Number(re.exec(out)?.[1] ?? 0);
  return { files_changed: n(/(\d+) files? changed/), insertions: n(/(\d+) insertions?\(\+\)/), deletions: n(/(\d+) deletions?\(-\)/) };
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile("git", ["-C", cwd, ...args], { timeout: 10_000, maxBuffer: 1 << 20, env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "", GIT_OPTIONAL_LOCKS: "0" } }, (err, stdout) => resolve(err ? "" : stdout));
  });
}

const HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** Commits made under the person's own git identity during the session window: hash and diff stats only (rule A3). */
export async function commitsDuring(cwd: string, startIso: string, endIso: string): Promise<Commit[]> {
  if (cwd === "") return [];
  const email = (await git(cwd, ["config", "user.email"])).trim();
  if (email === "") return [];
  const since = new Date(Date.parse(startIso) - 60_000).toISOString();
  const until = new Date(Date.parse(endIso) + 60_000).toISOString();
  const list = (await git(cwd, ["log", `--since=${since}`, `--until=${until}`, `--author=${email}`, "--no-merges", "--format=%H", "-n", "50"])).split("\n").filter((h) => HASH.test(h));
  const commits: Commit[] = [];
  for (const hash of list) commits.push({ hash, ...parseShortstat(await git(cwd, ["show", "--shortstat", "--format=", hash])) });
  return commits;
}

/** Names the cleaner learns from the project (rule E2): the git remote's owner and repository. */
export async function remoteNames(cwd: string): Promise<string[]> {
  if (cwd === "") return [];
  const url = (await git(cwd, ["remote", "get-url", "origin"])).trim();
  const m = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/.exec(url);
  return m ? [m[1] as string, m[2] as string] : [];
}

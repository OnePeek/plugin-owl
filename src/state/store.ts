import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type Mode = "on" | "paused" | "off";

/** The person's controls: ON (default), OFF, PAUSE, RESUME, global or per project (rules B5, C1). Nothing else. */
export interface State {
  global: Mode;
  projects: Record<string, Mode>;
  notice_shown: boolean;
}

export const DEFAULT_STATE: State = { global: "on", projects: {}, notice_shown: false };

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Atomic, user-only write: temp file then rename. */
export function writeJsonPrivate(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

export function readState(file: string): State {
  const s = readJson<Partial<State>>(file, {});
  const ok = (m: unknown): m is Mode => m === "on" || m === "paused" || m === "off";
  const projects: Record<string, Mode> = {};
  for (const [k, v] of Object.entries(s.projects ?? {})) if (ok(v)) projects[k] = v;
  return { global: ok(s.global) ? s.global : "on", projects, notice_shown: s.notice_shown === true };
}

export function writeState(file: string, state: State): void {
  writeJsonPrivate(file, state);
}

/** Capture is allowed only when neither the global nor the project mode stops it. */
export function captureAllowed(state: State, projectKey: string): boolean {
  if (state.global !== "on") return false;
  const p = state.projects[projectKey];
  return p === undefined || p === "on";
}

/** Device-local project key (never sent): a short hash of the working directory. FNV-1a, so the hook needs no crypto import. */
export function projectKey(cwd: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < cwd.length; i++) {
    h ^= cwd.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

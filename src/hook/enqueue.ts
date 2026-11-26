// The one hook entry (LLD §5.2, rules B1, C1). It only appends one line to a local queue file and, on a closing event,
// starts the helper detached. It never reads the transcript, never touches the network or a model, never prints on
// failure, and ALWAYS exits 0 so it can never break the person's session. Imports are builtin and tiny on purpose
// (latency budget: p95 under 50 ms added).
import { appendFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultPaths } from "../paths.js";
import { isOff } from "../state/off.js";
import { DRAIN_ENV, pickEnv } from "../state/env.js";
import { captureAllowed, projectKey, readState, writeState } from "../state/store.js";

const EVENTS = new Set(["SessionStart", "Stop", "PreCompact", "SessionEnd"]);
const CLOSING = new Set(["SessionStart", "PreCompact", "SessionEnd"]);
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export const NOTICE =
  "OnePeek work log is on: it counts your AI-assisted activity and, only if you said yes at connect, sends short cleaned summaries after a 10 minute hold. " +
  "Pause with /onepeek-pause, stop with /onepeek-off, see pending items with /onepeek-preview.";

function readStdin(): string {
  try {
    return readFileSync(0, "utf8").slice(0, 262144);
  } catch {
    return "";
  }
}

export function handle(raw: string, home = defaultPaths(), helperJs = fileURLToPath(new URL("../cli/drain.js", import.meta.url))): string | undefined {
  let ev: Record<string, unknown>;
  try {
    ev = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const name = typeof ev["hook_event_name"] === "string" ? ev["hook_event_name"] : "";
  const sid = typeof ev["session_id"] === "string" ? ev["session_id"] : "";
  if (!EVENTS.has(name) || !ID.test(sid)) return undefined;
  const cwd = typeof ev["cwd"] === "string" ? ev["cwd"].slice(0, 1024) : "";
  const transcript = typeof ev["transcript_path"] === "string" ? ev["transcript_path"].slice(0, 2048) : "";

  if (isOff(home)) return undefined;
  const state = readState(home.stateFile);
  if (!captureAllowed(state, projectKey(cwd))) return undefined;

  mkdirSync(home.queueDir, { recursive: true, mode: 0o700 });
  const file = join(home.queueDir, `${sid}.jsonl`);
  appendFileSync(file, JSON.stringify({ e: name, ts: Date.now(), cwd, tp: transcript }) + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);

  if (CLOSING.has(name)) {
    const child = spawn(process.execPath, [helperJs], { detached: true, stdio: "ignore", env: pickEnv(DRAIN_ENV) });
    child.on("error", () => undefined);
    child.unref();
  }

  if (name === "SessionStart" && !state.notice_shown) {
    state.notice_shown = true;
    writeState(home.stateFile, state);
    return JSON.stringify({ systemMessage: NOTICE });
  }
  return undefined;
}

function main(): void {
  if (process.env["ONEPEEK_WORKLOG_INTERNAL"] === "1") return; // E2: the helper's own headless run never logs itself
  try {
    const out = handle(readStdin());
    if (out) process.stdout.write(out + "\n");
  } catch {
    // never fail the person's session
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
  process.exitCode = 0;
}

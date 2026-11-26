// The headless summariser (rules B3, B7): the person's own Claude Code, one shot, no tools, no MCP servers, no slash
// commands or skills, no user/project settings, no session saved, run in an empty throw-away folder, 60 s hard cap.
// It cannot read a file, run a command or call the network itself; its only input is the redacted session text on stdin.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SYSTEM_PROMPT, WRAPPER } from "./prompt.js";
import { pickEnv, SUMMARISER_ENV } from "../state/env.js";

export const SUMMARY_TIMEOUT_MS = 60_000;
// An exact model id, never an alias: an alias moves when a newer model ships and would change the summaries unnoticed.
// The CLI has no temperature flag, so the id is the only pin available.
export const SUMMARY_MODEL = "claude-sonnet-5-5";

export type Summariser = (sessionText: string) => Promise<string | undefined>;

/** The exact argument list. A test pins it: adding a tool, an MCP config or a settings source is a visible change. */
export function claudeArgs(): string[] {
  return [
    "-p",
    "--system-prompt", SYSTEM_PROMPT,
    "--tools", "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--setting-sources", "",
    "--no-session-persistence",
    "--output-format", "json",
    "--model", SUMMARY_MODEL,
  ];
}

/** Only what the child needs to find `claude` and its sign-in. Nothing else from the parent environment is passed. */
export function childEnv(src?: NodeJS.ProcessEnv): Record<string, string> {
  const env = pickEnv(SUMMARISER_ENV, src);
  env["ONEPEEK_WORKLOG_INTERNAL"] = "1"; // E2: every hook of this run exits at once
  return env;
}

export function buildInput(sessionText: string, mark = randomBytes(12).toString("hex")): string {
  // the session text can never contain the marker (it is random and new), so it cannot close its own block
  return WRAPPER.replaceAll("{{MARK}}", mark).replace("{{SESSION}}", () => sessionText.replaceAll(mark, ""));
}

export function realSummariser(workRoot: string, bin = "claude"): Summariser {
  return async (sessionText) => {
    mkdirSync(workRoot, { recursive: true, mode: 0o700 });
    const dir = mkdtempSync(join(workRoot, "run-"));
    try {
      return await new Promise<string | undefined>((resolve) => {
        const child = spawn(bin, claudeArgs(), { cwd: dir, env: childEnv(), stdio: ["pipe", "pipe", "ignore"] });
        let out = "";
        let done = false;
        const finish = (v: string | undefined): void => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(v);
        };
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          finish(undefined);
        }, SUMMARY_TIMEOUT_MS);
        child.stdout.on("data", (b: Buffer) => {
          if (out.length < 200_000) out += b.toString("utf8");
        });
        child.on("error", () => finish(undefined));
        child.on("close", () => {
          try {
            const j = JSON.parse(out) as { result?: unknown; is_error?: unknown };
            finish(j.is_error === true || typeof j.result !== "string" ? undefined : j.result);
          } catch {
            finish(undefined);
          }
        });
        child.stdin.on("error", () => undefined);
        child.stdin.end(buildInput(sessionText));
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

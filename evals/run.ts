// `npm run eval`: run the REAL summariser (headless claude, the locked-down flags of src/summarise/run.ts) over the 30
// HELD-OUT sessions in evals/sessions, judge each against its reference answer with a DIFFERENT model (opus judges the
// sonnet summariser), and write evals/results/latest.json with the run metadata (resolved model ids, CLI version, prompt,
// judge and set sha256, date). Exit code 1 below the bar (27 of 30) or on any leak.
// Honesty rules (review round 1): the held-out set was written by a separate agent that never saw the prompt or the dev
// sets; prompt work uses only evals/dev and evals/dev-2 (`npm run eval -- --set dev|dev-2`, written to results/<set>.json),
// never the held-out set. A held-out set run twice is burned and moves to a dev set (evals/dev-2 is held-out set 1).
// Needs a signed-in `claude`; it costs the person's own tokens (about 60 runs), so it is not part of `npm test`.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { finalizeInsight } from "../src/record/insight.js";
import { condense } from "../src/summarise/condense.js";
import { buildInput, childEnv, claudeArgs, realSummariser, SUMMARY_MODEL } from "../src/summarise/run.js";
import { learnNames } from "../src/clean/learned.js";
import { parseTranscript } from "../src/usage/transcript.js";
import { promptSha256 } from "../src/summarise/prompt.js";
import { toTranscript } from "./builder.js";
import { JUDGE_SYSTEM, combine, deterministic, judgeInput, loadSessions, parseJudge, type Verdict } from "./judge.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PASS_BAR = 27;
/** The judge is a different, stronger model than the summariser (SUMMARY_MODEL = sonnet), so it does not grade itself. */
export const JUDGE_MODEL = "opus";
const judgeModels = new Set<string>();

function claudeJson(args: string[], input: string, models: Set<string>): Promise<string | undefined> {
  const dir = mkdtempSync(join(tmpdir(), "owl-judge-"));
  return new Promise((resolve) => {
    const child = spawn("claude", args, { cwd: dir, env: childEnv(), stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.stdout.on("data", (b: Buffer) => (out += b.toString("utf8")));
    child.on("close", () => {
      clearTimeout(timer);
      rmSync(dir, { recursive: true, force: true });
      try {
        const j = JSON.parse(out) as { result?: string; modelUsage?: Record<string, unknown> };
        for (const m of Object.keys(j.modelUsage ?? {})) models.add(m);
        resolve(j.result);
      } catch {
        resolve(undefined);
      }
    });
    child.stdin.end(input);
  });
}

function judgeCall(input: string): Promise<string | undefined> {
  const args = ["-p", "--system-prompt", JUDGE_SYSTEM, "--tools", "", "--strict-mcp-config", "--disable-slash-commands", "--setting-sources", "", "--no-session-persistence", "--output-format", "json", "--model", JUDGE_MODEL];
  return claudeJson(args, input, judgeModels);
}

/** The model ids the summariser alias resolves to today, read from one probe run with the summariser's exact flags. */
async function summariserModels(): Promise<string[]> {
  const m = new Set<string>();
  await claudeJson(claudeArgs(), buildInput("ENGINEER: say hello\nASSISTANT: hello"), m);
  return [...m].sort();
}

function sha256Of(s: string | Buffer): string {
  return createHash("sha256").update(s).digest("hex");
}

/** sha256 over the set: every file name and its bytes, in name order. */
export function setSha256(dir: string): string {
  const h = createHash("sha256");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) h.update(f).update("\0").update(readFileSync(join(dir, f))).update("\0");
  return h.digest("hex");
}

async function one(spec: ReturnType<typeof loadSessions>[number], summarise: ReturnType<typeof realSummariser>): Promise<Verdict> {
  const parsed = parseTranscript(toTranscript(spec));
  const input = condense(parsed.steps);
  const names = await learnNames(spec.cwd, []);
  let raw = await summarise(input.text);
  if (raw === undefined) raw = await summarise(input.text); // one retry for a transient CLI failure
  const fin = raw === undefined ? undefined : finalizeInsight(raw, { ...names, taint: input.taint });
  const insight = fin?.ok ? fin.insight : undefined;
  const det = deterministic(spec.reference, insight, input.taint, names.learned);
  if (!insight) return { ...combine(spec.id, det, undefined, undefined), notes: [raw === undefined ? "summariser gave no answer" : fin && !fin.ok ? `held: ${fin.reason} ${fin.hits.join(",")} :: ${(raw ?? "").slice(0, 700)}` : "no insight"] };
  const jr = await judgeCall(judgeInput(input.text, spec.reference, insight));
  return combine(spec.id, det, jr ? parseJudge(jr) : undefined, insight);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const si = argv.indexOf("--set");
  const set = si >= 0 ? (argv[si + 1] as string) : "sessions";
  if (set !== "sessions" && set !== "dev" && set !== "dev-2") throw new Error("--set is sessions (held-out), dev or dev-2");
  const only = argv.filter((a, i) => a !== "--set" && i !== si + 1);
  const dir = join(ROOT, "evals", set);
  const sessions = loadSessions(dir).filter((x) => only.length === 0 || only.includes(x.id));
  const summarise = realSummariser(join(tmpdir(), "owl-eval-work"));
  const verdicts: Verdict[] = [];
  const queue = [...sessions];
  const worker = async (): Promise<void> => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      const v = await one(s, summarise);
      verdicts.push(v);
      console.log(`${v.pass ? "PASS" : "FAIL"} ${v.id}${v.pass ? "" : "  " + v.notes.join(" | ").slice(0, 900)}`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  verdicts.sort((a, b) => a.id.localeCompare(b.id));
  const passed = verdicts.filter((v) => v.pass).length;
  const leaks = verdicts.filter((v) => v.leak).length;
  const cli = (() => {
    try {
      return execFileSync("claude", ["--version"], { env: childEnv(), encoding: "utf8" }).trim();
    } catch {
      return "unknown";
    }
  })();
  const run = {
    date: new Date().toISOString(),
    set: set === "sessions" ? "held-out (evals/sessions, written without the prompt or the dev sets)" : `${set} (evals/${set}, used for prompt work)`,
    set_sha256: setSha256(dir),
    prompt_sha256: promptSha256(),
    judge_sha256: sha256Of(JUDGE_SYSTEM + "\n--model " + JUDGE_MODEL),
    claude_cli: cli,
    summariser_model: SUMMARY_MODEL,
    summariser_model_ids: await summariserModels(),
    judge_model: JUDGE_MODEL,
    judge_model_ids: [...judgeModels].sort(),
    partial: only.length > 0,
  };
  const result = { run, prompt_sha256: run.prompt_sha256, model: SUMMARY_MODEL, sessions: verdicts.length, passed, leaks, bar: PASS_BAR, ok: passed >= PASS_BAR && leaks === 0 && only.length === 0, verdicts: verdicts.map((v) => ({ id: v.id, pass: v.pass, criteria: v.criteria, notes: v.notes, summary: v.insight?.summary, task_type: v.insight?.task_type, decisions: v.insight?.decisions, skills: v.insight?.skills })) };
  mkdirSync(join(ROOT, "evals", "results"), { recursive: true });
  writeFileSync(join(ROOT, "evals", "results", set === "sessions" ? "latest.json" : `${set}.json`), JSON.stringify(result, null, 1) + "\n");
  console.log(`\nEVAL ${passed}/${verdicts.length} passed, ${leaks} leaks, bar ${PASS_BAR}/30 -> ${result.ok ? "OK" : "BELOW BAR"}`);
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();
export { buildInput };

// `npm run eval`: run the REAL summariser (headless claude, the locked-down flags of src/summarise/run.ts) over the 30
// sessions, judge each against its reference answer, and write evals/results/latest.json. Exit code 1 below the bar
// (27 of 30) or on any leak. Needs a signed-in `claude`; it costs the person's own tokens (about 60 runs), so it is
// not part of `npm test`; CI runs the harness self-checks and the release job runs this.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { finalizeInsight } from "../src/record/insight.js";
import { condense } from "../src/summarise/condense.js";
import { buildInput, childEnv, realSummariser } from "../src/summarise/run.js";
import { learnNames } from "../src/clean/learned.js";
import { parseTranscript } from "../src/usage/transcript.js";
import { promptSha256 } from "../src/summarise/prompt.js";
import { toTranscript } from "./builder.js";
import { JUDGE_SYSTEM, combine, deterministic, judgeInput, loadSessions, parseJudge, type Verdict } from "./judge.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PASS_BAR = 27;

function judgeCall(input: string): Promise<string | undefined> {
  const dir = mkdtempSync(join(tmpdir(), "owl-judge-"));
  return new Promise((resolve) => {
    const args = ["-p", "--system-prompt", JUDGE_SYSTEM, "--tools", "", "--strict-mcp-config", "--disable-slash-commands", "--setting-sources", "", "--no-session-persistence", "--output-format", "json", "--model", "sonnet"];
    const child = spawn("claude", args, { cwd: dir, env: childEnv(), stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.stdout.on("data", (b: Buffer) => (out += b.toString("utf8")));
    child.on("close", () => {
      clearTimeout(timer);
      rmSync(dir, { recursive: true, force: true });
      try {
        resolve((JSON.parse(out) as { result?: string }).result);
      } catch {
        resolve(undefined);
      }
    });
    child.stdin.end(input);
  });
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
  const only = process.argv.slice(2);
  const sessions = loadSessions(join(ROOT, "evals", "sessions")).filter((x) => only.length === 0 || only.includes(x.id));
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
  const result = { prompt_sha256: promptSha256(), model: "sonnet", sessions: verdicts.length, passed, leaks, bar: PASS_BAR, ok: passed >= PASS_BAR && leaks === 0, verdicts: verdicts.map((v) => ({ id: v.id, pass: v.pass, criteria: v.criteria, notes: v.notes, summary: v.insight?.summary, task_type: v.insight?.task_type, decisions: v.insight?.decisions, skills: v.insight?.skills })) };
  mkdirSync(join(ROOT, "evals", "results"), { recursive: true });
  writeFileSync(join(ROOT, "evals", "results", "latest.json"), JSON.stringify(result, null, 1) + "\n");
  console.log(`\nEVAL ${passed}/${verdicts.length} passed, ${leaks} leaks, bar ${PASS_BAR}/30 -> ${result.ok ? "OK" : "BELOW BAR"}`);
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();
export { buildInput };

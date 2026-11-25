// Measured signals (rule A3): exact numbers computed by plug-in code from Claude Code's own local transcript. Pure:
// text in, numbers out. No model is ever involved, and nothing here is a quote from the transcript.

export interface ToolCalls {
  read: number;
  edit: number;
  write: number;
  shell: number;
  search: number;
  web: number;
  mcp: number;
  subagent: number;
  other: number;
}
export interface RunCounts {
  runs: number;
  passed: number;
  failed: number;
}
export interface Usage {
  started_at_device: string;
  ended_at_device: string;
  active_seconds: number;
  prompt_count: number;
  turn_count: number;
  ai_lines_added: number;
  ai_lines_removed: number;
  tool_calls: ToolCalls;
  models: { model_id: string; turns: number }[];
  tests: RunCounts;
  builds: RunCounts;
  subagents_used: number;
}

/** One block of the session as the summariser and the usage code see it. Local only; never serialised into a record. */
export type ToolStep = { kind: "tool"; ts: number; name: string; target: string; command?: string; ok?: boolean; note?: string; added?: number; removed?: number };
export type Step = { kind: "prompt"; ts: number; text: string } | { kind: "reply"; ts: number; text: string } | ToolStep;

export interface Parsed {
  /** Claude Code's own version, read from the transcript lines. */
  version?: string;
  usage: Usage | undefined;
  steps: Step[];
}

const IDLE_CAP_MS = 300_000; // a gap longer than 5 minutes is the person away: it adds nothing to active time

const TEST_RE = /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\w*|pytest|vitest|jest|go\s+test|cargo\s+test|mvn\s+(?:\S+\s+)*test|gradlew?\s+(?:\S+\s+)*test|dotnet\s+test|phpunit|rspec|node\s+--test|ctest|make\s+test|mocha|playwright\s+test)\b/;
const BUILD_RE = /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\w*|cargo\s+build|go\s+build|mvn\s+(?:\S+\s+)*(?:package|compile)|gradlew?\s+(?:\S+\s+)*build|docker\s+build|next\s+build|vite\s+build|webpack|dotnet\s+build)\b|\bmake(?:\s+build)?\s*$/;

export function toolKind(name: string): keyof ToolCalls {
  if (name.startsWith("mcp__")) return "mcp";
  switch (name) {
    case "Read":
    case "NotebookRead":
      return "read";
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return "edit";
    case "Write":
      return "write";
    case "Bash":
    case "BashOutput":
    case "KillShell":
    case "PowerShell":
      return "shell";
    case "Grep":
    case "Glob":
    case "LS":
      return "search";
    case "WebFetch":
    case "WebSearch":
      return "web";
    case "Task":
    case "Agent":
      return "subagent";
    default:
      return "other";
  }
}

function lines(s: unknown): string[] {
  if (typeof s !== "string" || s === "") return [];
  return s.replace(/\n$/, "").split("\n");
}

/** Exact line delta of one replacement: common leading and trailing lines are not counted as changed. */
export function lineDelta(oldS: unknown, newS: unknown): { added: number; removed: number } {
  const a = lines(oldS);
  const b = lines(newS);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return { removed: endA - start, added: endB - start };
}

function targetOf(name: string, input: Record<string, unknown>): string {
  const pick = (k: string): string => (typeof input[k] === "string" ? (input[k] as string) : "");
  switch (toolKind(name)) {
    case "read":
    case "edit":
    case "write":
      return pick("file_path") || pick("notebook_path") || pick("path");
    case "search":
      return pick("pattern") || pick("path");
    case "web":
      return pick("url") || pick("query");
    case "subagent":
      return pick("description");
    default:
      return "";
  }
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => (b && typeof b === "object" && (b as { type?: string }).type === "text" ? String((b as { text?: unknown }).text ?? "") : ""))
    .join("\n");
}

function isSystemish(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("<local-command") || t.startsWith("<command-") || t.startsWith("[Request interrupted") || t.startsWith("Caveat:") || t.startsWith("<system-reminder") || t.startsWith("<task-notification") || t.startsWith("<agent-message");
}

export function parseTranscript(raw: string): Parsed {
  const steps: Step[] = [];
  const stamps: number[] = [];
  const calls: ToolCalls = { read: 0, edit: 0, write: 0, shell: 0, search: 0, web: 0, mcp: 0, subagent: 0, other: 0 };
  const models = new Map<string, number>();
  const seenMsg = new Set<string>();
  const pendingTool = new Map<string, ToolStep>();
  const kindOfCmd = new Map<string, "tests" | "builds">();
  const tests: RunCounts = { runs: 0, passed: 0, failed: 0 };
  const builds: RunCounts = { runs: 0, passed: 0, failed: 0 };
  let prompts = 0;
  let turns = 0;
  let added = 0;
  let removed = 0;
  let subagents = 0;
  let version: string | undefined;

  for (const line of raw.split("\n")) {
    if (line.length < 2) continue;
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (version === undefined && typeof d["version"] === "string" && /^[0-9][0-9A-Za-z.+-]{0,31}$/.test(d["version"])) version = d["version"];
    const type = d["type"];
    if ((type !== "user" && type !== "assistant") || d["isSidechain"] === true) continue;
    const msg = d["message"] as { content?: unknown; id?: unknown; model?: unknown } | undefined;
    if (!msg) continue;
    const ts = typeof d["timestamp"] === "string" ? Date.parse(d["timestamp"]) : NaN;
    if (!Number.isFinite(ts)) continue;
    stamps.push(ts);

    if (type === "user") {
      const blocks = Array.isArray(msg.content) ? (msg.content as Record<string, unknown>[]) : [];
      for (const b of blocks) {
        if (b["type"] !== "tool_result") continue;
        const id = typeof b["tool_use_id"] === "string" ? b["tool_use_id"] : "";
        const st = pendingTool.get(id);
        if (!st) continue;
        const isErr = b["is_error"] === true;
        st.ok = !isErr;
        if (isErr) st.note = textOf(b["content"]).slice(0, 400);
        const k = kindOfCmd.get(id);
        if (k) {
          const c = k === "tests" ? tests : builds;
          if (isErr) c.failed++;
          else c.passed++;
        }
      }
      const text = textOf(msg.content);
      const onlyResults = blocks.length > 0 && blocks.every((b) => b["type"] === "tool_result");
      if (d["isMeta"] !== true && text.trim() !== "" && !isSystemish(text) && !onlyResults) {
        prompts++;
        steps.push({ kind: "prompt", ts, text });
      }
      continue;
    }

    const mid = typeof msg.id === "string" ? msg.id : "";
    if (mid !== "" && !seenMsg.has(mid)) {
      seenMsg.add(mid);
      turns++;
      const model = typeof msg.model === "string" ? msg.model : "";
      if (model !== "" && model !== "<synthetic>" && /^[A-Za-z0-9._:-]{1,64}$/.test(model)) models.set(model, (models.get(model) ?? 0) + 1);
    }
    const blocks = Array.isArray(msg.content) ? (msg.content as Record<string, unknown>[]) : [];
    for (const b of blocks) {
      if (b["type"] === "text" && typeof b["text"] === "string" && b["text"].trim() !== "") {
        steps.push({ kind: "reply", ts, text: b["text"] });
      } else if (b["type"] === "tool_use" && typeof b["name"] === "string") {
        const name = b["name"];
        const input = (b["input"] && typeof b["input"] === "object" ? b["input"] : {}) as Record<string, unknown>;
        const kind = toolKind(name);
        calls[kind]++;
        if (kind === "subagent") subagents++;
        const step: ToolStep = { kind: "tool", ts, name, target: targetOf(name, input) };
        const id = typeof b["id"] === "string" ? b["id"] : "";
        if (name === "Edit") {
          const dl = lineDelta(input["old_string"], input["new_string"]);
          added += dl.added;
          removed += dl.removed;
          step.added = dl.added;
          step.removed = dl.removed;
        } else if (name === "MultiEdit" && Array.isArray(input["edits"])) {
          for (const e of input["edits"] as Record<string, unknown>[]) {
            const dl = lineDelta(e["old_string"], e["new_string"]);
            added += dl.added;
            removed += dl.removed;
          }
        } else if (name === "Write") {
          const n = lines(input["content"]).length;
          added += n;
          step.added = n;
        } else if (name === "NotebookEdit") {
          added += lines(input["new_source"]).length;
        } else if (kind === "shell" && typeof input["command"] === "string") {
          const cmd = input["command"];
          step.command = cmd.slice(0, 300);
          if (TEST_RE.test(cmd)) {
            tests.runs++;
            if (id) kindOfCmd.set(id, "tests");
          } else if (BUILD_RE.test(cmd)) {
            builds.runs++;
            if (id) kindOfCmd.set(id, "builds");
          }
        }
        if (id) pendingTool.set(id, step);
        steps.push(step);
      }
    }
  }

  if (stamps.length === 0) return { usage: undefined, steps, ...(version ? { version } : {}) };
  stamps.sort((x, y) => x - y);
  let active = 0;
  for (let i = 1; i < stamps.length; i++) {
    const gap = (stamps[i] as number) - (stamps[i - 1] as number);
    if (gap <= IDLE_CAP_MS) active += gap;
  }
  const clamp = (c: RunCounts): RunCounts => {
    const passed = Math.min(c.passed, c.runs);
    return { runs: c.runs, passed, failed: Math.min(c.failed, c.runs - passed) };
  };
  const usage: Usage = {
    started_at_device: new Date(stamps[0] as number).toISOString(),
    ended_at_device: new Date(stamps[stamps.length - 1] as number).toISOString(),
    active_seconds: Math.min(86_400, Math.round(active / 1000)),
    prompt_count: Math.min(prompts, 100_000),
    turn_count: Math.min(turns, 100_000),
    ai_lines_added: Math.min(added, 10_000_000),
    ai_lines_removed: Math.min(removed, 10_000_000),
    tool_calls: calls,
    models: [...models.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([model_id, n]) => ({ model_id, turns: n })),
    tests: clamp(tests),
    builds: clamp(builds),
    subagents_used: Math.min(subagents, 10_000),
  };
  return { usage, steps, ...(version ? { version } : {}) };
}

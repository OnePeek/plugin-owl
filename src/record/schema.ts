// The `Record` of contracts/openapi/ai-plugin.yaml as types plus a strict validator (allow-list: any unknown field fails).
// The validator mirrors the server's field codes so a record that would be rejected is never sent (AIP-E3).
import type { Commit } from "../usage/git.js";
import type { Usage } from "../usage/transcript.js";
import type { Insight } from "./insight.js";
import type { KeyStoreKind } from "../sign/keys.js";

export interface Record_ {
  schema: "worklog_record.v2";
  kind: "session" | "discarded" | "held" | "expired";
  env: "local" | "preprod" | "prod";
  audience: "onepeek-ai-plugin";
  install_id: string;
  seq: number;
  prev_hash: string;
  created_at_device: string;
  key_store: KeyStoreKind;
  plugin_version: string;
  plugin_build_sha256: string;
  prompt_sha256: string;
  tool: "claude_code";
  tool_version: string;
  session_ref?: string;
  /** Gap entries only: why the record at this seq was not sent. A code, never a value. */
  reason_code?: string;
  usage?: Usage;
  commits?: Commit[];
  insight?: Insight;
}

export interface FieldCode {
  path: string;
  code: "required" | "type" | "too_long" | "too_many" | "pattern" | "enum" | "range" | "forbidden_field" | "unknown_field";
}

const HEX64 = /^[0-9a-f]{64}$/;
const TS = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MODEL = /^[A-Za-z0-9._:-]{1,64}$/;
const SKILL = /^[A-Za-z0-9][A-Za-z0-9 .+#/-]{0,39}$/;
const TASKS = ["bugfix", "feature", "refactor", "tests", "infra", "debugging", "review", "docs", "data", "migration"];
const TOOLS = ["read", "edit", "write", "shell", "search", "web", "mcp", "subagent", "other"];

export function validateRecord(r: unknown): FieldCode[] {
  const errs: FieldCode[] = [];
  const bad = (path: string, code: FieldCode["code"]): void => void errs.push({ path, code });
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const int = (v: unknown, path: string, min: number, max: number): void => {
    if (typeof v !== "number" || !Number.isInteger(v)) bad(path, "type");
    else if (v < min || v > max) bad(path, "range");
  };
  const str = (v: unknown, path: string, re: RegExp, max: number): void => {
    if (typeof v !== "string") bad(path, "type");
    else if (v.length > max) bad(path, "too_long");
    else if (!re.test(v) || v !== v.normalize("NFC")) bad(path, "pattern");
  };
  const exact = (o: Record<string, unknown>, allowed: string[], base: string): void => {
    for (const k of Object.keys(o)) if (!allowed.includes(k)) bad(`${base}${k}`, "unknown_field");
  };
  if (!isObj(r)) return [{ path: "", code: "type" }];
  const top = ["schema", "kind", "env", "audience", "install_id", "seq", "prev_hash", "created_at_device", "key_store", "plugin_version", "plugin_build_sha256", "prompt_sha256", "tool", "tool_version", "session_ref", "reason_code", "usage", "commits", "insight"];
  exact(r, top, "");
  for (const k of top.slice(0, 14)) if (k !== "session_ref" && r[k] === undefined) bad(k, "required");
  if (r["schema"] !== "worklog_record.v2") bad("schema", "enum");
  if (!["session", "discarded", "held", "expired"].includes(r["kind"] as string)) bad("kind", "enum");
  if (!["local", "preprod", "prod"].includes(r["env"] as string)) bad("env", "enum");
  if (r["audience"] !== "onepeek-ai-plugin") bad("audience", "enum");
  str(r["install_id"], "install_id", UUID, 36);
  int(r["seq"], "seq", 1, Number.MAX_SAFE_INTEGER);
  str(r["prev_hash"], "prev_hash", HEX64, 64);
  str(r["created_at_device"], "created_at_device", TS, 30);
  if (r["key_store"] !== "hardware" && r["key_store"] !== "software") bad("key_store", "enum");
  str(r["plugin_version"], "plugin_version", /^.+$/, 32);
  str(r["plugin_build_sha256"], "plugin_build_sha256", HEX64, 64);
  str(r["prompt_sha256"], "prompt_sha256", HEX64, 64);
  if (r["tool"] !== "claude_code") bad("tool", "enum");
  str(r["tool_version"], "tool_version", /^.+$/, 32);
  if (r["session_ref"] !== undefined) str(r["session_ref"], "session_ref", UUID, 36);

  if (r["kind"] !== "session") {
    // a content-free gap entry (discarded, held, expired) keeps the chain unbroken at the seq it stands in for
    for (const k of ["usage", "insight", "commits", "session_ref"]) if (r[k] !== undefined) bad(k, "forbidden_field");
    if (r["reason_code"] !== undefined) str(r["reason_code"], "reason_code", /^[a-z][a-z_]{1,39}$/, 40);
    else if (r["kind"] !== "discarded") bad("reason_code", "required");
    return errs;
  }
  if (r["reason_code"] !== undefined) bad("reason_code", "forbidden_field");
  const u = r["usage"];
  if (!isObj(u)) bad("usage", "required");
  else {
    exact(u, ["started_at_device", "ended_at_device", "active_seconds", "prompt_count", "turn_count", "ai_lines_added", "ai_lines_removed", "tool_calls", "models", "tests", "builds", "subagents_used"], "usage.");
    str(u["started_at_device"], "usage.started_at_device", TS, 30);
    str(u["ended_at_device"], "usage.ended_at_device", TS, 30);
    int(u["active_seconds"], "usage.active_seconds", 0, 86400);
    int(u["prompt_count"], "usage.prompt_count", 0, 100000);
    int(u["turn_count"], "usage.turn_count", 0, 100000);
    int(u["ai_lines_added"], "usage.ai_lines_added", 0, 10_000_000);
    int(u["ai_lines_removed"], "usage.ai_lines_removed", 0, 10_000_000);
    int(u["subagents_used"], "usage.subagents_used", 0, 10000);
    if (!isObj(u["tool_calls"])) bad("usage.tool_calls", "type");
    else {
      exact(u["tool_calls"], TOOLS, "usage.tool_calls.");
      for (const [k, v] of Object.entries(u["tool_calls"])) int(v, `usage.tool_calls.${k}`, 0, Number.MAX_SAFE_INTEGER);
    }
    if (!Array.isArray(u["models"])) bad("usage.models", "type");
    else {
      if (u["models"].length > 8) bad("usage.models", "too_many");
      u["models"].forEach((m: unknown, i: number) => {
        if (!isObj(m)) return bad(`usage.models.${i}`, "type");
        exact(m, ["model_id", "turns"], `usage.models.${i}.`);
        str(m["model_id"], `usage.models.${i}.model_id`, MODEL, 64);
        int(m["turns"], `usage.models.${i}.turns`, 0, Number.MAX_SAFE_INTEGER);
      });
    }
    for (const k of ["tests", "builds"]) {
      const c = u[k];
      if (!isObj(c)) bad(`usage.${k}`, "type");
      else {
        exact(c, ["runs", "passed", "failed"], `usage.${k}.`);
        for (const f of ["runs", "passed", "failed"]) int(c[f], `usage.${k}.${f}`, 0, Number.MAX_SAFE_INTEGER);
        if (typeof c["runs"] === "number" && typeof c["passed"] === "number" && typeof c["failed"] === "number" && c["passed"] + c["failed"] > c["runs"]) bad(`usage.${k}`, "range");
      }
    }
  }
  if (r["commits"] !== undefined) {
    if (!Array.isArray(r["commits"])) bad("commits", "type");
    else {
      if (r["commits"].length > 50) bad("commits", "too_many");
      r["commits"].forEach((c: unknown, i: number) => {
        if (!isObj(c)) return bad(`commits.${i}`, "type");
        exact(c, ["hash", "files_changed", "insertions", "deletions"], `commits.${i}.`);
        str(c["hash"], `commits.${i}.hash`, /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/, 64);
        for (const f of ["files_changed", "insertions", "deletions"]) int(c[f], `commits.${i}.${f}`, 0, Number.MAX_SAFE_INTEGER);
      });
    }
  }
  if (r["insight"] !== undefined) {
    const n = r["insight"];
    if (!isObj(n)) bad("insight", "type");
    else {
      exact(n, ["summary", "task_type", "decisions", "skills"], "insight.");
      if (typeof n["summary"] !== "string") bad("insight.summary", "type");
      else if (n["summary"].length < 20 || n["summary"].length > 600) bad("insight.summary", n["summary"].length < 20 ? "range" : "too_long");
      if (!TASKS.includes(n["task_type"] as string)) bad("insight.task_type", "enum");
      if (!Array.isArray(n["decisions"])) bad("insight.decisions", "type");
      else {
        if (n["decisions"].length > 8) bad("insight.decisions", "too_many");
        n["decisions"].forEach((d: unknown, i: number) => {
          if (typeof d !== "string") bad(`insight.decisions.${i}`, "type");
          else if (d.length > 300) bad(`insight.decisions.${i}`, "too_long");
          else if (d.length < 10) bad(`insight.decisions.${i}`, "range");
        });
      }
      if (!Array.isArray(n["skills"])) bad("insight.skills", "type");
      else {
        if (n["skills"].length > 12) bad("insight.skills", "too_many");
        n["skills"].forEach((s: unknown, i: number) => str(s, `insight.skills.${i}`, SKILL, 40));
      }
    }
  }
  return errs;
}

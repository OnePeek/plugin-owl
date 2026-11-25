// Allow-list construction (AIP-A1, A2, E1): a record is assembled field by field from measured usage, commit hashes and
// the cleaned insight. Nothing is copied from the transcript wholesale, so a field that is not named here cannot leave.
import type { Commit } from "../usage/git.js";
import type { Usage } from "../usage/transcript.js";
import type { KeyStoreKind } from "../sign/keys.js";
import type { Insight } from "./insight.js";
import type { Record_ } from "./schema.js";

export interface BuildMeta {
  env: "local" | "preprod" | "prod";
  install_id: string;
  seq: number;
  prev_hash: string;
  created_at_device: string;
  key_store: KeyStoreKind;
  plugin_version: string;
  plugin_build_sha256: string;
  prompt_sha256: string;
  tool_version: string;
}

function head(m: BuildMeta, kind: Record_["kind"]): Record_ {
  return { schema: "worklog_record.v2", kind, env: m.env, audience: "onepeek-ai-plugin", install_id: m.install_id, seq: m.seq, prev_hash: m.prev_hash, created_at_device: m.created_at_device, key_store: m.key_store, plugin_version: m.plugin_version, plugin_build_sha256: m.plugin_build_sha256, prompt_sha256: m.prompt_sha256, tool: "claude_code", tool_version: m.tool_version };
}

export function buildSession(m: BuildMeta, sessionRef: string, usage: Usage, commits: Commit[], insight: Insight | undefined): Record_ {
  const r = head(m, "session");
  r.session_ref = sessionRef;
  r.usage = {
    started_at_device: usage.started_at_device,
    ended_at_device: usage.ended_at_device,
    active_seconds: usage.active_seconds,
    prompt_count: usage.prompt_count,
    turn_count: usage.turn_count,
    ai_lines_added: usage.ai_lines_added,
    ai_lines_removed: usage.ai_lines_removed,
    tool_calls: { ...usage.tool_calls },
    models: usage.models.map((x) => ({ model_id: x.model_id, turns: x.turns })),
    tests: { ...usage.tests },
    builds: { ...usage.builds },
    subagents_used: usage.subagents_used,
  };
  if (commits.length > 0) r.commits = commits.slice(0, 50).map((c) => ({ hash: c.hash, files_changed: c.files_changed, insertions: c.insertions, deletions: c.deletions }));
  if (insight) r.insight = { summary: insight.summary, task_type: insight.task_type, decisions: [...insight.decisions], skills: [...insight.skills] };
  return r;
}

/** The content-free entry that stands in for a record that will not be sent (discarded by the person, held by the server, aged out). */
export function buildGap(m: BuildMeta, kind: "discarded" | "held" | "expired", reason?: string): Record_ {
  const r = head(m, kind);
  if (reason) r.reason_code = reason;
  return r;
}

// Turn the summariser's raw reply into a record `insight`, or HOLD (rules E2, E3). The model's output is untrusted: it is
// parsed strictly, every string is cleaned and then checked with the contract's text rules; one remaining hit holds the
// whole record. Nothing is ever "fixed up" beyond the typographic cleaner.
import { checkText, cleanText, typographic, sentenceCount, type Hit, type Names } from "../clean/filter.js";
import { TASK_TYPES, type TaskType } from "../summarise/prompt.js";

export interface Insight {
  summary: string;
  task_type: TaskType;
  decisions: string[];
  skills: string[];
}
export type InsightResult = { ok: true; insight: Insight } | { ok: false; reason: "unparseable" | "schema" | "caps" | "leak"; hits: Hit[] };

/** AIP-E3 caps (P). Over a cap the record is not sent (the device holds it); nothing is ever cut to fit. */
export const CAPS = { summaryChars: 600, summarySentences: 3, decisions: 8, decisionChars: 300, skills: 12, skillChars: 40 } as const;

const SKILL = /^[A-Za-z0-9][A-Za-z0-9 .+#/-]{0,39}$/;

function extractJson(raw: string): unknown {
  let t = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t);
  if (fence) t = fence[1] as string;
  return JSON.parse(t);
}

export function finalizeInsight(raw: string, names: Names): InsightResult {
  let j: unknown;
  try {
    j = extractJson(raw);
  } catch {
    return { ok: false, reason: "unparseable", hits: [] };
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return { ok: false, reason: "schema", hits: [] };
  const o = j as Record<string, unknown>;
  const keys = Object.keys(o).sort().join(",");
  if (keys !== "decisions,skills,summary,task_type") return { ok: false, reason: "schema", hits: [] };
  if (typeof o["summary"] !== "string" || typeof o["task_type"] !== "string" || !Array.isArray(o["decisions"]) || !Array.isArray(o["skills"])) return { ok: false, reason: "schema", hits: [] };
  if (!(TASK_TYPES as readonly string[]).includes(o["task_type"])) return { ok: false, reason: "schema", hits: [] };
  if (!o["decisions"].every((d) => typeof d === "string") || !o["skills"].every((s) => typeof s === "string")) return { ok: false, reason: "schema", hits: [] };

  if (o["decisions"].length > CAPS.decisions || o["skills"].length > CAPS.skills) return { ok: false, reason: "caps", hits: [] };
  const summary = cleanText(o["summary"], names);
  const decisions = (o["decisions"] as string[]).map((d) => cleanText(d, names));
  const skills = [...new Set((o["skills"] as string[]).map((s) => cleanText(s, names)))]; // exact duplicates are dropped

  if (summary.length > CAPS.summaryChars || sentenceCount(summary) > CAPS.summarySentences) return { ok: false, reason: "caps", hits: [] };
  if (decisions.some((d) => d.length > CAPS.decisionChars) || skills.some((s) => s.length > CAPS.skillChars)) return { ok: false, reason: "caps", hits: [] };
  if (summary.length < 20) return { ok: false, reason: "schema", hits: [] };
  if (decisions.some((d) => d.length < 10)) return { ok: false, reason: "schema", hits: [] };
  if (skills.some((s) => !SKILL.test(s))) return { ok: false, reason: "schema", hits: [] };

  const hits = new Set<Hit>();
  for (const t of [summary, ...decisions, ...skills]) for (const h of checkText(t, names)) hits.add(h);
  // B5: the learned-name rewrite can hide a structure (priya@acme-internal.example became priya@the project.example); read the
  // text before the rewrite too, for every rule except the name rules themselves
  for (const t of [o["summary"] as string, ...(o["decisions"] as string[]), ...(o["skills"] as string[])]) for (const h of checkText(typographic(t), { ...names, learned: [] })) hits.add(h);
  if (hits.size > 0) return { ok: false, reason: "leak", hits: [...hits] };
  return { ok: true, insight: { summary, task_type: o["task_type"] as TaskType, decisions, skills } };
}

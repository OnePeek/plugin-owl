// Turn the summariser's raw reply into a record `insight`, or HOLD (rules E2, E3). The model's output is untrusted: it is
// parsed strictly, every string is cleaned and then checked with the contract's text rules; one remaining hit holds the
// whole record. Nothing is ever "fixed up" beyond the typographic cleaner.
import { checkText, cleanText, sentenceCount, type Hit, type Names } from "../clean/filter.js";
import { TASK_TYPES, type TaskType } from "../summarise/prompt.js";

export interface Insight {
  summary: string;
  task_type: TaskType;
  decisions: string[];
  skills: string[];
}
export type InsightResult = { ok: true; insight: Insight } | { ok: false; reason: "unparseable" | "schema" | "leak"; hits: Hit[] };

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

  const summary = cleanText(o["summary"], names);
  const decisions = (o["decisions"] as string[]).slice(0, 8).map((d) => cleanText(d, names));
  // a slash in a skill name is turned into a dash (CI/CD becomes CI-CD); too many skills are cut to the first 12
  const skills = [...new Set((o["skills"] as string[]).slice(0, 12).map((s) => cleanText(s.replaceAll("/", "-"), names)))];

  if (summary.length < 20 || summary.length > 600 || sentenceCount(summary) > 3) return { ok: false, reason: "schema", hits: [] };
  if (decisions.some((d) => d.length < 10 || d.length > 300)) return { ok: false, reason: "schema", hits: [] };
  if (skills.some((s) => !SKILL.test(s))) return { ok: false, reason: "schema", hits: [] };

  const hits = new Set<Hit>();
  for (const t of [summary, ...decisions, ...skills]) for (const h of checkText(t, names)) hits.add(h);
  if (hits.size > 0) return { ok: false, reason: "leak", hits: [...hits] };
  return { ok: true, insight: { summary, task_type: o["task_type"] as TaskType, decisions, skills } };
}

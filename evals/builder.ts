// Compile a compact session description into a Claude Code transcript (JSONL), the shape the plug-in reads in real use.
// Used by the eval set (30 sessions) and by the privacy and injection fixtures.
export type Step =
  | { u: string } // the engineer types a request
  | { a: string } // assistant text
  | { t: string; i: Record<string, unknown>; r?: string; err?: boolean; gap?: number }; // a tool call and its result

export interface Reference {
  task_type: string;
  summary: string;
  /** Facts a correct summary may state; anything specific that is not here or in the session is an invention. */
  facts: string[];
  /** The technique or problem class a specific summary names (one of these must be recognisable). */
  specific: string[];
  decisions: { choice: string; reason: string }[];
  skills: string[];
  /** Skills a padded answer would wrongly add (never exercised in the session). */
  not_skills?: string[];
}
export interface SessionSpec {
  id: string;
  type: string;
  cwd: string;
  steps: Step[];
  reference: Reference;
}

const START = Date.parse("2026-11-20T09:00:00.000Z");

export function toTranscript(spec: SessionSpec, sessionId = "11111111-2222-3333-4444-555555555555"): string {
  const out: string[] = [];
  let ts = START;
  let n = 0;
  const base = { isSidechain: false, userType: "external", cwd: spec.cwd, sessionId, version: "2.1.332" };
  const line = (o: Record<string, unknown>): void => void out.push(JSON.stringify({ ...base, timestamp: new Date(ts).toISOString(), uuid: `u${n++}`, ...o }));
  for (const s of spec.steps) {
    if ("u" in s) {
      ts += 25_000;
      line({ type: "user", message: { role: "user", content: s.u } });
    } else if ("a" in s) {
      ts += 12_000;
      line({ type: "assistant", message: { id: `msg_${n}`, role: "assistant", model: "claude-sonnet-5-5", content: [{ type: "text", text: s.a }] } });
    } else {
      ts += 8_000;
      const id = `toolu_${n}`;
      line({ type: "assistant", message: { id: `msg_${n}`, role: "assistant", model: "claude-sonnet-5-5", content: [{ type: "tool_use", id, name: s.t, input: s.i }] } });
      ts += s.gap ?? 6_000;
      line({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: s.r ?? "ok", ...(s.err ? { is_error: true } : {}) }] } });
    }
  }
  return out.join("\n") + "\n";
}

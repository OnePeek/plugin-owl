// R3 (E2E 11-26): summaries were dominated by the person's own workflow rules. The headless summariser loads no
// instruction file or memory (its flags: no setting sources, an empty folder), but the SESSION does: the assistant
// quotes CLAUDE.md rules back ("the project's CLAUDE.md says the orchestrator writes no code"), Claude Code attaches
// system reminders, and the assistant reads instruction files. That text describes how a team works, not the work
// done, so it is taken out of the summariser's input. The same patterns measure an answer in the eval run, see `workflowShare`.

/** Tags Claude Code wraps around text that is context, not conversation. A block and its content are removed. */
const CONTEXT_BLOCK = /<(system-reminder|user-memory-input|memory|context|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat)\b[^>]*>[\s\S]*?(?:<\/\1>|$)/gi;

/** A sentence that talks about an instruction file, memory, reminders or the assistant's own process rules. */
const INSTRUCTION_REF = new RegExp(
  [
    String.raw`\b(?:CLAUDE|AGENTS|GEMINI|MEMORY|CONVENTIONS)\.md\b`,
    String.raw`\.cursorrules\b|\bcopilot-instructions\b|\.claude\/`,
    String.raw`\b(?:project|projects|workspace|repo|repository|user|global|team|custom)(?:'s)?\s+(?:own\s+)?(?:instructions?|rules\s+file|memory|guidance|workflow\s+rules|process\s+rules)\b`,
    String.raw`\binstructions?\s+(?:say|says|said|require|requires|required|ask|asks|asked|tell|tells|told|forbid|forbids)\b`,
    String.raw`\b(?:auto[- ]?memory|memory\s+(?:file|note|index|entry))\b`,
    String.raw`\bsystem[- ]reminders?\b|\bhook\s+(?:additional\s+)?context\b`,
    String.raw`\b(?:attribution|co-authored-by)\s+(?:note|line|instruction|trailer|rule)s?\b`,
    String.raw`\bprocess\s+deviation\b|\b(?:role|agent)\s+card\b`,
  ].join("|"),
  "i",
);

/** Workflow words an answer may use when it describes the team's process instead of the work. */
const WORKFLOW = new RegExp(
  INSTRUCTION_REF.source +
    "|" +
    [
      String.raw`\borchestrat(?:or|ion)\b`,
      String.raw`\b(?:builder|reviewer|sub-?)\s*agents?\b`,
      String.raw`\bdelegat(?:ed|ing|e|ion)\b`,
      String.raw`\b(?:health|doctor)\s+check\b`,
      String.raw`\bproject\s+(?:rules|conventions|policy|process)\b`,
      String.raw`\b(?:permission|approval)\s+(?:prompt|request|denial)s?\b|\bneeded\s+approval\b`,
    ].join("|"),
  "i",
);

/** A file the assistant reads for instructions or memory, never as work. */
export function isInstructionFile(target: string): boolean {
  const p = target.replace(/\\/g, "/");
  const name = p.split("/").pop() ?? "";
  return /^(?:CLAUDE|AGENTS|GEMINI|MEMORY)(?:\.local)?\.md$/i.test(name) || /(?:^|\/)\.claude\//.test(p) || /(?:^|\/)memory\/[^/]+\.md$/i.test(p) || name === ".cursorrules" || name === "copilot-instructions.md";
}

/** A tool call the permission system or a hook refused before it ran: it did nothing, so it is not part of the work. */
const REFUSED = /^\s*(?:This (?:Bash )?command (?:contains multiple operations\. The following parts? requires? approval|requires approval|uses shell operators that require approval)|A (?:group|variable)[^.]{0,60}can't be checked before it runs|Permission to use \S+ (?:has been|was) denied|The user doesn't want to proceed|\S*Hook \S* ?hook error|PreToolUse:\S+ hook error)/i;

export function refusedBeforeRun(note: string | undefined): boolean {
  return note !== undefined && REFUSED.test(note);
}

/** Remove context blocks (system reminders and similar) wherever they sit in a text. */
export function stripContextBlocks(text: string): string {
  return text.replace(CONTEXT_BLOCK, " ");
}

/** True when a sentence is about the instruction files, memory, reminders or process rules rather than the work. */
export function isInstructionSentence(sentence: string): boolean {
  return INSTRUCTION_REF.test(sentence);
}

const SENTENCE = /(?<=[.!?])\s+(?=[A-Z*_`(\[-])/;

/**
 * Drop every sentence that is about instructions or memory, line by line, keeping the rest of the line. A line whose
 * every sentence is dropped is dropped whole. Code-ish lines keep their shape; only prose sentences are split.
 */
export function dropInstructionText(text: string): string {
  const out: string[] = [];
  for (const line of stripContextBlocks(text).split("\n")) {
    if (!INSTRUCTION_REF.test(line)) {
      out.push(line);
      continue;
    }
    const kept = line.split(SENTENCE).filter((s) => !isInstructionSentence(s));
    // a remainder with no word left (a list number or a bullet whose sentence went) is dropped too
    if (kept.length > 0 && /[A-Za-z]{2}/.test(kept.join(" ").replace(/^\s*(?:[-*]|\d+[.)])\s*/, ""))) out.push(kept.join(" "));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Share (0 to 1) of an answer's summary sentences and decisions that describe workflow rules rather than the work. */
export function workflowShare(insight: { summary: string; decisions: string[] }): number {
  const parts = [...insight.summary.split(/(?<=[.!?])\s+/).filter((s) => s.trim() !== ""), ...insight.decisions];
  if (parts.length === 0) return 0;
  return parts.filter((p) => WORKFLOW.test(p)).length / parts.length;
}

/** The eval's R3 check: an answer is "mostly workflow" when more than half of its sentences and decisions are. */
export const WORKFLOW_MAX_SHARE = 0.5;

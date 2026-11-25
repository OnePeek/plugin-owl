import { redactInput } from "../clean/filter.js";
import type { Step } from "../usage/transcript.js";

const MAX_CHARS = 60_000;
const CAP = { prompt: 1500, reply: 1200, command: 220, note: 260 };

const cut = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n) + " ...");

/** The tail of a path is enough for the model to recognise the kind of file; the full path adds nothing it may say. */
function base(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).slice(-2).join("/");
}

/**
 * Turn the parsed session into compact text for the summariser. Secrets, emails, URLs and addresses are redacted FIRST,
 * so they never reach the model. Over budget, the start and the end are kept (the request and the outcome).
 */
export function condense(steps: Step[]): string {
  const out: string[] = [];
  for (const s of steps) {
    if (s.kind === "prompt") out.push(`ENGINEER: ${cut(s.text.trim(), CAP.prompt)}`);
    else if (s.kind === "reply") out.push(`ASSISTANT: ${cut(s.text.trim(), CAP.reply)}`);
    else {
      let line = `TOOL ${s.name}`;
      if (s.command) line += `: ${cut(s.command, CAP.command)}`;
      else if (s.target) line += `: ${base(s.target)}`;
      if (s.added || s.removed) line += ` (+${s.added ?? 0} -${s.removed ?? 0} lines)`;
      if (s.ok === false) line += ` -> FAILED${s.note ? `: ${cut(s.note.replace(/\s+/g, " "), CAP.note)}` : ""}`;
      else if (s.ok === true && s.command) line += " -> ok";
      out.push(line);
    }
  }
  let text = redactInput(out.join("\n"));
  if (text.length > MAX_CHARS) {
    const head = Math.floor(MAX_CHARS * 0.3);
    const tail = MAX_CHARS - head;
    text = text.slice(0, head) + "\n[... middle of the session omitted ...]\n" + text.slice(text.length - tail);
  }
  return text;
}

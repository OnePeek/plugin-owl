import { redactInput, type Redacted } from "../clean/filter.js";
import type { Step } from "../usage/transcript.js";
import { dropInstructionText, isInstructionFile, refusedBeforeRun, stripContextBlocks } from "./instructions.js";

const MAX_CHARS = 60_000;
const CAP = { prompt: 1500, reply: 1200, command: 220, note: 260, out: 200 };

const cut = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n) + " ...");

/** The tail of a path is enough for the model to recognise the kind of file; the full path adds nothing it may say. */
function base(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).slice(-2).join("/");
}

/**
 * Turn the parsed session into compact text for the summariser. Secrets, emails, URLs and addresses are redacted FIRST,
 * so they never reach the model. Over budget, the start and the end are kept (the request and the outcome).
 */
export function condense(steps: Step[]): Redacted {
  const out: string[] = [];
  for (const s of steps) {
    // R3: the session's work, not its instructions. Context blocks (system reminders) go everywhere; the assistant's
    // sentences about instruction files, memory or process rules go; a read of an instruction file goes, and so does a
    // tool call refused before it ran (it did nothing). The engineer's
    // own words and any edit of an instruction file stay: changing those files can be the work itself.
    if (s.kind === "prompt") {
      const t = stripContextBlocks(s.text).trim();
      if (t !== "") out.push(`ENGINEER: ${cut(t, CAP.prompt)}`);
    } else if (s.kind === "reply") {
      const t = dropInstructionText(s.text);
      if (t !== "") out.push(`ASSISTANT: ${cut(t, CAP.reply)}`);
    } else if ((s.name === "Read" && isInstructionFile(s.target)) || (s.ok === false && refusedBeforeRun(s.note))) {
      continue;
    } else {
      let line = `TOOL ${s.name}`;
      if (s.command) line += `: ${cut(s.command, CAP.command)}`;
      else if (s.target) line += `: ${base(s.target)}`;
      if (s.added || s.removed) line += ` (+${s.added ?? 0} -${s.removed ?? 0} lines)`;
      if (s.ok === false) line += ` -> FAILED${s.note ? `: ${cut(stripContextBlocks(s.note).replace(/\s+/g, " "), CAP.note)}` : ""}`;
      else if (s.ok === true && s.command) line += " -> ok";
      if (s.ok !== false && s.out && (s.name === "Bash" || s.name === "WebFetch" || s.name === "WebSearch" || s.name.startsWith("mcp__"))) line += ` => ${cut(stripContextBlocks(s.out).replace(/\s+/g, " "), CAP.out)}`;
      out.push(line);
    }
  }
  const red = redactInput(out.join("\n"));
  let text = red.text;
  if (text.length > MAX_CHARS) {
    const head = Math.floor(MAX_CHARS * 0.3);
    const tail = MAX_CHARS - head;
    text = text.slice(0, head) + "\n[... middle of the session omitted ...]\n" + text.slice(text.length - tail);
  }
  return { text, taint: red.taint };
}

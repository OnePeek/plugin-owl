// `onepeek-worklog <command>`: the ten commands of AIP-B2 and nothing else. Argument parsing is deliberately tiny: a command
// name plus the flags `--here` and `--reset`. Anything else is refused, so no content can be typed in. The one question the
// plug-in asks (share summaries?) is asked by the helper itself on a real terminal: never from an argument, never via the model.
import { fileURLToPath } from "node:url";
import { COMMANDS, connect, discard, preview, setMode, status, uninstall, verify, type CommandName, type Out } from "./commands.js";
import { createInterface } from "node:readline";
import { randomInt } from "node:crypto";
import { CONSENT_QUESTION } from "../send/contract.js";
import { openCtx, type Ctx } from "./ctx.js";
import { KeyStoreUnavailable } from "../keystore/os.js";

export interface Io {
  /** Ask the person the consent question. Resolves true only for an explicit yes typed at a real terminal. */
  askConsent: () => Promise<boolean>;
}

/** One prompt and the typed line, with how long after the prompt appeared the line arrived. */
export interface Prompter {
  interactive: boolean;
  ask(question: string): Promise<{ text: string; afterMs: number }>;
}

/** A line that arrives sooner than this after its prompt was typed ahead (piped, scripted): it never counts as an answer. */
export const MIN_HUMAN_MS = 400;
const WORDS = ["harbor", "maple", "orbit", "lantern", "meadow", "cobalt", "willow", "summit", "pebble", "falcon", "canyon", "ember", "glacier", "juniper", "quartz", "tundra"];

/**
 * The consent question (AIP-C1): an explicit "yes", then a confirmation word chosen at random and shown only now, typed
 * back exactly. Both lines must arrive after their prompt was shown (no typeahead). No terminal means no answer, which is NO.
 * Limit (documented in docs/guidelines.md): a program that drives a pseudo-terminal, reads the screen and types the word
 * can still answer; the server-side consent record, visible and changeable in the web app, is the backstop.
 */
export async function askConsentWith(p: Prompter, word = `${WORDS[randomInt(WORDS.length)]}${randomInt(10, 100)}`): Promise<boolean> {
  if (!p.interactive) return false;
  const a = await p.ask(`${CONSENT_QUESTION} (type yes or no; no is the default): `);
  if (a.afterMs < MIN_HUMAN_MS || !/^\s*yes\s*$/i.test(a.text)) return false;
  const b = await p.ask(`To confirm, type the word ${word}: `);
  return b.afterMs >= MIN_HUMAN_MS && b.text.trim() === word;
}

/** A real interactive terminal: stdin and stdout are TTYs and stdin can switch to raw mode (a pipe cannot). */
export function ttyPrompter(): Prompter {
  const stdin = process.stdin as NodeJS.ReadStream;
  return {
    interactive: stdin.isTTY === true && process.stdout.isTTY === true && typeof stdin.setRawMode === "function",
    ask: (q) =>
      new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const shown = Date.now();
        rl.question(q, (text) => {
          rl.close();
          resolve({ text, afterMs: Date.now() - shown });
        });
      }),
  };
}

export const terminalIo: Io = { askConsent: () => askConsentWith(ttyPrompter()) };

const FLAGS = new Set(["--here", "--reset"]);

export function parseArgs(argv: string[]): { cmd: CommandName; here: boolean; reset: boolean } | { error: string } {
  const [name, ...rest] = argv;
  if (!name || !(COMMANDS as readonly string[]).includes(name)) return { error: `Usage: onepeek-worklog <${COMMANDS.join("|")}> [--here] [--reset]` };
  for (const f of rest) if (!FLAGS.has(f)) return { error: `Unknown argument. This tool takes no content.` };
  return { cmd: name as CommandName, here: rest.includes("--here"), reset: rest.includes("--reset") };
}

export async function runCommand(ctx: Ctx, argv: string[], out: Out, cwd: string, io: Io = terminalIo): Promise<number> {
  const a = parseArgs(argv);
  if ("error" in a) {
    out.line(a.error);
    return 2;
  }
  switch (a.cmd) {
    case "connect":
      return (await connect(ctx, out, { summaries: await io.askConsent(), reset: a.reset })) ? 0 : 1;
    case "status":
      status(ctx, out);
      return 0;
    case "pause":
      setMode(ctx, out, "paused", a.here ? cwd : undefined);
      return 0;
    case "resume":
    case "on":
      setMode(ctx, out, "on", a.here ? cwd : undefined);
      return 0;
    case "off":
      setMode(ctx, out, "off", a.here ? cwd : undefined);
      return 0;
    case "preview":
      preview(ctx, out);
      return 0;
    case "discard":
      await discard(ctx, out);
      return 0;
    case "verify":
      return verify(ctx, out) ? 0 : 1;
    case "uninstall":
      await uninstall(ctx, out);
      return 0;
  }
}

async function main(): Promise<void> {
  const ctx = await openCtx();
  process.exitCode = await runCommand(ctx, process.argv.slice(2), { line: (s) => process.stdout.write(s + "\n") }, process.cwd());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => {
    if (e instanceof KeyStoreUnavailable) process.stdout.write(`The OS key store is unavailable (${e.store}). Nothing was changed and no new key was made: unlock the key store and run the command again.\n`);
    else process.stdout.write("Something went wrong. Nothing was changed.\n");
    process.exitCode = 1;
  });
}

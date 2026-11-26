// `onepeek-worklog <command>`: the ten commands of AIP-B2 and nothing else. Argument parsing is deliberately tiny: a command
// name plus the flags `--here` and `--reset`. Anything else is refused, so no content can be typed in. The one question the
// plug-in asks (share summaries?) is asked by the helper itself on a real terminal: never from an argument, never via the model.
import { fileURLToPath } from "node:url";
import { COMMANDS, connect, discard, preview, setMode, status, uninstall, verify, type CommandName, type Out } from "./commands.js";
import { createInterface } from "node:readline";
import { CONSENT_QUESTION } from "../send/contract.js";
import { openCtx, type Ctx } from "./ctx.js";

export interface Io {
  /** Ask the person the consent question. Resolves true only for an explicit yes typed at a real terminal. */
  askConsent: () => Promise<boolean>;
}

/** The default: a TTY prompt with the exact LLD wording. No terminal (a tool call, a pipe, CI) means no answer, which is NO. */
export const terminalIo: Io = {
  askConsent: async () => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => rl.question(`${CONSENT_QUESTION} (yes/no, no is the default): `, resolve));
    rl.close();
    return /^\s*(yes|y)\s*$/i.test(answer);
  },
};

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
  main().catch(() => {
    process.stdout.write("Something went wrong. Nothing was changed.\n");
    process.exitCode = 1;
  });
}

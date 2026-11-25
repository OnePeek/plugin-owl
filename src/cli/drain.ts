// The background drain, started detached by the hook on SessionStart, PreCompact and SessionEnd. It takes no arguments and
// reads no input: it processes whatever the queue and the spool already hold (AIP-B1, AIP-H2.8). Silent on any failure.
import { fileURLToPath } from "node:url";
import { openCtx } from "./ctx.js";
import { drain } from "./engine.js";

async function main(): Promise<void> {
  if (process.env["ONEPEEK_WORKLOG_INTERNAL"] === "1") return;
  await drain(await openCtx());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(() => undefined);
}

// One real background helper process for the parallel tests: open the device state, ingest, then send at a later clock.
// argv: <worklog root> <claude config dir> <api base> <ingest time ms> <send time ms>
import { fileURLToPath } from "node:url";
import { openCtx } from "../../src/cli/ctx.js";
import { ingest, send } from "../../src/cli/engine.js";
import { pathsFor } from "../../src/paths.js";
import { NO_OS_STORE } from "./env.js";

export const GOOD_SUMMARY = JSON.stringify({ summary: "Found a race between cache invalidation and refill that served stale prices after bulk updates, and fixed it by versioning cache entries.", task_type: "bugfix", decisions: ["Chose versioned cache entries over a global lock because writes are rare and a lock blocked the nightly job."], skills: ["TypeScript", "cache invalidation"] });

async function main(): Promise<void> {
  const [root, cfg, base, ingestAt, sendAt] = process.argv.slice(2) as [string, string, string, string, string];
  const clock = { now: Number(ingestAt) };
  const ctx = await openCtx({ paths: pathsFor(root), now: () => clock.now, claudeConfigDir: cfg, info: { env: "prod", apiBase: base, pluginVersion: "0.1.0" }, summariser: async () => GOOD_SUMMARY, ...NO_OS_STORE });
  await ingest(ctx);
  clock.now = Number(sendAt);
  process.stdout.write(JSON.stringify({ send: await send(ctx) }) + "\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();

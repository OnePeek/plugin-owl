// The fixed summary prompt (rule AIP-B3). It lives in prompt/summary.v1.txt, ships inside the plug-in build, its sha256
// goes in every record, and the server rejects unknown hashes. Changing one character changes the hash, so a change is
// a release (a test pins the digest).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const TASK_TYPES = ["bugfix", "feature", "refactor", "tests", "infra", "debugging", "review", "docs", "data", "migration"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

const FILE = readFileSync(new URL("../../../prompt/summary.v1.txt", import.meta.url), "utf8");
const [SYS, WRAP] = FILE.split("\n=====WRAPPER=====\n") as [string, string];

export const SYSTEM_PROMPT: string = SYS;
/** The wrapper around the session text; `{{MARK}}` is a fresh random marker per run. */
export const WRAPPER: string = WRAP.replace(/\n$/, "");

export function promptSha256(): string {
  return createHash("sha256").update(FILE).digest("hex");
}

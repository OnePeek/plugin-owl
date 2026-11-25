import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Paths } from "../paths.js";

/** AIP-C1: DO_NOT_TRACK=1, ONEPEEK_WORKLOG=off, or the file flag ~/.onepeek/worklog/off turn everything off. */
export function isOff(paths: Paths, env: NodeJS.ProcessEnv = process.env): boolean {
  return env["DO_NOT_TRACK"] === "1" || env["ONEPEEK_WORKLOG"] === "off" || existsSync(join(paths.root, "off"));
}

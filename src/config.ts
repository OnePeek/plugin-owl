import { readFileSync } from "node:fs";

/** Built in at release (rule: one destination host, published). `dist/build-info.json` is written by scripts/build.mjs. */
export interface BuildInfo {
  env: "local" | "preprod" | "prod";
  apiBase: string;
  pluginVersion: string;
}

const DEFAULT: BuildInfo = { env: "prod", apiBase: "https://api.onepeek.com", pluginVersion: "0.1.0" };

export function buildInfo(): BuildInfo {
  try {
    const j = JSON.parse(readFileSync(new URL("../build-info.json", import.meta.url), "utf8")) as Partial<BuildInfo>;
    return { env: j.env ?? DEFAULT.env, apiBase: j.apiBase ?? DEFAULT.apiBase, pluginVersion: j.pluginVersion ?? DEFAULT.pluginVersion };
  } catch {
    return DEFAULT;
  }
}

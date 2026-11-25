import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { remoteNames } from "../usage/git.js";
import { readJson } from "../state/store.js";
import type { Names } from "./filter.js";

// Words that name a folder in almost every project; replacing them would only damage the text.
const GENERIC = new Set(["src", "source", "lib", "libs", "app", "apps", "test", "tests", "docs", "doc", "build", "dist", "bin", "scripts", "config", "configs", "public", "static", "assets", "node_modules", "vendor", "web", "api", "server", "client", "backend", "frontend", "packages", "package", "main", "core", "utils", "tools", "infra", "data", "examples", "example", "hooks", "skills", "types", "models", "services", "components", "pages", "tmp", "temp", "work", "code", "project", "repo", "home", "users", "user"]);

function usable(n: string): boolean {
  return n.length >= 4 && !GENERIC.has(n.toLowerCase()) && /^[A-Za-z0-9._-]+$/.test(n);
}

/** Names that identify the person's project or employer, learned locally and never sent (rule E2). */
export async function learnNames(cwd: string, blocklist: string[]): Promise<Names> {
  const found = new Set<string>();
  if (cwd !== "") {
    for (const n of await remoteNames(cwd)) found.add(n);
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as { name?: unknown };
      if (typeof pkg.name === "string") for (const part of pkg.name.replace(/^@/, "").split("/")) found.add(part);
    } catch {
      // no package.json
    }
    try {
      for (const e of readdirSync(cwd, { withFileTypes: true })) if (e.isDirectory() && !e.name.startsWith(".")) found.add(e.name);
    } catch {
      // unreadable folder
    }
    found.add(cwd.split(/[\\/]/).filter(Boolean).pop() ?? "");
  }
  return { learned: [...found].filter(usable), blocklist: blocklist.filter((b) => b.trim().length >= 2) };
}

export function readBlocklist(file: string): string[] {
  const v = readJson<unknown>(file, []);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

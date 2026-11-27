// Build: tsc to dist/, then write dist/build-info.json (the destination host and env are built in at release; LLD §13).
// `--env preprod|local|prod` picks the target; the default is prod. `--env local` takes its API base from ONEPEEK_LOCAL_API_BASE (default http://localhost:20080). The build is deterministic: no timestamps.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const envIdx = args.indexOf("--env");
const env = envIdx >= 0 ? args[envIdx + 1] : "prod";
const hosts = { prod: "https://api.onepeek.com", preprod: "https://api.preprod.onepeek.com", local: process.env.ONEPEEK_LOCAL_API_BASE || "http://localhost:20080" }; // `--env local` reads ONEPEEK_LOCAL_API_BASE (default http://localhost:20080)
if (!hosts[env]) throw new Error(`unknown env ${env}`);

execFileSync(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", join(root, "tsconfig.json")], { cwd: root, stdio: args.includes("--quiet") ? "ignore" : "inherit" });
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist", "build-info.json"), JSON.stringify({ env, apiBase: hosts[env], pluginVersion: pkg.version }) + "\n");

// Repo lint (no third-party linter): the rules the LLD turns into CI checks.
//  - AIP-H1: only src/send/ may use a network API (fetch, http, https, net, dns, tls, dgram, http2).
//  - WRK 38 no-evasion: nothing reads managed settings, MDM, firewall or proxy configuration, and no fallback host exists.
//  - AIP-A1: no scoring, level or pattern vocabulary in src/.
//  - C1/LLD §13: process.env is read only for the documented names.
//  - No eval, no dynamic Function.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));

const ENV_OK = new Set(["ONEPEEK_WORKLOG_INTERNAL", "ONEPEEK_WORKLOG", "DO_NOT_TRACK", "PATH", "HOME", "USERPROFILE", "CLAUDE_CONFIG_DIR", "LANG", "LC_ALL", "TMPDIR", "TEMP", "SYSTEMROOT", "DBUS_SESSION_BUS_ADDRESS", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "AWS_PROFILE", "AWS_REGION"]);
const NET = /\bfetch\s*\(|\bfrom\s+["']node:(?:http|https|net|dns|tls|dgram|http2)["']|\brequire\(["'](?:http|https|net|dns)["']\)|\bXMLHttpRequest\b|\bWebSocket\b/;
const EVASION = /managed-settings|managed_settings|Application Support\/ClaudeCode|ProgramData[\\/]+ClaudeCode|\/etc\/claude-code|HTTPS?_PROXY|ALL_PROXY|NO_PROXY|\bscutil\b|\bnetworksetup\b|\bnetsh\b|\bpfctl\b|\bmdmclient\b|\bprofiles\s+show\b/i;
const SCORING = /(?<![-\w])(?:scor(?:e|es|ed|ing)|levels?|proficiency|rank(?:ing)?|github[_ -]?confirm\w*)(?![-\w])/i;

const problems = [];
for (const f of files(join(root, "src"))) {
  const rel = relative(root, f);
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    if (!rel.startsWith("src/send/") && NET.test(line)) problems.push(`${at} network API outside src/send/ (AIP-H1)`);
    if (EVASION.test(line)) problems.push(`${at} reads or names managed settings, MDM, firewall or proxy configuration (WRK 38)`);
    if (SCORING.test(line)) problems.push(`${at} scoring vocabulary (AIP-A1)`);
    if (/\beval\s*\(|new Function\s*\(/.test(line)) problems.push(`${at} dynamic code`);
    for (const m of line.matchAll(/process\.env\[\s*["']([A-Z0-9_]+)["']\s*\]|env\[\s*["']([A-Z0-9_]+)["']\s*\]/g)) {
      const name = m[1] ?? m[2];
      if (!ENV_OK.has(name)) problems.push(`${at} reads undocumented environment variable ${name}`);
    }
  });
}
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("lint ok");

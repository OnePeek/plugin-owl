// Repo lint (no third-party linter): the rules the LLD turns into CI checks.
//  - AIP-H1: only src/send/ may use a network API (fetch, http, https, net, dns, tls, dgram, http2).
//  - WRK 38 no-evasion: nothing reads managed settings, MDM, firewall or proxy configuration, and no fallback host exists.
//  - AIP-A1: no scoring, level or pattern vocabulary in src/.
//  - C1/LLD §13: process.env is read only for the documented names.
//  - No eval, no dynamic Function.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));

const ENV_OK = new Set(["ONEPEEK_WORKLOG_INTERNAL", "ONEPEEK_WORKLOG", "DO_NOT_TRACK", "PATH", "HOME", "USERPROFILE", "CLAUDE_CONFIG_DIR", "LANG", "LC_ALL", "TMPDIR", "TEMP", "SYSTEMROOT", "DBUS_SESSION_BUS_ADDRESS", "USER", "LOGNAME", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "AWS_PROFILE", "AWS_REGION", "TMP", "APPDATA", "LOCALAPPDATA", "XDG_RUNTIME_DIR", "ANTHROPIC_VERTEX_PROJECT_ID", "CLOUD_ML_REGION", "GOOGLE_APPLICATION_CREDENTIALS", ...["ACCESS_KEY_ID", "SECRET_ACCESS_KEY", "SESSION_TOKEN", "BEARER_TOKEN_BEDROCK"].map((s) => `AWS_${s}`)]);
const NET_MOD = String.raw`(?:node:)?(?:http|https|net|dns|tls|dgram|http2|undici|inspector)(?:\/[a-z]+)?`;
const NET = new RegExp(
  [
    String.raw`\bfetch\s*\(`,
    String.raw`\bfrom\s+["']${NET_MOD}["']`, // with or without the node: prefix
    String.raw`\bimport\s+["']${NET_MOD}["']`,
    String.raw`\brequire\s*\(\s*["']${NET_MOD}["']\s*\)`,
    String.raw`\bimport\s*\(\s*["']${NET_MOD}["']\s*\)`,
    String.raw`\bXMLHttpRequest\b`,
    String.raw`\bWebSocket\b`,
    String.raw`\bEventSource\b`,
    String.raw`\bnavigator\s*\.\s*sendBeacon\b`,
  ].join("|"),
);
// Ways around NET: computed global access, a dynamic import of a computed name, createRequire, and network programs.
const NET_BYPASS = /\bglobalThis\s*\[|\bglobal\s*\[|\bglobalThis\s*\.\s*fetch\b|Reflect\s*\.\s*get\s*\(\s*global|\bimport\s*\(\s*[^"'\s)]|\bcreateRequire\b|\bprocess\s*\.\s*binding\b|["'`](?:curl|wget|nc|ncat|socat|telnet|ssh|scp|sftp|rsync|ftp|tftp|Invoke-WebRequest|Invoke-RestMethod|iwr|irm|bitsadmin|certutil|Start-BitsTransfer)["'`\s]|Net\.WebClient|System\.Net\./;
// A bare `process.env` (the whole environment, so names cannot be checked) is allowed only where the names are listed.
const ENV_BARE_OK = new Set(["src/state/env.ts", "src/state/off.ts"]);
const EVASION = /managed-settings|managed_settings|Application Support\/ClaudeCode|ProgramData[\\/]+ClaudeCode|\/etc\/claude-code|HTTPS?_PROXY|ALL_PROXY|NO_PROXY|\bscutil\b|\bnetworksetup\b|\bnetsh\b|\bpfctl\b|\bmdmclient\b|\bprofiles\s+show\b/i;
const SCORING = /(?<![-A-Za-z0-9])(?:scor(?:e|es|ed|ing)|levels?|proficiency|rank(?:ing)?|github[_ -]?confirm\w*)(?![-A-Za-z0-9])/i;

const problems = [];
for (const f of files(join(root, "src"))) {
  const rel = relative(root, f);
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    if (!rel.startsWith("src/send/") && NET.test(line)) problems.push(`${at} network API outside src/send/ (AIP-H1)`);
    if (NET_BYPASS.test(line)) problems.push(`${at} network API outside src/send/ (AIP-H1): computed global, dynamic import, createRequire or a network program`);
    for (const m of line.matchAll(/process\s*\.\s*env\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/g)) if (!ENV_OK.has(m[1])) problems.push(`${at} reads undocumented environment variable ${m[1]}`);
    if (/process\s*\.\s*env\s*\[\s*(?!["'][A-Z0-9_]+["']\s*\])/.test(line)) problems.push(`${at} computed environment read (names must be literal)`);
    if (/process\s*\.\s*env(?!\s*[.[\w])/.test(line) && !ENV_BARE_OK.has(rel)) problems.push(`${at} whole environment read outside src/state/env.ts`);
    if (rel === "src/state/env.ts") for (const m of line.matchAll(/["']([A-Z][A-Z0-9_]{2,})["']/g)) if (!ENV_OK.has(m[1])) problems.push(`${at} passes undocumented environment variable ${m[1]}`);
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

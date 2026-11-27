import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { repoRoot } from "../helpers/paths.js";

const lint = (root: string) => spawnSync(process.execPath, [join(repoRoot(), "scripts", "lint.mjs"), root], { encoding: "utf8", timeout: 60_000 });

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "owl-lint-"));
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(join(root, f, ".."), { recursive: true });
    writeFileSync(join(root, f), body);
  }
  return root;
}

test("the repo itself passes lint", () => {
  const r = lint(repoRoot());
  assert.equal(r.status, 0, r.stderr);
});

test("test_only_send_imports_network", () => {
  assert.equal(lint(fixture({ "src/send/a.ts": "export const x = fetch('https://a.test');\n" })).status, 0);
  for (const body of ["export const x = fetch('https://a.test');", "import { request } from \"node:https\";", "import net from \"node:net\";", "import dns from \"node:dns\";"]) {
    const r = lint(fixture({ "src/clean/a.ts": body + "\n" }));
    assert.equal(r.status, 1, body);
    assert.match(r.stderr, /network API outside src\/send/);
  }
});

test("no-evasion check (WRK 38): managed settings, MDM, firewall and proxy are never read", () => {
  for (const body of ["const p = '/Library/Application Support/ClaudeCode/managed-settings.json';", "const x = process.env['HTTPS_PROXY'];", "exec('scutil --proxy');", "exec('netsh winhttp show proxy');"]) {
    const r = lint(fixture({ "src/cli/a.ts": body + "\n" }));
    assert.equal(r.status, 1, body);
  }
});

test("test_record_schema_has_no_scoring_fields: scoring vocabulary is refused in src", () => {
  assert.equal(lint(fixture({ "src/record/a.ts": "const skill_score = 1;\n" })).status, 1);
  assert.equal(lint(fixture({ "src/record/a.ts": "const level = 1;\n" })).status, 1);
  assert.equal(lint(fixture({ "src/record/a.ts": "// top-level folder\n" })).status, 0);
});

test("undocumented environment variables are refused", () => {
  assert.equal(lint(fixture({ "src/cli/a.ts": "const x = process.env['SECRET_THING'];\n" })).status, 1);
  assert.equal(lint(fixture({ "src/cli/a.ts": "const x = process.env['DO_NOT_TRACK'];\n" })).status, 0);
});

test("network lint cannot be bypassed: bare module names, dynamic import, computed globals, network programs, env dot access", () => {
  const bypasses = [
    'import { request } from "https";',
    'import * as n from "net";',
    'const m = await import("node:net");',
    'const name = "node:" + "http"; const m = await import(name);',
    'const f = globalThis["fet" + "ch"];',
    "const f = globalThis.fetch;",
    'import { createRequire } from "node:module"; const r = createRequire(import.meta.url);',
    'spawn("curl", ["-d", "x", "https://a.test"]);',
    'execFile("powershell.exe", ["Invoke-WebRequest https://a.test"]);',
    "const x = process.env.SECRET_THING;",
    "const k = 'SECRET'; const x = process.env[k];",
    "const all = process.env;",
  ];
  for (const body of bypasses) {
    const r = lint(fixture({ "src/clean/a.ts": body + "\n" }));
    assert.equal(r.status, 1, body);
  }
  assert.equal(lint(fixture({ "src/clean/a.ts": "const x = process.env.DO_NOT_TRACK;\n" })).status, 0);
  assert.equal(lint(fixture({ "src/clean/a.ts": 'type J = import("node:crypto").JsonWebKey;\n' })).status, 0);
});

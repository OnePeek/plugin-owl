// The ten commands of AIP-B2. None takes insight text or numbers. The only values a command reads from the person are a
// scope flag (`--here`, meaning "this project"); the consent answer is typed by the person at a terminal, see cli.ts.
import { rmSync } from "node:fs";
import { authorizeUrl, newPkce, randomPort } from "../auth/pkce.js";
import { firstBadSeq } from "../sign/chain.js";
import { createInstallSigner, thumbprint, type Signer } from "../sign/keys.js";
import { Api } from "../send/http.js";
import { CLIENT_ID, CONSENT_QUESTION, CONSENT_VERSION, PATHS, SCOPE } from "../send/contract.js";
import { openBrowser, waitForCallback } from "../send/loopback.js";
import { projectKey, readState, writeState, type Mode } from "../state/store.js";
import { isOff } from "../state/off.js";
import { accessToken } from "./engine.js";
import { withLock } from "./lock.js";
import type { Ctx } from "./ctx.js";
import { fileStore } from "../keystore/os.js";
import { platform as osPlatform } from "node:os";

/** A generic label from the OS and the tool only; the machine host name is never sent (rule E1). */
export function deviceLabel(os: string = osPlatform()): string {
  return `${os === "darwin" ? "macOS" : os === "win32" ? "Windows" : "Linux"} - Claude Code`;
}

export const COMMANDS = ["connect", "status", "pause", "resume", "off", "on", "preview", "discard", "verify", "uninstall"] as const;
export type CommandName = (typeof COMMANDS)[number];

export interface Out {
  line(s: string): void;
}

const EMPLOYER = "Your employer may not allow this. Check first.";

export async function connect(ctx: Ctx, out: Out, o: { summaries: boolean; reset?: boolean; openUrl?: (u: string) => void; port?: number; timeoutMs?: number }): Promise<boolean> {
  if (ctx.vault().install && !o.reset) {
    out.line("This device is already connected. To replace its install (lost key or reinstall), run connect with --reset.");
    return false;
  }
  out.line(EMPLOYER);
  out.line(o.summaries ? `You answered yes to: ${CONSENT_QUESTION} Short cleaned summaries may be sent after a 10 minute hold.` : `Summaries are off (no yes was given at a terminal). Only usage numbers will be sent. To turn summaries on, run this connect command in your own terminal and answer yes.`);
  const prior = ctx.vault().install?.install_id;
  const { signer, software } = await createInstallSigner();
  const pkce = newPkce();
  const port = o.port ?? randomPort();
  const url = authorizeUrl(ctx.info.apiBase, PATHS.authorize, { clientId: CLIENT_ID, scope: SCOPE, port, pkce, jkt: thumbprint(signer.publicJwk) });
  const waiting = waitForCallback(port, pkce.state, o.timeoutMs);
  (o.openUrl ?? openBrowser)(url);
  out.line("Opening your browser to sign in to OnePeek...");
  const cb = await waiting;
  if (!cb.code) {
    out.line("Sign-in did not finish. Nothing was connected.");
    return false;
  }
  const api = new Api(ctx.info.apiBase, signer, ctx.fetchImpl);
  const tok = await api.call("POST", PATHS.token, { form: { grant_type: "authorization_code", code: cb.code, code_verifier: pkce.verifier, redirect_uri: `http://127.0.0.1:${port}/callback`, client_id: CLIENT_ID } });
  const tb = tok.body as { access_token?: string; refresh_token?: string; account_email?: string; expires_in?: number } | undefined;
  if (tok.status !== 200 || !tb?.access_token || !tb.refresh_token) {
    out.line("Sign-in was refused. Nothing was connected.");
    return false;
  }
  out.line(`Signed in as ${tb.account_email ?? "your OnePeek account"}. Registering this device...`);
  const body = {
    public_key: signer.publicJwk,
    key_alg: signer.alg,
    key_store: signer.keyStore,
    tool: "claude_code",
    tool_version: "unknown",
    os: osPlatform() === "darwin" ? "macos" : osPlatform() === "win32" ? "windows" : "linux",
    plugin_version: ctx.info.pluginVersion,
    plugin_build_sha256: ctx.buildSha256(),
    device_name: deviceLabel(),
    consent_text: o.summaries,
    consent_version: CONSENT_VERSION,
    ...(o.reset && prior ? { replaces_install_id: prior } : {}),
  };
  const reg = await api.call("POST", PATHS.installs, { token: tb.access_token, json: body });
  const rb = reg.body as { install_id?: string; key_expires_at?: string; env?: string; genesis_prev_hash?: string; limits?: { hold_seconds: number; max_record_age_days: number; max_records_per_request: number; max_body_bytes: number } } | undefined;
  if (reg.status !== 201 || !rb?.install_id || !rb.limits || !rb.key_expires_at) {
    out.line(`Registration was refused (${reg.reason ?? `http ${reg.status}`}). Nothing was connected.`);
    return false;
  }
  if (!software) throw new Error("hardware keys need the platform helper");
  const ok = { install_id: rb.install_id, key_expires_at: rb.key_expires_at, limits: rb.limits };
  const saved = await withLock(ctx.paths.lockFile, () => {
    ctx.saveVault({
    install: { install_id: ok.install_id, alg: software.alg, private_pem: software.privatePem, key_store: signer.keyStore, key_expires_at: ok.key_expires_at, env: rb.env ?? "prod", genesis_prev_hash: rb.genesis_prev_hash ?? "0".repeat(64), limits: ok.limits },
    refresh_token: tb.refresh_token,
    access_token: tb.access_token,
    access_expires_at: ctx.now() + (typeof tb.expires_in === "number" && tb.expires_in > 0 ? tb.expires_in * 1000 : 600_000),
    ...(api.nonce ? { dpop_nonce: api.nonce } : {}),
    ...(tb.account_email ? { account_email: tb.account_email } : {}),
    });
    ctx.saveConsent({ summaries: o.summaries, version: CONSENT_VERSION, at: new Date(ctx.now()).toISOString() });
    ctx.saveControls({ summaries_consent: o.summaries });
  }, 60_000);
  if (!saved.ok) {
    out.line("The helper is busy; nothing was saved. Run connect again in a moment.");
    return false;
  }
  out.line(`Connected. Logging is on; session numbers are sent after a ${Math.round(rb.limits.hold_seconds / 60)} minute hold. Pause with /onepeek-pause.`);
  return true;
}

export function status(ctx: Ctx, out: Out): void {
  const v = ctx.vault();
  const c = ctx.controls();
  const st = readState(ctx.paths.stateFile);
  const items = ctx.spool.items();
  const count = (s: string): number => items.filter((i) => i.state === s).length;
  out.line(v.install ? `Connected as ${v.account_email ?? "your account"}; install ${v.install.install_id}.` : "Not connected: run /onepeek-connect.");
  out.line(`Capture: ${isOff(ctx.paths) ? "off (environment or flag file)" : st.global}${Object.keys(st.projects).length ? `, ${Object.keys(st.projects).length} project override(s)` : ""}.`);
  out.line(`Summaries: ${ctx.consent()?.summaries ? "yes (you agreed)" : "no (numbers only)"}.`);
  if (v.install) out.line(`Key: ${v.install.alg}, ${v.install.key_store}${ctx.keyStoreName === "user-file" ? ", secrets in a user-only file (no OS key store found)" : ""}, expires ${v.install.key_expires_at}.`);
  out.line(`Pending ${count("pending")}, sent ${count("sent")}, held ${count("held")}${items.some((i) => i.state === "held") ? ` (${[...new Set(items.filter((i) => i.state === "held").map((i) => i.reason))].join(", ")})` : ""}, aged out ${count("dropped")}.`);
  if (c.server_state === "paused") out.line("Paused from the web app: nothing is sent until you resume there.");
  if (c.blocked === "revoked") out.line("This device was revoked. Nothing is sent. Run /onepeek-connect to connect again.");
  else if (c.blocked === "expired") out.line("This device's key expired. Run /onepeek-connect to connect again.");
  else if (c.blocked === "reconnect") out.line("Sign-in expired. Run /onepeek-connect to reconnect.");
  else if (c.blocked === "needs_reset") out.line("The server and this device disagree about the record chain. Run connect with --reset.");
  else if (c.blocked === "scope") out.line("Unexpected token scope. Nothing is sent; please update the plug-in.");
  else if (c.blocked === "bug") out.line(`The server refused the request format (${c.last_error ?? "error"}). Nothing is sent; please update the plug-in.`);
  if (c.last_error && !c.blocked) out.line(`Last problem: ${c.last_error} (will retry).`);
  if (c.build_status && c.build_status !== "ok" && c.build_status !== "active") out.line(`Plug-in version notice: ${c.build_status}.`);
}

export function setMode(ctx: Ctx, out: Out, mode: Mode, cwd: string | undefined): void {
  const st = readState(ctx.paths.stateFile);
  if (cwd !== undefined) {
    if (mode === "on") delete st.projects[projectKey(cwd)];
    else st.projects[projectKey(cwd)] = mode;
  } else {
    st.global = mode;
  }
  writeState(ctx.paths.stateFile, st);
  out.line(`${cwd !== undefined ? "This project" : "Capture"} is now ${mode}.`);
}

export function preview(ctx: Ctx, out: Out): void {
  const pending = ctx.spool.items().filter((i) => i.state === "pending" || i.state === "discard" || i.state === "held" || (i.state === "signed" && !i.receipt));
  if (pending.length === 0) out.line("Nothing is waiting to be sent.");
  for (const it of pending) {
    const d = it.draft;
    const wait = Math.max(0, Math.ceil((it.eligibleAt - ctx.now()) / 60_000));
    out.line(`- ${it.state === "discard" ? "discarded (a content-free entry will be sent)" : it.state === "held" ? `held (${it.reason ?? "cleaner_hit"}): only a content-free entry will be sent` : it.state === "signed" ? "being sent (retrying after a network error)" : wait > 0 ? `sends in ${wait} min` : "sends at the next send"}`);
    if (d && it.state !== "discard" && it.state !== "held") {
      out.line(`  numbers: ${d.usage.active_seconds}s active, ${d.usage.prompt_count} prompts, ${d.usage.turn_count} turns, +${d.usage.ai_lines_added}/-${d.usage.ai_lines_removed} lines, ${d.commits.length} commits`);
      if (d.insight) {
        out.line(`  summary: ${d.insight.summary}`);
        out.line(`  type: ${d.insight.task_type}; skills: ${d.insight.skills.join(", ")}`);
        for (const x of d.insight.decisions) out.line(`  decision: ${x}`);
      } else out.line("  no summary text");
    }
  }
}

/**
 * DISCARD (AIP-B5, D12): every unsent draft becomes a content-free `discarded` chain entry: drafts in the hold window,
 * drafts held back while capture is paused or off, and drafts the cleaner held. Drafts are unsigned until the real send,
 * so nothing that is waiting can escape a discard.
 */
export async function discard(ctx: Ctx, out: Out): Promise<number> {
  const r = await withLock(ctx.paths.lockFile, () => {
    let n = 0;
    for (const it of ctx.spool.items()) if (it.draft && (it.state === "pending" || it.state === "held")) {
      ctx.spool.append({ t: "discard", id: it.id, at: ctx.now() });
      n++;
    }
    return n;
  }, 10_000);
  if (!r.ok) {
    out.line("The helper is busy; try again in a moment.");
    return 0;
  }
  out.line(r.value === 0 ? "Nothing pending to discard." : `Discarded ${r.value} pending record(s). Only a content-free entry will be sent, so the gap stays visible.`);
  return r.value;
}

export function verify(ctx: Ctx, out: Out): boolean {
  const v = ctx.vault();
  const signer: Signer | undefined = ctx.signer();
  if (!v.install || !signer) {
    out.line("Not connected: nothing to verify.");
    return true;
  }
  const { firstBadLine } = ctx.spool.events();
  if (firstBadLine !== undefined) {
    out.line(`Spool entry ${firstBadLine + 1} failed to open: the file was edited, removed or reordered.`);
    return false;
  }
  const chain = ctx.spool.chain(v.install.install_id);
  const bad = firstBadSeq(chain, signer.publicJwk);
  if (bad !== undefined) {
    out.line(`The chain breaks at seq ${bad}.`);
    return false;
  }
  out.line(`Chain verified: ${chain.length} record(s), unbroken.`);
  return true;
}

export async function uninstall(ctx: Ctx, out: Out): Promise<void> {
  const v = ctx.vault();
  const signer = ctx.signer();
  if (signer && v.refresh_token) {
    const api = new Api(ctx.info.apiBase, signer, ctx.fetchImpl);
    await api.call("POST", PATHS.revoke, { form: { token: v.refresh_token, token_type_hint: "refresh_token", client_id: CLIENT_ID } }).catch(() => undefined);
  }
  for (const f of [ctx.paths.vaultFile, ctx.paths.spoolFile, ctx.paths.controlsFile, ctx.paths.consentFile, ctx.paths.stateFile, ctx.paths.keyStoreFile]) rmSync(f, { force: true });
  for (const d of [ctx.paths.queueDir, ctx.paths.policyDir]) rmSync(d, { recursive: true, force: true });
  await ctx.masterStore.remove();
  await fileStore(ctx.paths.root).remove();
  out.line("Uninstalled: the spool, keys and tokens on this device are deleted. Revoke the device in the web app too.");
}

export { accessToken };

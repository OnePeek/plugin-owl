import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { buildInfo, type BuildInfo } from "../config.js";
import { openMasterKey, type MasterKeyStore } from "../keystore/os.js";
import { readVault, writeVault, type Vault } from "../keystore/vault.js";
import { defaultPaths, type Paths } from "../paths.js";
import { generateSoftwareKey, softwareSigner, type Signer } from "../sign/keys.js";
import { Spool } from "../spool/index.js";
import { readJson, writeJsonPrivate } from "../state/store.js";
import type { FetchLike } from "../send/http.js";
import { realSummariser, type Summariser } from "../summarise/run.js";

/** What the server last told the device to obey (apply `controls` of every reply), plus local send bookkeeping. */
export interface Controls {
  server_state?: "active" | "paused";
  summaries_consent?: boolean;
  build_status?: string;
  blocked?: "revoked" | "expired" | "reconnect" | "needs_reset" | "scope";
  blocked_until?: number;
  next_attempt_at?: number;
  failures?: number;
  last_send_at?: number;
  last_error?: string;
}
export interface Consent {
  summaries: boolean;
  version: string;
  at: string;
}

export interface Ctx {
  paths: Paths;
  master: Buffer;
  keyStoreName: string;
  masterStore: MasterKeyStore;
  spool: Spool;
  info: BuildInfo;
  now: () => number;
  fetchImpl?: FetchLike;
  summariser: Summariser;
  claudeConfigDir: string;
  /** Test seam: a signer built from the vault; the real one is derived from the stored key. */
  vault(): Vault;
  saveVault(v: Vault): void;
  signer(): Signer | undefined;
  controls(): Controls;
  saveControls(c: Controls): void;
  consent(): Consent | undefined;
  saveConsent(c: Consent): void;
  buildSha256(): string;
}

export async function openCtx(over: Partial<Pick<Ctx, "paths" | "now" | "fetchImpl" | "summariser" | "claudeConfigDir" | "info">> & { platform?: NodeJS.Platform } = {}): Promise<Ctx> {
  const paths = over.paths ?? defaultPaths();
  const { store, key } = await openMasterKey(paths.root, over.platform);
  let sha: string | undefined;
  const c: Ctx = {
    paths,
    master: key,
    keyStoreName: store.name,
    masterStore: store,
    spool: new Spool(paths.spoolFile, key),
    info: over.info ?? buildInfo(),
    now: over.now ?? Date.now,
    ...(over.fetchImpl ? { fetchImpl: over.fetchImpl } : {}),
    summariser: over.summariser ?? realSummariser(paths.workDir),
    claudeConfigDir: over.claudeConfigDir ?? (process.env["CLAUDE_CONFIG_DIR"] || join(process.env["HOME"] ?? "", ".claude")),
    vault: () => readVault(paths.vaultFile, key),
    saveVault: (v) => writeVault(paths.vaultFile, key, v),
    signer: () => {
      const i = readVault(paths.vaultFile, key).install;
      return i ? softwareSigner({ alg: i.alg, privatePem: i.private_pem }) : undefined;
    },
    controls: () => readJson<Controls>(paths.controlsFile, {}),
    saveControls: (v) => writeJsonPrivate(paths.controlsFile, v),
    consent: () => {
      const v = readJson<Partial<Consent>>(paths.consentFile, {});
      return typeof v.summaries === "boolean" ? { summaries: v.summaries, version: v.version ?? "", at: v.at ?? "" } : undefined;
    },
    saveConsent: (v) => writeJsonPrivate(paths.consentFile, v),
    buildSha256: () => (sha ??= computeBuildSha256()),
  };
  return c;
}

/** sha256 over the shipped files (sorted path + content hash), so the value a record carries is the hash of this very build (AIP-D6). */
export function computeBuildSha256(root = fileURLToPath(new URL("../..", import.meta.url))): string {
  const h = createHash("sha256");
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".js") ? [join(dir, e.name)] : []))
      .sort();
  try {
    for (const f of walk(join(root, "src"))) h.update(f.slice(root.length)).update("\0").update(createHash("sha256").update(readFileSync(f)).digest());
  } catch {
    // an unbuilt tree hashes to the empty digest; the server rejects it as an unknown build
  }
  return h.digest("hex");
}

export { generateSoftwareKey };

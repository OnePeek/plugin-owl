// The master key (32 random bytes) lives in the OS key store, reached through the platform's own command with argument
// lists only, the secret on stdin (LLD §5 "Key store", §7, AIP-D5). Everything else secret (install key, refresh token,
// spool) is encrypted under it.
//  - macOS: the login keychain through `security`.
//  - Linux: the Secret Service through `secret-tool` (the drain gets DBUS_SESSION_BUS_ADDRESS and XDG_RUNTIME_DIR, so a
//    background helper reaches the same keyring as the terminal). With no Secret Service at first use, a user-only file.
//  - Windows: DPAPI (CurrentUser scope) through PowerShell's ProtectedData; only the DPAPI blob is on disk. Never a plain file.
// FAIL CLOSED: a key is minted only on a device with no worklog state and no recorded store. A read that fails (or finds
// nothing) once a store was chosen, or once a vault or spool exists, throws KeyStoreUnavailable: a new key would make the
// vault and the spool unreadable for good.
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { KEYSTORE_ENV, pickEnv } from "../state/env.js";
import { readJson, writeJsonPrivate } from "../state/store.js";

export type KeyStoreName = "macos-keychain" | "secret-service" | "windows-dpapi" | "user-file";
export type ReadResult = { kind: "found"; key: Buffer } | { kind: "missing" } | { kind: "error" };
export interface MasterKeyStore {
  name: KeyStoreName;
  read(): Promise<ReadResult>;
  set(key: Buffer): Promise<boolean>;
  remove(): Promise<void>;
}

export class KeyStoreUnavailable extends Error {
  constructor(public store: string) {
    super("key store unavailable");
  }
}

export type Exec = (cmd: string, args: string[], stdin?: string) => Promise<{ ok: boolean; out: string; code?: number | string; err?: string }>;

export const realExec: Exec = (cmd, args, stdin) =>
  new Promise((resolve) => {
    const p = execFile(cmd, args, { timeout: 15_000, maxBuffer: 1 << 16, env: pickEnv(KEYSTORE_ENV), windowsHide: true }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: String(stdout), err: String(stderr), ...(err ? { code: (err as NodeJS.ErrnoException & { code?: number | string }).code ?? 1 } : {}) }),
    );
    p.stdin?.on("error", () => undefined);
    if (stdin !== undefined) p.stdin?.end(stdin);
  });

const SERVICE = "onepeek-worklog";
const ACCOUNT = "master-key";
const hex32 = (s: string): Buffer | undefined => (/^[0-9a-f]{64}$/.test(s.trim()) ? Buffer.from(s.trim(), "hex") : undefined);
const found = (b: Buffer | undefined): ReadResult => (b ? { kind: "found", key: b } : { kind: "error" });

function macos(exec: Exec): MasterKeyStore {
  return {
    name: "macos-keychain",
    read: async () => {
      const r = await exec("security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"]);
      if (r.ok) return found(hex32(r.out));
      return r.code === 44 ? { kind: "missing" } : { kind: "error" }; // 44 = errSecItemNotFound; anything else is a failure
    },
    // `security -i` reads its commands from stdin, so the secret is never in a process list (argv).
    set: async (k) => (await exec("security", ["-i"], `add-generic-password -s ${SERVICE} -a ${ACCOUNT} -w ${k.toString("hex")}\n`)).ok,
    remove: async () => void (await exec("security", ["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT])),
  };
}

function linux(exec: Exec): MasterKeyStore {
  const attrs = ["service", SERVICE, "account", ACCOUNT];
  return {
    name: "secret-service",
    read: async () => {
      const r = await exec("secret-tool", ["lookup", ...attrs]);
      if (r.ok && r.out.trim() !== "") return found(hex32(r.out));
      // `secret-tool lookup` exits 1 with no output when the item is absent; a bus or keyring failure prints an error
      return r.code === 1 && r.out.trim() === "" && (r.err ?? "").trim() === "" ? { kind: "missing" } : { kind: "error" };
    },
    set: async (k) => (await exec("secret-tool", ["store", "--label=OnePeek work log", ...attrs], k.toString("hex"))).ok, // secret on stdin
    remove: async () => void (await exec("secret-tool", ["clear", ...attrs])),
  };
}

const PS = ["-NoProfile", "-NonInteractive", "-Command"];
const PS_PROTECT =
  "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$h=[Console]::In.ReadToEnd().Trim();" +
  "$b=New-Object byte[] ($h.Length/2);for($i=0;$i -lt $b.Length;$i++){$b[$i]=[Convert]::ToByte($h.Substring(2*$i,2),16)};" +
  "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'))";
const PS_UNPROTECT =
  "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$p=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());" +
  "$u=[Security.Cryptography.ProtectedData]::Unprotect($p,$null,'CurrentUser');($u|ForEach-Object{$_.ToString('x2')})-join''";

/** Windows: the key is sealed by DPAPI for the signed-in user; the file holds only the DPAPI blob (no plain key on disk). */
export function windowsDpapi(root: string, exec: Exec): MasterKeyStore {
  const f = join(root, "master.dpapi");
  return {
    name: "windows-dpapi",
    read: async () => {
      if (!existsSync(f)) return { kind: "missing" };
      const r = await exec("powershell.exe", [...PS, PS_UNPROTECT], readFileSync(f, "utf8"));
      return r.ok ? found(hex32(r.out)) : { kind: "error" };
    },
    set: async (k) => {
      const r = await exec("powershell.exe", [...PS, PS_PROTECT], k.toString("hex"));
      const blob = r.out.trim();
      if (!r.ok || !/^[A-Za-z0-9+/=]{40,}$/.test(blob)) return false;
      mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
      writeFileSync(f, blob, { mode: 0o600 });
      return true;
    },
    remove: async () => void (existsSync(f) && writeFileSync(f, "")),
  };
}

/** macOS and Linux only, and only when no OS store answers at first use: a user-only file (status says so). */
export function fileStore(root: string): MasterKeyStore {
  const f = join(root, "master.key");
  return {
    name: "user-file",
    read: async () => {
      if (!existsSync(f)) return { kind: "missing" };
      const t = readFileSync(f, "utf8");
      return t === "" ? { kind: "missing" } : found(hex32(t));
    },
    set: async (k) => {
      mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
      writeFileSync(f, k.toString("hex"), { mode: 0o600 });
      chmodSync(f, 0o600);
      return true;
    },
    remove: async () => void (existsSync(f) && writeFileSync(f, "")),
  };
}

function osStore(root: string, platform: NodeJS.Platform, exec: Exec): MasterKeyStore | undefined {
  return platform === "darwin" ? macos(exec) : platform === "linux" ? linux(exec) : platform === "win32" ? windowsDpapi(root, exec) : undefined;
}

/** True when this device already holds worklog state that only the existing master key can open. */
function hasState(root: string): boolean {
  return existsSync(join(root, "vault.enc")) || existsSync(join(root, "spool", "spool.jsonl"));
}

/**
 * Open the master key. Order: the store recorded at first use (fail closed if it does not answer); else an existing key in
 * the OS store or (macOS, Linux) the user-only file; else, only on a device with no state, mint one in the OS store, or
 * (macOS, Linux) the user-only file when no OS store works. Windows never falls back to a plain file.
 */
export async function openMasterKey(root: string, platform: NodeJS.Platform = process.platform, exec: Exec = realExec): Promise<{ store: MasterKeyStore; key: Buffer }> {
  const recordFile = join(root, "keystore.json");
  const recorded = readJson<{ store?: KeyStoreName }>(recordFile, {}).store;
  const os = osStore(root, platform, exec);
  const file = platform === "win32" ? undefined : fileStore(root);
  const byName = [os, file].find((s) => s && s.name === recorded);
  if (recorded) {
    if (!byName) throw new KeyStoreUnavailable(recorded);
    const r = await byName.read();
    if (r.kind === "found") return { store: byName, key: r.key };
    throw new KeyStoreUnavailable(recorded); // never mint over a chosen store
  }
  const remember = (s: MasterKeyStore): void => writeJsonPrivate(recordFile, { store: s.name });
  let failed = false;
  for (const s of [os, file]) {
    if (!s) continue;
    const r = await s.read();
    if (r.kind === "found") {
      remember(s);
      return { store: s, key: r.key };
    }
    if (r.kind === "error") failed = true;
  }
  if (hasState(root)) throw new KeyStoreUnavailable(os?.name ?? "user-file"); // state exists but its key is gone or unreadable
  const fresh = randomBytes(32);
  if (os && !(failed && platform === "win32")) {
    if (await os.set(fresh)) {
      const back = await os.read();
      if (back.kind === "found" && back.key.equals(fresh)) {
        remember(os);
        return { store: os, key: fresh };
      }
    }
  }
  if (!file) throw new KeyStoreUnavailable(os?.name ?? "none");
  await file.set(fresh);
  remember(file);
  return { store: file, key: fresh };
}

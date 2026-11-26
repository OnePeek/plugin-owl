// The master key (32 random bytes) lives in the OS key store, reached through the platform's own command with argument
// lists only (LLD §5, "Key store"). Everything else secret (install key, refresh token, spool key) is encrypted under it.
// When no key store answers, a user-only file is used and the status says so (E12).
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export type KeyStoreName = "macos-keychain" | "secret-service" | "user-file";
export interface MasterKeyStore {
  name: KeyStoreName;
  get(): Promise<Buffer | undefined>;
  set(key: Buffer): Promise<boolean>;
  remove(): Promise<void>;
}

export type Exec = (cmd: string, args: string[], stdin?: string) => Promise<{ ok: boolean; out: string }>;

export const realExec: Exec = (cmd, args, stdin) =>
  new Promise((resolve) => {
    const p = execFile(cmd, args, { timeout: 15_000, maxBuffer: 1 << 16, env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "", DBUS_SESSION_BUS_ADDRESS: process.env["DBUS_SESSION_BUS_ADDRESS"] ?? "" } }, (err, stdout) => resolve({ ok: !err, out: String(stdout) }));
    if (stdin !== undefined) p.stdin?.end(stdin);
  });

const SERVICE = "onepeek-worklog";
const ACCOUNT = "master-key";
const hex32 = (s: string): Buffer | undefined => (/^[0-9a-f]{64}$/.test(s.trim()) ? Buffer.from(s.trim(), "hex") : undefined);

function macos(exec: Exec): MasterKeyStore {
  return {
    name: "macos-keychain",
    get: async () => {
      const r = await exec("security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"]);
      return r.ok ? hex32(r.out) : undefined;
    },
    // `security -i` reads its commands from stdin, so the secret is never in a process list (argv).
    set: async (k) => (await exec("security", ["-i"], `add-generic-password -U -s ${SERVICE} -a ${ACCOUNT} -w ${k.toString("hex")}\n`)).ok,
    remove: async () => void (await exec("security", ["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT])),
  };
}

function linux(exec: Exec): MasterKeyStore {
  const attrs = ["service", SERVICE, "account", ACCOUNT];
  return {
    name: "secret-service",
    get: async () => {
      const r = await exec("secret-tool", ["lookup", ...attrs]);
      return r.ok ? hex32(r.out) : undefined;
    },
    set: async (k) => (await exec("secret-tool", ["store", "--label=OnePeek work log", ...attrs], k.toString("hex"))).ok, // secret on stdin
    remove: async () => void (await exec("secret-tool", ["clear", ...attrs])),
  };
}

export function fileStore(root: string): MasterKeyStore {
  const f = join(root, "master.key");
  return {
    name: "user-file",
    get: async () => (existsSync(f) ? hex32(readFileSync(f, "utf8")) : undefined),
    set: async (k) => {
      mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
      writeFileSync(f, k.toString("hex"), { mode: 0o600 });
      chmodSync(f, 0o600);
      return true;
    },
    remove: async () => void (existsSync(f) && writeFileSync(f, "")),
  };
}

/** Pick the OS store when it works (a write and read-back of the key succeed), else the user-only file. */
export async function openMasterKey(root: string, platform: NodeJS.Platform = process.platform, exec: Exec = realExec): Promise<{ store: MasterKeyStore; key: Buffer }> {
  const os = platform === "darwin" ? macos(exec) : platform === "linux" ? linux(exec) : undefined;
  if (os) {
    const have = await os.get();
    if (have) return { store: os, key: have };
    const fresh = randomBytes(32);
    if ((await os.set(fresh)) && (await os.get())?.equals(fresh)) return { store: os, key: fresh };
  }
  const f = fileStore(root);
  const have = await f.get();
  if (have) return { store: f, key: have };
  const fresh = randomBytes(32);
  await f.set(fresh);
  return { store: f, key: fresh };
}

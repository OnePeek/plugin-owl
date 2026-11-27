import { homedir } from "node:os";
import { join } from "node:path";

/** Every local path the plug-in uses, under one user-only root (LLD §7). `root` is injectable for tests. */
export interface Paths {
  root: string;
  queueDir: string;
  spoolFile: string;
  stateFile: string;
  consentFile: string;
  controlsFile: string;
  vaultFile: string;
  policyDir: string;
  lockFile: string;
  workDir: string;
  /** Which master-key store this device chose at first use (never a secret). */
  keyStoreFile: string;
}

export function pathsFor(root: string): Paths {
  return {
    root,
    queueDir: join(root, "queue"),
    spoolFile: join(root, "spool", "spool.jsonl"),
    stateFile: join(root, "state.json"),
    consentFile: join(root, "consent.json"),
    controlsFile: join(root, "controls.json"),
    vaultFile: join(root, "vault.enc"),
    policyDir: join(root, "policy"),
    lockFile: join(root, "helper.lock"),
    workDir: join(root, "work"),
    keyStoreFile: join(root, "keystore.json"),
  };
}

export function defaultPaths(): Paths {
  return pathsFor(join(homedir(), ".onepeek", "worklog"));
}

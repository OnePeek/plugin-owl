// Secret-shaped strings are assembled at run time so this public repo never holds a literal that a secret scanner (ours
// or gitleaks) would flag. Each canary is unique per call so a leak can be traced to the exact planted value.
import { createHash, randomBytes } from "node:crypto";

const rnd = (n: number, alphabet: string): string => {
  let s = "";
  const b = randomBytes(n);
  for (let i = 0; i < n; i++) s += alphabet[(b[i] as number) % alphabet.length];
  return s;
};
const byte = (): number => randomBytes(1)[0] as number;
const UP = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const UPD = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const HEX = "0123456789abcdef";

export const canaries = {
  awsKey: (): string => "AK" + "IA" + rnd(16, UPD),
  githubToken: (): string => "gh" + "p_" + rnd(36, ALNUM),
  slackToken: (): string => "xo" + "xb-" + rnd(12, "0123456789") + "-" + rnd(24, ALNUM),
  stripeKey: (): string => "sk" + "_live_" + rnd(24, ALNUM),
  openaiKey: (): string => "sk" + "-" + rnd(40, ALNUM),
  googleKey: (): string => "AI" + "za" + rnd(35, ALNUM),
  jwt: (): string => "ey" + "J" + rnd(20, ALNUM) + ".ey" + "J" + rnd(24, ALNUM) + "." + rnd(30, ALNUM),
  privateKeyHeader: (): string => "-----BEGIN " + "RSA PRIVATE" + " KEY-----",
  dbUrl: (): string => "postgres" + "://admin:" + rnd(12, ALNUM) + "@db.internal.example:5432/prod",
  hex40: (): string => rnd(40, HEX),
  base64Blob: (): string => randomBytes(33).toString("base64").replace(/=+$/, ""),
  email: (): string => rnd(6, "abcdefghij") + "." + rnd(5, "klmnopqrst") + "@" + rnd(6, "uvwxyz") + "-corp.example",
  url: (): string => "https:" + "//" + rnd(7, "abcdefghij") + "-internal.example.org/" + rnd(5, "klmnop") + "/tokens",
  path: (): string => "/home/" + rnd(6, "abcdefgh") + "/projects/" + rnd(7, "klmnopqr") + "/src/secret_" + rnd(4, "xyz") + ".ts",
  ip: (): string => "10." + (1 + (byte() % 200)) + "." + (byte() % 250) + "." + (byte() % 250),
  customerName: (): string => rnd(1, UP) + rnd(7, "abcdefghijklmnop") + " Holdings",
  envLine: (): string => "DATABASE_" + "PASSWORD=" + rnd(18, ALNUM),
};

export type CanaryKind = keyof typeof canaries;
export const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

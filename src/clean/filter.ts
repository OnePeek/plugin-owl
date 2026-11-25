// The text rules of the contract (Insight schema) as one pure function. The same rules run on the device before signing
// and on the server before storing (rule E4); a text that fails after cleaning is HELD, never sent (rule E2).
import { matchSecret } from "./rules.js";

export type Hit = "secret" | "email" | "url" | "path" | "ip" | "blob" | "entropy" | "quote" | "name" | "blocklist" | "sentences" | "unicode";

export interface Names {
  /** Names learned from the project: remote owner and repository, package names, top-level directories. */
  learned: string[];
  /** The person's own blocklist. */
  blocklist: string[];
}
export const NO_NAMES: Names = { learned: [], blocklist: [] };

const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[A-Za-z]{2,}/;
const URL_SCHEME = /\b[a-z][a-z0-9+.-]*:\/\/\S+|\b(?:www|ftp)\.\S+/i;
const BARE_DOMAIN = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|dev|app|ai|co|me|us|uk|de|fr|in|eu|cloud|xyz|sh|gg|so|ly|tech|info|biz|edu|gov|ru|cn|jp|br|ca|au|nl|ch|se|no|fi|it|es)\b/i;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const IPV6 = /\b[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){3,7}\b/i;
const HEX_RUN = /[0-9a-fA-F]{20,}/;
const B64_RUN = /[A-Za-z0-9+/_=-]{20,}/g;
const TRIM = /^[\s.,;:!?()[\]{}<>*_-]+|[\s.,;:!?()[\]{}<>*_-]+$/g;

export function shannon(s: string): number {
  const n = new Map<string, number>();
  for (const c of s) n.set(c, (n.get(c) ?? 0) + 1);
  let h = 0;
  for (const v of n.values()) {
    const p = v / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** A base64-looking run: 20+ characters of the alphabet that mixes in a digit, a symbol or both letter cases. Plain long words and hyphenated words stay allowed. */
function isBlobRun(run: string): boolean {
  if (/^[A-Za-z]+$/.test(run)) return /[a-z]/.test(run) && /[A-Z]/.test(run.slice(1)) && !/^[A-Z][a-z]+$/.test(run);
  if (/^[a-z]+(?:-[a-z]+)+$/.test(run)) return false;
  return /[0-9+/=_]/.test(run) || (/[a-z]/.test(run) && /[A-Z]/.test(run));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsName(text: string, name: string): boolean {
  if (name.trim().length < 2) return false;
  return new RegExp(`(?<![A-Za-z0-9])${escapeRe(name)}(?![A-Za-z0-9])`, "i").test(text);
}

/** Detect every rule the text breaks. Empty list = clean. */
export function checkText(text: string, names: Names = NO_NAMES): Hit[] {
  const hits = new Set<Hit>();
  if (text !== text.normalize("NFC") || /[\u0000-\u0008\u000b\u000c\u000e-\u001f​-‏‪-‮⁦-⁩﻿]/.test(text)) hits.add("unicode");
  if (/[`"“”„«»]/.test(text)) hits.add("quote");
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (c === "'" || c === "’" || c === "‘") {
      if (!(i > 0 && i < text.length - 1 && /\p{L}/u.test(text.charAt(i - 1)) && /\p{L}/u.test(text.charAt(i + 1)) && c !== "‘")) {
        hits.add("quote");
        break;
      }
    }
  }
  if (matchSecret(text) !== undefined) hits.add("secret");
  if (EMAIL.test(text)) hits.add("email");
  if (URL_SCHEME.test(text) || BARE_DOMAIN.test(text)) hits.add("url");
  if (IPV4.test(text) || IPV6.test(text)) hits.add("ip");
  if (HEX_RUN.test(text)) hits.add("blob");
  for (const m of text.matchAll(B64_RUN)) if (isBlobRun(m[0])) hits.add("blob");
  for (const raw of text.split(/\s+/)) {
    const tok = raw.replace(TRIM, "");
    if (tok.length >= 3 && /[/\\]/.test(tok)) hits.add("path");
    if (tok.length >= 16 && shannon(tok) > 3.5) hits.add("entropy");
  }
  for (const n of names.learned) if (containsName(text, n)) hits.add("name");
  for (const n of names.blocklist) if (containsName(text, n)) hits.add("blocklist");
  return [...hits];
}

/** At most 3 sentences (contract rule for `summary`). */
export function sentenceCount(text: string): number {
  return text.split(/[.!?]+(?:\s+|$)/).filter((s) => s.trim() !== "").length;
}

/**
 * The cleaner (rule E2): only typographic repairs and learned-name replacement. Anything that looks like a secret, email,
 * URL, path, address, blob or blocklisted word is NOT edited into shape: the caller re-checks and holds the record.
 */
export function cleanText(text: string, names: Names = NO_NAMES): string {
  let t = text.normalize("NFC").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f​-‏‪-‮⁦-⁩﻿]/g, "");
  t = t.replace(/[“”„«»`"]/g, "").replace(/’/g, "'").replace(/‘/g, "");
  t = t.replace(/(?<!\p{L})'|'(?!\p{L})/gu, "");
  // one-slash joins between plain words ("and/or") become a space: not a path
  t = t.replace(/(?<![\w./\\])([A-Za-z]{1,20})\/([A-Za-z]{1,20})(?![\w./\\])/g, "$1 $2");
  for (const n of names.learned) if (n.trim().length >= 4 && containsName(t, n)) t = t.replace(new RegExp(`(?<![A-Za-z0-9])${escapeRe(n)}(?![A-Za-z0-9])`, "gi"), "the project");
  return t.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, " ").trim();
}

/** Redact the model's INPUT: secrets, emails, URLs and addresses never reach the summariser. */
export function redactInput(text: string): string {
  let t = text;
  t = t.replace(/-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g, "[SECRET]");
  const global = (re: RegExp): RegExp => new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  for (const r of SECRET_RULES_FOR_INPUT) t = t.replace(global(r), "[SECRET]");
  t = t.replace(global(EMAIL), "[EMAIL]").replace(global(URL_SCHEME), "[URL]").replace(global(IPV4), "[IP]");
  t = t.replace(/[A-Za-z0-9+/_=-]{20,}/g, (m) => (isBlobRun(m) || HEX_RUN.test(m) ? "[BLOB]" : m));
  return t;
}

import { SECRET_RULES } from "./rules.js";
const SECRET_RULES_FOR_INPUT = SECRET_RULES.map((r) => r.re);

// The text rules of the contract (Insight schema) as one pure function. The same rules run on the device before signing
// and on the server before storing (rule E4); a text that fails after cleaning is HELD, never sent (rule E2).
import { matchSecret } from "./rules.js";
import { isWordDotted, isWordIdentifier } from "./words.js";

export type Hit = "taint" | "secret" | "email" | "url" | "host" | "path" | "ip" | "blob" | "entropy" | "quote" | "name" | "blocklist" | "sentences" | "unicode" | "ticket";

export interface Names {
  /** Names learned from the project: remote owner and repository, package names, top-level directories. */
  learned: string[];
  /** The person's own blocklist. */
  blocklist: string[];
  /** Secret-shaped strings found in THIS session's input (see `redactInput`): no fragment of them may appear in the output. */
  taint?: string[];
}
export const NO_NAMES: Names = { learned: [], blocklist: [] };

const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[A-Za-z]{2,}/;
const URL_SCHEME = /\b[a-z][a-z0-9+.-]*:\/\/\S+|\b(?:www|ftp)\.\S+/i;
const BARE_DOMAIN = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|dev|app|ai|co|me|us|uk|de|fr|in|eu|cloud|xyz|sh|gg|so|ly|tech|info|biz|edu|gov|ru|cn|jp|br|ca|au|nl|ch|se|no|fi|it|es)\b/i;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const IPV6 = /\b[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){3,7}\b/i;
// A host name of any suffix: three or more dot-separated labels ending in letters (db-prod-01.corp.internal), or two labels
// ending in a private-network suffix (build.internal, nas.local).
const HOST = /(?<![\w.-])[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+){1,}\.[a-z]{2,}(?![\w-])|(?<![\w.-])[a-z0-9][a-z0-9-]*\.(?:internal|local|lan|corp|intranet|localdomain|home|arpa)(?![\w-])/i;
// A ticket id (PAY-1234). Public standard names that look the same are exempt (SHA-256, UTF-8, ISO-8601, RFC-8785...).
const TICKET = /(?<![A-Za-z0-9-])([A-Z][A-Z0-9]{1,9})-\d{1,7}(?![A-Za-z0-9])/g;
const TICKET_OK = new Set(["SHA", "UTF", "ISO", "RFC", "ES", "IPV", "TLS", "SSL", "HTTP", "AES", "CVE", "CWE", "ECMA", "IEEE", "PEP", "JSR", "WCAG", "GPT", "PCI", "SOC", "ASVS", "OWASP", "UTC", "GMT", "MP", "COVID", "ISBN", "FIPS", "NIST", "PKCS", "ECDSA", "RSA", "MD", "CRC", "EC", "P", "X", "H", "IPV4", "IPV6", "S3", "EC2", "TOP", "OAUTH"]);
const HEX_RUN = /[0-9a-fA-F]{20,}/;
const B64_RUN = /[A-Za-z0-9+_=-]{20,}/g;
const SPELLED = /(?:^|\s)(?:[A-Za-z0-9][\s.\-_,]+){7,}[A-Za-z0-9](?=\s|$|[.,;])/;
const TRIM = /^[\s.,;:!?()[\]{}<>*_-]+|[\s.,;:!?()[\]{}<>*_-]+$/g;

// Well-known technology names that end like a file name; never a path.
const TECH_NAMES = new Set(["node.js", "next.js", "nuxt.js", "vue.js", "react.js", "express.js", "d3.js", "three.js", "chart.js", "ember.js", "backbone.js", "alpine.js", "nest.js", "deno.js", "socket.io", "asp.net", ".net"]);
const FILE_EXT = /^[\w-]+(?:\.[\w-]+)*\.(?:ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|cs|php|sh|bash|zsh|json|ya?ml|toml|ini|cfg|conf|env|lock|md|txt|sql|css|scss|html|xml|csv|log|pem|key|tf|gradle|swift|c|h|cpp|hpp)$/i;
// Any other file name. The extension list is open: a lowercase name, a dot and a lowercase extension of 2 to 10 letters or
// digits is a file name (checkout.vue, payment.proto, deploy.ps1, schema.prisma); a capitalised name needs a known source
// extension (Checkout.vue), so API names such as Math.random or Promise.all stay readable.
const ANY_FILE = /^[a-z0-9_][\w-]+(?:\.[\w-]+)*\.[a-z][a-z0-9]{1,9}$/;
const MORE_EXT = /^[\w-]{2,}(?:\.[\w-]+)*\.(?:vue|svelte|astro|proto|prisma|ps1|psm1|bat|cmd|graphql|gql|dart|scala|sc|ex|exs|erl|hs|lua|pl|pm|r|ipynb|tsv|parquet|avro|tfvars|hcl|nix|zig|sol|cue|jsonnet|bicep|rego|mdx|rst|adoc|tex|vb|fs|fsx|m|mm|groovy|kts|sbt|cabal|tf|dockerfile|plist|xib|storyboard|xaml|csproj|sln|vcxproj)$/i;

/** Contract rule (2026-11-26 ruling): a token is path-like when it starts with / or ~, has 2 or more slashes, or ends in a file extension. "CI/CD" and "and/or" pass. */
export function isPathLike(tok: string): boolean {
  if (tok.length < 3) return false;
  if (tok.startsWith("/") || tok.startsWith("\\") || tok.startsWith("~")) return true;
  if (tok.includes("\\") || /^[A-Za-z]:[\\/]/.test(tok)) return true; // a Windows path, even with a single backslash
  if ((tok.match(/[/\\]/g) ?? []).length >= 2) return true;
  // owner/repo or type/branch shapes (acme-corp/billing-api, feature/refund-fix); CI/CD, TCP/IP and and/or pass
  if (/^[a-z0-9][\w.-]*\/[\w.-]+$/.test(tok) && /[-_\d]/.test(tok)) return true;
  if (TECH_NAMES.has(tok.toLowerCase())) return false;
  if (FILE_EXT.test(tok) || MORE_EXT.test(tok)) return true;
  // the open extension rule: a dotted name of dictionary words (java.util.concurrent) is a package or API name, not a file
  return ANY_FILE.test(tok) && !isWordDotted(tok);
}

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

/**
 * A base64-looking run: 20+ characters of the alphabet (letters, digits, plus, equals, underscore, hyphen) that contains a digit
 * and is not a plain kebab or snake case identifier. Slash splits runs, so path pieces and plain words stay allowed.
 */
function isBlobRun(run: string, strict = true): boolean {
  // a long lowercase word means words, not key material; unless the run is long and as random as key material (a base64
  // key can hold a run such as nkgxlztws by chance)
  if (/[a-z]{7,}/.test(run) && !(strict && run.length >= 32 && /[A-Z]/.test(run) && /\d/.test(run) && shannon(run) > 4.3)) return false;
  if (!/\d/.test(run)) return /^[A-Za-z]+$/.test(run) ? false : /[+=]/.test(run) && /[a-z]/.test(run) && /[A-Z]/.test(run);
  if (/^[a-z0-9]+(?:[_-][a-z0-9]+)+$/.test(run) && run.split(/[_-]/).every((seg) => seg.length <= 12)) return false;
  return true;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsName(text: string, name: string): boolean {
  if (name.trim().length < 2) return false;
  return new RegExp(`(?<![A-Za-z0-9])${escapeRe(name)}(?![A-Za-z0-9])`, "i").test(text);
}

const JOIN_MARK = "\u0001";
const FORMAT_CHARS = /[\u200B-\u200F\u2060\uFEFF]/g;
const CHUNKED = /[A-Za-z0-9]+(?:[ _-]+[A-Za-z0-9]+)+/g;

/**
 * The normalised copy the secret rules also run on (ruling 11-26, mirrored by the server): zero-width and format characters
 * removed, and a run of spaces, hyphens or underscores dropped where it sits between two letter-or-digit chunks of 4 or more
 * characters, so a key split as AKIA QWER ... or with hyphens or zero-width spaces is read whole. A hit on either copy holds.
 * Each joined stretch is written out from every chunk it can start at to every chunk it can end at (Rotated AKIA QWER here
 * gives RotatedAKIA ... AKIAQWER ...), so a word joined in front of or behind the key cannot hide its edges from a rule that
 * needs a word boundary. A stretch is at most 24 chunks, so the copy stays small.
 */
export function joinSplit(text: string, mark = ""): string {
  return text.replace(FORMAT_CHARS, "").replace(CHUNKED, (run) => {
    const parts = run.split(/([ _-]+)/);
    const variants: string[] = [run];
    for (let start = 0; start < parts.length; start += 2) {
      let out = parts[start] as string;
      for (let i = start + 1; i + 1 < parts.length && i - start < 48; i += 2) {
        const prev = parts[i - 1] as string;
        const next = parts[i + 1] as string;
        out += (prev.length >= 4 && next.length >= 4 ? mark : (parts[i] as string)) + next;
        variants.push(out);
      }
    }
    return variants.join(" ");
  });
}

const SPLIT = /(?<=[A-Za-z0-9]{4})[ _-]+(?=[A-Za-z0-9]{4})/g;

/** The normalised copy exactly as the server builds it: invisible characters removed, a separator run between 4 letters or digits on each side dropped. */
export function normalised(text: string): string {
  return text.replace(FORMAT_CHARS, "").replace(SPLIT, "");
}

/**
 * The key-material rules a joined copy is read with (as the server): a hex run, a base64-looking run that is key material, or a
 * high-entropy token with no run of 7 or more lower-case letters (joined ordinary words always have one). Paths, quotes and
 * sentence rules read the original only.
 */
export function keyMaterial(marked: string): boolean {
  const copy = marked.split(JOIN_MARK).join("");
  if (HEX_RUN.test(copy)) return true;
  // the server's blob shape (no long-random exception): a joined copy of ordinary words with a number is long and mixed-case
  for (const m of copy.matchAll(B64_RUN)) if (isBlobRun(m[0], false)) return true;
  for (const raw of marked.split(/\s+/)) {
    const chunks = raw.replace(TRIM, "").split(JOIN_MARK);
    const tok = chunks.join("");
    if (/[a-z]{7,}/.test(tok)) continue; // as the server: joined ordinary words hold a run of 7+ lower-case letters
    // device only (server mirror needed): words joined by the copy, each a word shape (Python SQLAlchemy, with EXPLAIN ANALYZE, Android GitHub)
    if (chunks.length > 1 && chunks.every((c) => /^[A-Za-z]+$/.test(c) && (/[a-z]{4,}/.test(c) || /^[A-Z]{2,8}$/.test(c) || /^(?:[A-Z][a-z]{2,}){2,3}$/.test(c)))) continue;
    for (const piece of tok.split(/[-_.]+/)) if (piece.length >= 16 && shannon(piece) > 3.5 && !isWordIdentifier(piece)) return true;
  }
  return false;
}

/** Detect every rule the text breaks. Empty list = clean. */
export function checkText(input: string, names: Names = NO_NAMES): Hit[] {
  const hits = new Set<Hit>();
  // every rule runs on the NFKC form, so full-width or compatibility look-alikes (／etc／app, ｇｈｐ＿...) are judged as what they
  // read as; any such character is itself a hit
  const text = input.normalize("NFKC");
  if (text !== input.normalize("NFC")) hits.add("unicode");
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
  if (matchSecret(text) !== undefined || matchSecret(joinSplit(text)) !== undefined) hits.add("secret");
  // the server's normalised copy (backend leak_screen.normalised): read only with the secret and key-material rules
  const copy = normalised(text);
  if (copy !== text && (matchSecret(copy) !== undefined || keyMaterial(text.replace(FORMAT_CHARS, "").replace(SPLIT, JOIN_MARK)))) hits.add("secret");
  // device only: the same key-material rules on every joined stretch, so a word joined in front (Used nxej...) cannot hide a key
  if (copy !== text && keyMaterial(joinSplit(text, JOIN_MARK))) hits.add("secret");
  if (EMAIL.test(text)) hits.add("email");
  if (URL_SCHEME.test(text) || BARE_DOMAIN.test(text)) hits.add("url");
  if (hostHit(text)) hits.add("host");
  for (const m of text.matchAll(TICKET)) if (!TICKET_OK.has(m[1] as string)) hits.add("ticket");
  if (IPV4.test(text) || IPV6.test(text)) hits.add("ip");
  if (HEX_RUN.test(text)) hits.add("blob");
  for (const m of text.matchAll(B64_RUN)) if (isBlobRun(m[0])) hits.add("blob");
  for (const raw of text.split(/\s+/)) {
    const tok = raw.replace(TRIM, "");
    if (isPathLike(tok)) hits.add("path");
    // entropy is judged per alphanumeric piece, so a hyphenated phrase such as retry-with-backoff is not mistaken for key material
    for (const piece of tok.split(/[-_.]+/)) if (piece.length >= 16 && shannon(piece) > 3.5 && !isWordIdentifier(piece)) hits.add("entropy");
    if (tok.length >= 10 && /^[A-Za-z0-9]+$/.test(tok) && (tok.match(/\d/g) ?? []).length >= 3 && (tok.match(/[A-Za-z]/g) ?? []).length >= 3 && (tok.length >= 14 || (/[a-z]/.test(tok) && /[A-Z]/.test(tok)))) hits.add("blob"); // fragments of split secrets
  }
  if (SPELLED.test(text)) hits.add("blob"); // a secret spelled out one character at a time
  if (taintHit(text, names.taint ?? [])) hits.add("taint");
  for (const n of names.learned) if (containsName(text, n)) hits.add("name");
  for (const n of names.blocklist) if (containsName(text, n)) hits.add("blocklist");
  return [...hits];
}

// Network suffixes and environment words: a dotted name ending in one of these is a host even when its labels are words.
const HOST_WORDS = new Set(["internal", "local", "lan", "corp", "intranet", "localdomain", "home", "arpa", "prod", "production", "staging", "stage", "dev", "test", "qa", "uat", "svc", "cluster", "cloud", "net", "com", "org", "io", "host", "server", "service", "db", "database", "api", "node"]);

/** A host name match, unless it is a dotted name of dictionary words (java.util.concurrent) with no network or environment label. */
function hostHit(text: string): boolean {
  for (const m of text.matchAll(new RegExp(HOST.source, "gi"))) {
    const labels = m[0].toLowerCase().split(".");
    if (!(isWordDotted(m[0]) && !labels.some((l) => HOST_WORDS.has(l)))) return true;
  }
  return false;
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
  for (const n of names.learned) if (n.trim().length >= 4 && containsName(t, n)) t = t.replace(new RegExp(`(?<![A-Za-z0-9])${escapeRe(n)}(?![A-Za-z0-9])`, "gi"), "the project");
  return t.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, " ").trim();
}

const squeeze = (x: string): string => x.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
const TAINT_SLICE = 7;

/** True when any run of 7 or more characters of a tainted string (letters and digits only, any case, forwards or reversed) survives in the text. Catches split, spaced, dotted and reversed copies. */
export function taintHit(text: string, taint: string[]): boolean {
  if (taint.length === 0) return false;
  const t = squeeze(text);
  for (const item of taint) {
    const q = squeeze(item);
    if (q.length < TAINT_SLICE) continue;
    const r = [...q].reverse().join("");
    for (let i = 0; i + TAINT_SLICE <= q.length; i++) if (t.includes(q.slice(i, i + TAINT_SLICE)) || t.includes(r.slice(i, i + TAINT_SLICE))) return true;
  }
  return false;
}

export interface Redacted {
  text: string;
  /** What was removed because it looked secret: kept in memory only, to catch copies of it in the model's answer. */
  taint: string[];
}

const MIXED_ID = /(?<![A-Za-z0-9])[A-Za-z0-9]{10,19}(?![A-Za-z0-9])/g;
const WEAK_RULES = new Set(["generic-assignment", "dotenv-line", "bearer", "basic-auth", "db-url-credentials", "aws-secret", "heroku-uuid-key", "cloudflare"]);

/** A token that looks like random key material: long, with a digit, and mixed case or pure hex. Plain words and identifiers are not. */
function secretish(tok: string): boolean {
  if (tok.length < 12 || !/\d/.test(tok) || /^[A-Za-z]+$/.test(tok)) return false;
  return /^[0-9a-fA-F]{20,}$/.test(tok) || (/[a-z]/.test(tok) && /[A-Z]/.test(tok)) || shannon(tok) > 3.8;
}

const tokensOf = (m: string): string[] => {
  const all = m.split(/[\s=:"',;@/]+/);
  const hit = all.filter(secretish);
  if (hit.length > 0) return hit;
  const longest = all.reduce((a, b) => (b.length > a.length ? b : a), "");
  return longest.length >= 8 ? [longest] : []; // a value with no random look (a plain password) still taints its longest piece
};

/** Redact the model's INPUT: secrets, emails, URLs and addresses never reach the summariser. Secrets and blobs also become `taint`. */
export function redactInput(text: string): Redacted {
  const taint: string[] = [];
  const global = (re: RegExp): RegExp => new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  // a split key (spaced, hyphenated or zero-width split) is read whole on the joined copy; its value becomes taint so no copy of it, split or whole, can come back
  for (const r of SECRET_RULES) if (!WEAK_RULES.has(r.id)) for (const m of joinSplit(text).matchAll(global(r.re))) if (!global(r.re).test(text)) taint.push(m[0]);
  let t = text.replace(/-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g, (m) => (taint.push(m), "[SECRET]"));
  for (const r of SECRET_RULES) t = t.replace(global(r.re), (m) => (WEAK_RULES.has(r.id) ? taint.push(...tokensOf(m)) : taint.push(m), "[SECRET]"));
  t = t.replace(global(EMAIL), "[EMAIL]").replace(global(URL_SCHEME), "[URL]").replace(global(IPV4), "[IP]");
  t = t.replace(/[A-Za-z0-9+_=-]{20,}/g, (m) => (isBlobRun(m) || HEX_RUN.test(m) ? (taint.push(m), "[BLOB]") : m));
  t = t.replace(MIXED_ID, (m) => (secretish(m) ? (taint.push(m), "[BLOB]") : m));
  // any other long, random-looking token (base64 with slashes, for example)
  t = t.replace(/\S{24,}/g, (m) => ((shannon(m) > 3.6 && /\d/.test(m) && /[a-z]/.test(m) && /[A-Z]/.test(m) && !/[a-z]{7,}/.test(m)) || (m.length >= 32 && /^[A-Za-z0-9+/=_-]+$/.test(m) && shannon(m) > 4.3 && /[a-z]/.test(m) && /[A-Z]/.test(m)) ? (taint.push(m), "[BLOB]") : m));
  return { text: t, taint };
}

import { SECRET_RULES } from "./rules.js";

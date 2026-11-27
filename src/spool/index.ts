// The encrypted, append-only spool (AIP-D5, D9). Every line is AES-256-GCM sealed with its line number as associated data,
// so a reordered, removed or altered line fails to open. Entries are events; the state of an item is the fold of its
// events. Drafts are unsigned; a record is signed only inside a send, under the file lock (AIP-D12), so DISCARD can still
// replace any unsent draft with a content-free chain entry without a gap. Every append happens under that lock: the line
// index is part of the associated data, so two writers at once would seal two lines with the same index.
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { open, seal } from "../keystore/crypto.js";
import type { Commit } from "../usage/git.js";
import type { Usage } from "../usage/transcript.js";
import type { Insight } from "../record/insight.js";
import type { SignedRecord } from "../sign/chain.js";

export interface Draft {
  session_ref: string;
  created_at_device: string;
  tool_version: string;
  usage: Usage;
  commits: Commit[];
  insight?: Insight;
}
export interface Receipt {
  install_id: string;
  record_hash: string;
  seq: number;
  server_time: string;
  server_sig: string;
  receipt_key_id: string;
}

export type Event =
  | { t: "pending"; id: string; at: number; eligible_at: number; draft: Draft; project?: string }
  | { t: "discard"; id: string; at: number }
  | { t: "signed"; id: string; at: number; install_id: string; env: SignedRecord }
  /** A server answer other than a receipt or a network error: the signed bytes are void and the draft is re-derived (AIP-D12). */
  | { t: "unsigned"; id: string; at: number }
  | { t: "sent"; id: string; at: number; receipt: Receipt }
  | { t: "held"; id: string; at: number; reason: string }
  | { t: "dropped"; id: string; at: number; why: string };

export type ItemState = "pending" | "discard" | "signed" | "sent" | "held" | "dropped";
/** What the draft will become when it is signed: the session record, a `discarded` entry, or a `held` entry. */
export type Intent = "session" | "discard" | "held";
export interface Item {
  id: string;
  state: ItemState;
  intent: Intent;
  project?: string;
  created: number;
  eligibleAt: number;
  draft?: Draft;
  signed?: SignedRecord;
  installId?: string;
  receipt?: Receipt;
  reason?: string;
}

export class Spool {
  constructor(private file: string, private key: Buffer) {}

  private lines(): string[] {
    return existsSync(this.file) ? readFileSync(this.file, "utf8").split("\n").filter(Boolean) : [];
  }

  append(ev: Event): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const n = this.lines().length;
    appendFileSync(this.file, seal(this.key, Buffer.from(JSON.stringify(ev)), `spool:${n}`) + "\n", { mode: 0o600 });
    chmodSync(this.file, 0o600);
  }

  /** Every event in order, plus the index of the first line that failed to open (edit, removal or reorder). */
  events(): { events: Event[]; firstBadLine: number | undefined } {
    const events: Event[] = [];
    let bad: number | undefined;
    this.lines().forEach((l, i) => {
      try {
        events.push(JSON.parse(open(this.key, l, `spool:${i}`).toString("utf8")) as Event);
      } catch {
        bad ??= i;
      }
    });
    return { events, firstBadLine: bad };
  }

  items(): Item[] {
    const m = new Map<string, Item>();
    for (const e of this.events().events) {
      if (e.t === "pending") {
        m.set(e.id, { id: e.id, state: "pending", intent: "session", created: e.at, eligibleAt: e.eligible_at, draft: e.draft, ...(e.project ? { project: e.project } : {}) });
        continue;
      }
      const it = m.get(e.id);
      if (!it) continue;
      if (e.t === "discard") {
        // a discard reaches every draft that is not signed yet (pending, or held by the cleaner)
        if (it.state === "pending" || it.state === "held") {
          it.state = "discard";
          it.intent = "discard";
          delete it.reason;
        }
      } else if (e.t === "signed") {
        it.state = "signed";
        it.signed = e.env;
        it.installId = e.install_id;
      } else if (e.t === "unsigned") {
        if (it.state !== "signed") continue;
        delete it.signed;
        delete it.installId;
        it.state = it.intent === "discard" ? "discard" : it.intent === "held" ? "held" : "pending";
      } else if (e.t === "sent") {
        it.state = "sent";
        it.receipt = e.receipt;
      } else if (e.t === "held") {
        it.state = "held";
        it.intent = "held";
        it.reason = e.reason;
      } else if (e.t === "dropped") {
        it.state = "dropped";
        it.reason = e.why;
      }
    }
    return [...m.values()].sort((a, b) => a.created - b.created);
  }

  /** The newest signed envelope of this install: the chain head the next record must extend. */
  head(installId: string): SignedRecord | undefined {
    const signed = this.items().filter((i) => i.signed && i.installId === installId);
    return signed.sort((a, b) => a.signed!.record.seq - b.signed!.record.seq).pop()?.signed;
  }

  chain(installId: string): SignedRecord[] {
    return this.items().filter((i) => i.signed && i.installId === installId).map((i) => i.signed!).sort((a, b) => a.record.seq - b.record.seq);
  }
}

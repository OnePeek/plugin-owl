import { toTranscript, type SessionSpec } from "../../evals/builder.js";

export const sampleSpec: SessionSpec = {
  id: "sample",
  type: "bugfix",
  cwd: "/work/shop",
  steps: [
    { u: "Prices come out stale after a bulk update. Please find out why and fix it." },
    { a: "I will look at how the price cache is filled and invalidated." },
    { t: "Read", i: { file_path: "/work/shop/src/cache.ts" }, r: "export function get() {}" },
    { t: "Grep", i: { pattern: "invalidate" }, r: "src/cache.ts:14" },
    { t: "Edit", i: { file_path: "/work/shop/src/cache.ts", old_string: "const key = id;\nreturn store.get(key);", new_string: "const key = id + ':' + version;\nreturn store.get(key);\n// versioned" }, r: "edited" },
    { t: "Bash", i: { command: "npm test" }, r: "1 failing", err: true },
    { t: "Edit", i: { file_path: "/work/shop/src/cache.ts", old_string: "version", new_string: "this.version" }, r: "edited" },
    { t: "Bash", i: { command: "npm test" }, r: "all passing" },
    { a: "The stale prices were caused by a race between invalidation and refill; entries are now versioned." },
  ],
  reference: { task_type: "bugfix", summary: "", facts: [], specific: [], decisions: [], skills: [] },
};

export const sampleTranscript = (): string => toTranscript(sampleSpec);

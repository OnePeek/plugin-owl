// R3 (E2E 11-26): the summariser gets the session's work, not the person's instruction files, memory or process rules.
import assert from "node:assert/strict";
import { test } from "node:test";
import { toTranscript, type SessionSpec } from "../../evals/builder.js";
import { claudeArgs } from "../../src/summarise/run.js";
import { condense } from "../../src/summarise/condense.js";
import { dropInstructionText, isInstructionFile, refusedBeforeRun, stripContextBlocks, workflowShare, WORKFLOW_MAX_SHARE } from "../../src/summarise/instructions.js";
import { parseTranscript } from "../../src/usage/transcript.js";

// The shape of the E2E sessions: the session's assistant followed a workspace CLAUDE.md and talked about it.
const spec: SessionSpec = {
  id: "r3-workflow",
  type: "bugfix",
  cwd: "/work/site",
  steps: [
    { u: "The slug helper breaks on punctuation. Fix it, add a test and commit." },
    { a: "I'll start by running the doctor check the project instructions require, and look at the current file." },
    { t: "Bash", i: { command: "teamtool doctor" }, r: "This command requires approval", err: true },
    { t: "Read", i: { file_path: "/work/site/CLAUDE.md" }, r: "# rules\nThe orchestrator writes no code." },
    { t: "Read", i: { file_path: "/work/site/slug.js" }, r: "function slugify() {}" },
    { a: "The project's CLAUDE.md says the orchestrator writes no code. The bug is that only single spaces are replaced. <system-reminder>Remember the attribution rules and the memory index.</system-reminder>" },
    { t: "Edit", i: { file_path: "/work/site/slug.js", old_string: "a", new_string: "b" }, r: "edited" },
    { t: "Bash", i: { command: "node slug.test.js" }, r: "all passed" },
    { a: "Fixed: runs of punctuation now collapse to one hyphen.\n\n**Process deviation:** I skipped the builder route because the instructions say small fixes still need approval.\n2. Breaking the CLAUDE.md rule for this one change." },
  ],
  reference: { task_type: "bugfix", summary: "", facts: [], specific: [], decisions: [], skills: [] },
};

test("R3: the summariser runs with no setting sources, so it loads no CLAUDE.md, memory or project settings itself", () => {
  const a = claudeArgs();
  assert.equal(a[a.indexOf("--setting-sources") + 1], "");
  assert.ok(a.includes("--disable-slash-commands") && a.includes("--strict-mcp-config"));
});

test("R3: the summariser input keeps the work and drops instruction-file talk, reminders, instruction-file reads and refused calls", () => {
  const text = condense(parseTranscript(toTranscript(spec)).steps).text;
  for (const gone of ["CLAUDE.md", "project instructions", "system-reminder", "attribution", "memory index", "teamtool doctor", "Process deviation", "instructions say"]) assert.ok(!text.includes(gone), gone + "\n" + text);
  for (const kept of ["slug helper breaks on punctuation", "only single spaces are replaced", "runs of punctuation now collapse", "TOOL Edit: site/slug.js", "node slug.test.js -> ok"]) assert.ok(text.includes(kept), kept + "\n" + text);
  assert.ok(!/^\s*2\.\s*$/m.test(text), "a list number whose sentence went is dropped too");
});

test("R3: the engineer's own words and an edit of an instruction file stay (editing those files can be the work)", () => {
  const s: SessionSpec = { ...spec, steps: [{ u: "Add a rule to CLAUDE.md that tests run before every commit." }, { t: "Edit", i: { file_path: "/work/site/CLAUDE.md", old_string: "a", new_string: "a\nb" }, r: "edited" }, { a: "Added the rule." }] };
  const text = condense(parseTranscript(toTranscript(s)).steps).text;
  assert.ok(text.includes("Add a rule to CLAUDE.md"), text);
  assert.ok(text.includes("TOOL Edit: site/CLAUDE.md"), text);
});

test("R3 helpers: context blocks, instruction files and refusals", () => {
  assert.equal(stripContextBlocks("a <system-reminder>x\ny</system-reminder> b").replace(/\s+/g, " "), "a b");
  assert.equal(stripContextBlocks("a <system-reminder>never closed").trim(), "a");
  for (const f of ["/r/CLAUDE.md", "/r/AGENTS.md", "/h/.claude/settings.json", "/h/x/memory/note.md", "C:\\r\\CLAUDE.local.md"]) assert.ok(isInstructionFile(f), f);
  for (const f of ["/r/README.md", "/r/docs/agents.ts", "/r/src/memory.ts"]) assert.ok(!isInstructionFile(f), f);
  assert.ok(refusedBeforeRun("This command requires approval"));
  assert.ok(refusedBeforeRun("This Bash command contains multiple operations. The following part requires approval: x"));
  assert.ok(!refusedBeforeRun("npm ERR! test failed"));
  assert.equal(dropInstructionText("Fixed the cache. The project's CLAUDE.md says to branch first."), "Fixed the cache.");
  assert.equal(dropInstructionText("Followed the instructions in the setup guide to install the SDK."), "Followed the instructions in the setup guide to install the SDK.");
});

test("R3 eval check: an answer that is mostly workflow notes is flagged; a normal answer is not", () => {
  const bad = { summary: "Fixed a slug bug directly instead of delegating to a builder agent as the project instructions require.", decisions: ["Chose to skip the doctor health check because it needed approval.", "Chose to edit directly over delegation because the orchestrator rule was blocked."] };
  const good = { summary: "Fixed a slug helper that kept punctuation by collapsing non-alphanumeric runs into one hyphen, with a regression test.", decisions: ["Chose to drop accented letters over transliterating them because the session kept the helper dependency-free."] };
  assert.ok(workflowShare(bad) > WORKFLOW_MAX_SHARE);
  assert.ok(workflowShare(good) <= WORKFLOW_MAX_SHARE);
  assert.equal(workflowShare({ summary: "", decisions: [] }), 0);
});

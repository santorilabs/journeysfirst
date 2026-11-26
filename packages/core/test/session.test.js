import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { sessionItems } from "../src/review/session.js";
import { recordAllPassed, recorder } from "./helpers.js";

const STARTED = "2026-11-26T06:08:20.000Z";
/** One line of a Codex session record. */
const saved = (seconds, item) => JSON.stringify({ timestamp: new Date(Date.parse(STARTED) + seconds * 1000).toISOString(), type: "event_msg", payload: { type: "item_completed", item } });
const STEPS = [{ says: "Find the free slots." }, { says: "Book the meeting." }, { check: "The meeting is saved.", id: "saved-meeting" }, { says: "Cancel it." }, { says: "Say so." }];
const RECORD = [
  JSON.stringify({ timestamp: STARTED, type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "PRIVATE SYSTEM PROMPT" }] } }),
  saved(5, { type: "UserMessage", content: [{ type: "text", text: "THE PROMPT" }] }),
  saved(7.6, { type: "AgentMessage", content: [{ type: "Text", text: "I will check `calendar.txt` and **book** it. <b>" }] }),
  saved(8.1, { type: "CommandExecution", command: ["/bin/zsh", "-lc", "cat .mcp.json"], aggregated_output: "no such file", exit_code: 1, status: "failed" }),
  saved(12.4, { type: "McpToolCall", server: "calendar", tool: "find_free_slots", arguments: { day: "2026-11-26" }, status: "completed", result: { content: [{ type: "text", text: '{"slots":[1,2]}' }] }, duration: { secs: 0, nanos: 6112958 } }),
  saved(14.5, { type: "CommandExecution", command: ["/bin/zsh", "-lc", `printf '%s\\n' '{"line":1,"status":"done"}' >> .journeysfirst/results.jsonl`], aggregated_output: "", exit_code: 0 }),
  saved(14.6, { type: "McpToolCall", server: "calendar", tool: "create_event", arguments: {}, status: "failed", error: { message: "The slot is taken." } }),
  saved(16, { type: "CommandExecution", command: ["/bin/zsh", "-lc", `printf '%s\\n' '{"line":2,"status":"done"}' '{"id":"saved-meeting","verdict":"passed","proof":"It says \\"saved\\" {once}.","refs":[{"file":"calendar.txt","line":5}]}' >> .journeysfirst/results.jsonl`], exit_code: 0 }),
  saved(20, { type: "AgentMessage", content: [{ type: "Text", text: "Done." }] }),
  "{ half a line",
].join("\n");

test("a session record becomes rows: what was said, commands and tool calls, with times and the step each ended", () => {
  const items = sessionItems(RECORD, STARTED, STEPS);
  assert.deepEqual(items.map((i) => [i.kind, i.ok, i.at, i.step]), [
    ["said", true, 7.6, undefined], ["command", false, 8.1, undefined], ["call", true, 12.4, undefined],
    ["command", true, 14.5, 1], ["call", false, 14.6, undefined], ["command", true, 16, 3], ["said", true, 20, undefined],
  ]);
  assert.equal(items[1].name, "cat .mcp.json", "a shell's wrapper is left out");
  assert.equal(items[1].note, "exit 1");
  assert.deepEqual(items[1].parts, [{ label: "Output", text: "no such file" }]);
  assert.equal(items[2].where, "calendar");
  assert.equal(items[2].ms, 6.112958);
  assert.deepEqual(items[2].parts.map((p) => p.label), ["Sent", "Got back"]);
  assert.equal(items[2].parts[1].text, '{\n  "slots": [\n    1,\n    2\n  ]\n}', "JSON that came back as text is laid out");
  assert.deepEqual(items[4].parts.at(-1), { label: "Error", text: "The slot is taken." });
  assert.deepEqual(items[3].parts, [], "a command with no output has nothing to open");
  assert.equal(items[5].step, 3, "a line number in a check's refs is a line of a kept file, not a step");
});

test("a result written inside a shell's double quotes still ends its step", () => {
  const command = String.raw`echo "{\"line\":2,\"status\":\"done\"}" >> .journeysfirst/results.jsonl`;
  const [item] = sessionItems(saved(3, { type: "CommandExecution", command: ["/bin/zsh", "-lc", command], exit_code: 0 }), STARTED, STEPS);
  assert.equal(item.step, 2);
});

test("the events Codex prints are read too, without times", () => {
  const printed = [
    { type: "thread.started", thread_id: "t1" },
    { type: "item.completed", item: { type: "agent_message", text: "Starting." } },
    { type: "item.completed", item: { type: "command_execution", command: "ls", aggregated_output: "a.txt", exit_code: 0, status: "completed" } },
    { type: "item.completed", item: { type: "mcp_tool_call", server: "calendar", tool: "get_event", arguments: { id: "evt_1" }, status: "completed", result: { content: [{ type: "text", text: "ok" }] } } },
  ].map((e) => JSON.stringify(e)).join("\n");
  const items = sessionItems(printed, STARTED, STEPS);
  assert.deepEqual(items.map((i) => [i.kind, i.name, i.at]), [["said", "Starting.", undefined], ["command", "ls", undefined], ["call", "get_event", undefined]]);
});

test("a run with a session and no video shows the session where the video would be", () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-session-"));
  const run = recordAllPassed(recorder({ outputDir: dir }));
  run.attach({ name: "codex-session.jsonl", body: RECORD, kind: "transcript" });
  run.attach({ name: "calendar.txt", body: '{"kind":"request","text":"client tools/list"}\n{"kind":"response","text":"<b>Result</b>","ms":2}', kind: "transcript" });
  run.attach({ name: "handoff.txt", body: "Plain words.", kind: "transcript" });
  const { run: done } = run.finish();
  const cli = new URL("../bin/journeysfirst.js", import.meta.url).pathname;
  const out = join(mkdtempSync(join(tmpdir(), "jf-session-export-")), "out");
  const omitted = join(mkdtempSync(join(tmpdir(), "jf-session-export-")), "out");
  execFileSync(process.execPath, [cli, "review", dir, "--out", out, "--include-transcripts"]);
  execFileSync(process.execPath, [cli, "review", dir, "--out", omitted]);
  const page = `runs/share-by-link/${done.id}/index.html`;
  const html = readFileSync(join(out, page), "utf8");
  assert.match(html, /<div class="rp-log tabbed">/);
  assert.doesNotMatch(html, /class="rp-main"/, "the session takes the stage");
  assert.match(html, /data-tab="session"[^>]*>Session<\/button><button[^>]*data-tab="file-0"[^>]*>calendar\.txt<\/button><button[^>]*data-tab="file-1"[^>]*>handoff\.txt</);
  assert.match(html, /Everything 7<\/button>.*Tool calls 2<\/button>.*Commands 3<\/button>.*What the agent said 2<\/button>/s);
  assert.match(html, /I will check <code>calendar\.txt<\/code> and <b>book<\/b> it\. &lt;b&gt;/, "what the agent wrote is escaped, then marked");
  assert.match(html, /<span class="act-mark bad">Failed<\/span><span class="act-name"><span class="act-where">\$<\/span> cat \.mcp\.json<\/span><span class="act-end"><span class="act-note">exit 1<\/span>/);
  assert.match(html, /<span class="act-where">calendar<\/span> <b>find_free_slots<\/b><\/span><span class="act-end"><span>6\.1 ms<\/span>/);
  assert.match(html, /<ol class="kept-lines"><li><span class="act-who">request<\/span>client tools\/list<\/li><li><span class="act-who">response · 2\.0 ms<\/span>&lt;b&gt;Result&lt;\/b&gt;<\/li><\/ol>/, "a file of records is numbered lines");
  assert.match(html, /<pre class="kept">Plain words\.<\/pre>/);
  assert.doesNotMatch(html, /PRIVATE SYSTEM PROMPT|THE PROMPT|Transcript: (codex-session|calendar|handoff)/, "only what the agent did is shown, and no file is shown twice");
  const heads = [...html.matchAll(/class="at-step"(?: data-step="(\d)")?/g)].map((m) => m[1] ?? "after");
  assert.deepEqual(heads, ["1", "2", "3"], "rows sit under the step they were done for: this run has no check called saved-meeting, so the last command ends step 2");
  assert.doesNotMatch(readFileSync(join(omitted, page), "utf8"), /class="rp-log|<b>find_free_slots/, "an export without transcripts has no session");
});

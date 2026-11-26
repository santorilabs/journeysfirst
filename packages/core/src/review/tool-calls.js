// The tool calls an agent made through an MCP proxy, read from the transcripts
// a run attached. `journeysfirst measured` prints them. The review page shows an
// agent's calls from its session (session.js). A call that returned an error is a fact for a review. The count
// is not: an agent takes a different path each run, so it is shown beside the
// average of earlier passed runs and nothing is judged from it.
import { join } from "node:path";
import { earlierRuns, readRunJson } from "../format/run-folder.js";
import { FILE_NAME } from "../format/runfile.js";
import { readText } from "./transcripts.js";

/** How many earlier runs the tool calls are averaged over, at most. */
export const TOOL_RUNS = 10;

/**
 * @typedef {{tool: string, at?: number, ms?: number, error?: true, says?: string, recovered?: boolean, reply?: number}} ToolCall
 *   at: ms from the proxy's start to the call. ms: how long the call waited. says: the start of an error reply.
 *   recovered: on an error, whether a later call of the same tool worked. reply: the transcript line of the reply.
 * @typedef {{file: string, calls: ToolCall[], line: string, average: string[], proves: string[][]}} ToolCalls one transcript:
 *   line: its counts in words. average: the same for earlier passed runs, empty with none.
 *   proves: for each call, the ids of the checks that cite its reply as proof.
 */

/**
 * The tool calls in each transcript an MCP proxy saved for a run, in order.
 * ms is missing when the reply never came, or when an older proxy saved the transcript.
 * @param {string} folder a run folder
 * @returns {Map<string, ToolCall[]>} by transcript file. A transcript with no tool call is left out.
 */
export function readToolCalls(folder) {
  /** @type {Map<string, ToolCall[]>} */
  const files = new Map();
  const media = readRunJson(folder).media;
  for (const item of Array.isArray(media) ? media : []) {
    if (item?.kind !== "transcript" || typeof item.file !== "string" || !FILE_NAME.test(item.file)) continue;
    /** @type {Map<number, ToolCall>} */
    const calls = new Map();
    (readText(join(folder, item.file))?.body ?? "").split("\n").forEach((text, index) => {
      let row;
      try { row = JSON.parse(text); } catch { return; }
      const tool = row?.kind === "request" && /^client tools\/call(?: (.+))?$/.exec(row.text);
      if (tool) calls.set(index + 1, { tool: tool[1] ?? "a tool", ...(Number.isSafeInteger(row.at) ? { at: row.at } : {}) });
      const call = row?.kind === "response" ? calls.get(row.request) : undefined;
      if (call) call.reply = index + 1;
      if (call && Number.isSafeInteger(row.ms)) call.ms = row.ms;
      if (call && row.error === true) Object.assign(call, { error: true, says: String(row.text ?? "").trim().replace(/\s+/g, " ").slice(0, 120) });
    });
    const list = [...calls.values()];
    list.forEach((call, i) => { if (call.error) call.recovered = list.slice(i + 1).some((later) => later.tool === call.tool && later.reply !== undefined && !later.error); });
    if (list.length) files.set(item.file, list);
  }
  return files;
}

/** @param {number} n @param {string} word */
const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** A wait in words. Under a tenth of a second it is in ms, so a fast call does not read as 0.0 s. @param {number} ms */
const seconds = (ms) => (ms < 100 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

/**
 * One line for a transcript's tool calls: how many, how many returned an error, the wait, and the slowest.
 * @param {ToolCall[]} calls
 */
export function toolCallLine(calls) {
  const timed = calls.filter((call) => call.ms !== undefined);
  const said = [count(calls.length, "tool call"), count(calls.filter((call) => call.error).length, "error")];
  if (!timed.length) return said.join(", ") + ", wait not measured";
  const slowest = timed.reduce((a, b) => (/** @type {number} */ (b.ms) > /** @type {number} */ (a.ms) ? b : a));
  said.push(`${seconds(timed.reduce((sum, call) => sum + /** @type {number} */ (call.ms), 0))} waiting`);
  return said.join(", ") + (timed.length > 1 ? `, slowest ${slowest.tool} ${seconds(/** @type {number} */ (slowest.ms))}` : "");
}

/**
 * A run's tool calls beside the average of earlier runs, with the range.
 * @param {ToolCall[]} calls this run, one transcript
 * @param {ToolCall[][]} earlier the same transcript in each earlier run
 * @returns {string[]} no line when there is no earlier run
 */
export function toolCallAverage(calls, earlier) {
  if (!earlier.length) return [];
  const mean = (/** @type {number[]} */ values) => values.reduce((sum, v) => sum + v, 0) / values.length;
  const sizes = earlier.map((run) => run.length);
  const waits = earlier.filter((run) => run.every((call) => call.ms !== undefined)).map((run) => run.reduce((sum, call) => sum + /** @type {number} */ (call.ms), 0));
  const said = [`Earlier, on average over ${count(earlier.length, "run")}: ${mean(sizes).toFixed(1)} tool calls (${Math.min(...sizes)} to ${Math.max(...sizes)}), ${mean(earlier.map((run) => run.filter((call) => call.error).length)).toFixed(1)} errors${waits.length ? `, ${seconds(mean(waits))} waiting` : ""}.`];
  if (earlier.length >= 3 && calls.length > Math.max(...sizes)) said.push("More tool calls than any of those runs.");
  return said;
}

/** @param {ToolCall} call a call that returned an error */
const recovery = (call) => (call.recovered ? `The agent recovered: a later ${call.tool} call worked.` : `No later ${call.tool} call worked.`);

/**
 * A run's tool calls, one entry for each transcript that has any.
 * @param {string} folder a run folder
 * @returns {ToolCalls[]}
 */
export function toolCalls(folder) {
  const tools = readToolCalls(folder);
  if (!tools.size) return [];
  // A run that did not pass may have stopped early or gone in circles, so it is not what to compare with.
  const earlier = earlierRuns(folder).filter(({ raw }) => raw.result === "passed").map((run) => readToolCalls(run.folder)).filter((run) => run.size).slice(0, TOOL_RUNS);
  /** @type {Map<string, string[]>} the checks that cite each transcript line, by the evidence's query, like "calendar.txt, line 12" */
  const cited = new Map();
  const steps = readRunJson(folder).steps;
  for (const step of Array.isArray(steps) ? steps : []) {
    for (const item of Array.isArray(step?.evidence) ? step.evidence : []) {
      if (item?.source === "log" && typeof item.query === "string" && typeof step.id === "string") cited.set(item.query, [...(cited.get(item.query) ?? []), step.id]);
    }
  }
  return [...tools].map(([file, calls]) => ({
    file, calls, line: toolCallLine(calls),
    average: toolCallAverage(calls, earlier.flatMap((run) => (run.has(file) ? [/** @type {ToolCall[]} */ (run.get(file))] : []))),
    proves: calls.map((call) => (call.reply === undefined ? [] : cited.get(`${file}, line ${call.reply}`) ?? [])),
  }));
}

/** When a call started and how long it took, in words. @param {ToolCall} call */
const timing = (call) => [call.at === undefined ? "" : `at ${seconds(call.at)}`, call.reply === undefined ? "no reply" : call.ms === undefined ? "" : `took ${seconds(call.ms)}`].filter(Boolean);

/**
 * The lines `journeysfirst measured` prints about a run's tool calls: a fact
 * for each call that returned an error, then each transcript's counts and calls.
 * @param {string} folder a run folder
 * @returns {string[]} empty for a run with no tool calls
 */
export function toolCallReport(folder) {
  const tools = toolCalls(folder);
  if (!tools.length) return [];
  const said = tools.flatMap(({ file, calls }) => calls.filter((call) => call.error).map((call) => `fact  intuitive-tools  ${call.tool} returned an error: ${call.says || "Error"} ${recovery(call)}  (${file})`));
  if (said.length) said.push("");
  said.push("Tool calls:");
  for (const { file, calls, line, average, proves } of tools) {
    const wide = Math.max(...calls.map((call) => call.tool.length));
    said.push(`  ${file}: ${line}.`, ...average.map((text) => `    ${text}`));
    calls.forEach((call, i) => said.push([
      `    ${String(i + 1).padStart(String(calls.length).length)}. ${call.tool.padEnd(wide)}`,
      ...timing(call),
      call.error ? `error: ${call.says || "Error"} ${recovery(call)}` : "",
      proves[i].length ? `proof for ${proves[i].join(", ")}` : "",
    ].filter(Boolean).join("  ")));
  }
  if (tools.every(({ average }) => !average.length)) said.push("  No earlier passed run with tool calls to compare with.");
  return said;
}

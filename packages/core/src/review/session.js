// An agent's run has no video. What it leaves is its session: what it said,
// each command it ran and each call it made to a tool server. This reads the
// saved session file into rows, in order, and draws them. A row shows what
// happened, whether it worked and how long it took. A command or a call opens
// in place to show what was sent and what came back. Rows sit under the step
// they were done for, when the session says where each step ended.
import { join } from "node:path";
import { FILE_NAME } from "../format/runfile.js";
import { clock, esc, isCheck } from "../shared/display.js";
import { panel, tabs } from "./primitives.js";
import { readText } from "./transcripts.js";

const MAX_SESSION_BYTES = 4 * 1024 * 1024;
const MAX_PART_CHARS = 64 * 1024;

/**
 * One thing the agent did.
 * @typedef {{kind: "said" | "command" | "call", name: string, where?: string, ok: boolean, at?: number, ms?: number,
 *   note?: string, parts: Array<{label: string, text: string}>, step?: number}} SessionItem
 *   name: the command, the tool, or what was said. where: the tool's server. at: seconds into the run.
 *   note: a short fact for the row's end, like "exit 1". step: the step this row ended, when it recorded one.
 * @typedef {{says?: unknown, check?: unknown, id?: unknown}} StepLike
 */

/**
 * The run's saved session, when it has one that can be read.
 * @param {{media?: unknown, started_at?: unknown, steps?: unknown}} run
 * @param {string} folder
 * @returns {{file: string, items: SessionItem[], truncated: boolean} | null}
 */
export function readSession(run, folder) {
  for (const item of Array.isArray(run.media) ? run.media : []) {
    if (item?.kind !== "transcript" || typeof item.file !== "string" || !FILE_NAME.test(item.file) || !item.file.endsWith("session.jsonl")) continue;
    const text = readText(join(folder, item.file), MAX_SESSION_BYTES);
    if (!text) continue;
    // A file that was cut ends in half a line.
    const body = text.truncated ? text.body.slice(0, text.body.lastIndexOf("\n") + 1) : text.body;
    const items = sessionItems(body, typeof run.started_at === "string" ? run.started_at : undefined, Array.isArray(run.steps) ? run.steps : []);
    if (items.length) return { file: item.file, items, truncated: text.truncated };
  }
  return null;
}

/**
 * The rows in a session file. Reads both forms Codex saves: its session
 * record (each line has a time) and the events it prints (no times).
 * @param {string} text one JSON object per line
 * @param {string} [startedAt] when the run started, to say how far in each row is
 * @param {StepLike[]} [steps] the run's steps, to find where each one ended
 * @returns {SessionItem[]}
 */
export function sessionItems(text, startedAt, steps = []) {
  const start = startedAt ? Date.parse(startedAt) : NaN;
  /** @type {SessionItem[]} */
  const items = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const done = event?.type === "item.completed" ? event.item : event?.type === "event_msg" && event.payload?.type === "item_completed" ? event.payload.item : null;
    if (!done || typeof done !== "object") continue;
    const item = fromItem(done);
    if (!item) continue;
    const seconds = (Date.parse(event.timestamp) - start) / 1000;
    if (Number.isFinite(seconds) && seconds >= 0) item.at = seconds;
    if (item.kind === "command") item.step = stepRecorded(item.name, steps);
    items.push(item);
  }
  return items;
}

/** @param {Record<string, any>} item */
function fromItem(item) {
  const type = String(item.type ?? "").replaceAll("_", "").toLowerCase();
  if (type === "agentmessage") {
    const said = typeof item.text === "string" ? item.text : texts(item.content);
    return said.trim() ? /** @type {SessionItem} */ ({ kind: "said", name: said.trim(), ok: true, parts: [] }) : null;
  }
  if (type === "commandexecution") {
    const command = Array.isArray(item.command) ? (item.command.length === 3 && /^-l?c$/.test(item.command[1]) ? item.command[2] : item.command.join(" ")) : String(item.command ?? "");
    const failed = typeof item.exit_code === "number" && item.exit_code !== 0;
    return /** @type {SessionItem} */ ({ kind: "command", name: command, ok: !failed, note: failed ? `exit ${item.exit_code}` : undefined,
      parts: part("Output", item.aggregated_output) });
  }
  if (type === "mcptoolcall") {
    const error = typeof item.error === "string" ? item.error : item.error?.message;
    const failed = Boolean(error) || item.status === "failed" || item.result?.is_error === true || item.result?.isError === true;
    return /** @type {SessionItem} */ ({ kind: "call", name: String(item.tool ?? ""), where: String(item.server ?? ""), ok: !failed, ms: milliseconds(item.duration),
      parts: [...part("Sent", item.arguments), ...part("Got back", texts(item.result?.content) || item.result), ...part("Error", error)] });
  }
  return null;
}

/** The text in a list of content parts. @param {unknown} content */
const texts = (content) => (Array.isArray(content) ? content.map((c) => (typeof c?.text === "string" ? c.text : "")).filter(Boolean).join("\n") : "");

/** One part of a row, laid out so a person can read it. @param {string} label @param {unknown} value */
function part(label, value) {
  if (value === undefined || value === null || value === "") return [];
  let shown = value;
  if (typeof value === "string") {
    try {
      shown = JSON.parse(value);
    } catch {}
  }
  const text = typeof shown === "string" ? shown : JSON.stringify(shown, null, 2);
  return [{ label, text: text.length > MAX_PART_CHARS ? `${text.slice(0, MAX_PART_CHARS)}\n(cut here: the rest is in the session file)` : text }];
}

/** @param {unknown} duration */
function milliseconds(duration) {
  if (typeof duration === "number") return duration;
  const d = /** @type {{secs?: unknown, nanos?: unknown}} */ (duration);
  return d && typeof d.secs === "number" && typeof d.nanos === "number" ? d.secs * 1000 + d.nanos / 1e6 : undefined;
}

/**
 * The step a command recorded as over. An agent writes each step's result to
 * results.jsonl as it goes: {"line":2,...} for an action, {"id":"...",...} for a check.
 * @param {string} command @param {StepLike[]} steps
 */
function stepRecorded(command, steps) {
  if (!command.includes("results.jsonl")) return undefined;
  const plain = command.replaceAll("\\", "");
  let last;
  for (const m of plain.matchAll(/"line"\s*:\s*(\d+)|"id"\s*:\s*"([^"]+)"/g)) {
    const n = m[1] ? Number(m[1]) : steps.findIndex((s) => s?.id === m[2]) + 1;
    if (n >= 1 && n <= steps.length) last = Math.max(last ?? 0, n);
  }
  return last;
}

/** @param {number} ms */
const took = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms >= 10 ? Math.round(ms) : ms.toFixed(1)} ms`);
/** @param {number} seconds */
const into = (seconds) => (seconds >= 60 ? clock(seconds) : `${seconds.toFixed(1)} s`);
/** What an agent wrote, with its code and strong words marked. @param {string} text */
const prose = (text) => esc(text).replace(/`([^`\n]+)`/g, "<code>$1</code>").replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");

const KINDS = { call: "Tool calls", command: "Commands", said: "What the agent said" };

/** @param {SessionItem} item */
function row(item) {
  const at = `<span class="act-at">${item.at === undefined ? "" : into(item.at)}</span>`;
  if (item.kind === "said") return `<li class="act said">${at}<div class="act-said"><span class="act-who">Agent</span>${prose(item.name)}</div></li>`;
  const mark = `<span class="act-mark ${item.ok ? "good" : "bad"}">${item.ok ? "Worked" : "Failed"}</span>`;
  const name = item.kind === "call" ? `<span class="act-where">${esc(item.where)}</span> <b>${esc(item.name)}</b>` : `<span class="act-where">$</span> ${esc(item.name)}`;
  const end = [item.note && `<span class="act-note">${esc(item.note)}</span>`, item.ms !== undefined && `<span>${took(item.ms)}</span>`].filter(Boolean).join("");
  const line = `${mark}<span class="act-name">${name}</span><span class="act-end">${end}</span>`;
  // A row with nothing more to show does not open.
  if (!item.parts.length) return `<li class="act ${item.kind}">${at}<div class="act-line">${line}</div></li>`;
  return `<li class="act ${item.kind}">${at}<details><summary class="act-line">${line}</summary>
    <dl class="act-parts">${item.parts.map((p) => `<dt>${esc(p.label)}</dt><dd><pre>${esc(p.text)}</pre></dd>`).join("")}</dl></details></li>`;
}

/**
 * The session as rows, under the step each was done for.
 * @param {SessionItem[]} items
 * @param {StepLike[]} steps
 */
function feed(items, steps) {
  const grouped = items.some((i) => i.step !== undefined);
  /** @param {number} n */
  const head = (n) => {
    const step = steps[n - 1];
    return step ? `<li><button type="button" class="at-step" data-step="${n}"><span class="act-who">${isCheck(step) ? "Check" : "Step"} ${n} of ${steps.length}</span>${esc(step.check ?? step.says ?? "")}</button></li>`
      : `<li class="at-step"><span class="act-who">After the last step</span></li>`;
  };
  let open = 1, html = grouped ? head(1) : "", closed = false;
  for (const item of items) {
    if (grouped && closed) {
      html += head(open);
      closed = false;
    }
    html += row(item);
    if (item.step !== undefined && item.step >= open) {
      open = item.step + 1;
      closed = true;
    }
  }
  const counts = Object.entries(KINDS).map(([kind, label]) => ({ kind, label, n: items.filter((i) => i.kind === kind).length })).filter((k) => k.n);
  const kinds = counts.length > 1
    ? `<div class="kinds" role="group" aria-label="Show"><button type="button" class="kind" data-kind="" aria-pressed="true">Everything ${items.length}</button>${counts.map((k) => `<button type="button" class="kind" data-kind="${k.kind}" aria-pressed="false">${k.label} ${k.n}</button>`).join("")}</div>`
    : "";
  return `${kinds}<ol class="acts" aria-label="What the agent did, in order">${html}</ol>`;
}

/**
 * A kept file whose every line is a record with a text, as numbered lines: a
 * check's evidence names a line by its number. Undefined for any other file.
 * @param {string} body
 */
function keptLines(body) {
  const rows = [];
  for (const line of body.split("\n").filter((l) => l.trim())) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      return undefined;
    }
    if (!record || typeof record.text !== "string") return undefined;
    const facts = [record.kind, record.source, typeof record.ms === "number" && took(record.ms), record.error && "error"].filter((f) => typeof f === "string" && f);
    rows.push(`<li><span class="act-who">${esc(facts.join(" · "))}</span>${esc(record.text)}</li>`);
  }
  return rows.length ? `<ol class="kept-lines">${rows.join("")}</ol>` : undefined;
}

/**
 * What an agent's run recorded, as tabs: its session first, then each file it kept.
 * @param {{items: SessionItem[], truncated: boolean}} session
 * @param {StepLike[]} steps
 * @param {Array<{file: string, body: string, truncated: boolean}>} files the run's other transcripts
 */
export function sessionHtml(session, steps, files) {
  const cut = session.truncated ? '<p class="meta">Only the first 4 MiB of the session are shown.</p>' : "";
  return `<div class="rp-log tabbed">
    ${tabs("What the run recorded", [{ name: "session", label: "Session" }, ...files.map((f, i) => ({ name: `file-${i}`, label: esc(f.file) }))])}
    ${panel("session", feed(session.items, steps) + cut)}
    ${files.map((f, i) => panel(`file-${i}`, `${keptLines(f.body) ?? `<pre class="kept">${esc(f.body)}</pre>`}${f.truncated ? '<p class="meta">Only the first 64 KiB are shown.</p>' : ""}`, true)).join("")}
  </div>`;
}

/** Styles for sessionHtml. */
export const SESSION_CSS = `.rp-log{min-width:0;min-height:0;display:flex;flex-direction:column}
.rp-log>.panel{padding:0}.rp-log>.panel>*{margin-left:0;margin-right:0}
.rp-log .meta{padding:var(--s-sm) var(--s-lg)}
.kept{margin:0;background:none;border:0;padding:var(--s-md) var(--s-lg)}
.kept-lines{margin:0;padding:var(--s-sm) var(--s-lg) var(--s-md) var(--s-2xl);font:var(--label);letter-spacing:.01em;white-space:pre-wrap;overflow-wrap:anywhere}
.kept-lines li{padding:var(--s-sm) 0 var(--s-sm) var(--s-sm)}.kept-lines li+li{border-top:1px solid var(--line)}.kept-lines li::marker{color:var(--text-3)}
.kinds{position:sticky;top:0;z-index:1;display:flex;gap:var(--s-sm);overflow-x:auto;padding:var(--s-sm) var(--s-lg);background:var(--white);border-bottom:1px solid var(--line)}
.kind{flex:none;height:var(--control-sm);padding:0 var(--s-md);border-radius:var(--r-full);background:none;box-shadow:inset 0 0 0 1px var(--line);font:var(--label-strong);font-weight:400;letter-spacing:.01em;color:var(--text-2)}
.kind[aria-pressed="true"]{background:var(--black);box-shadow:none;color:var(--white)}
.acts{list-style:none;margin:0;padding:0 0 var(--s-md)}
.acts[data-only="call"] .act:not(.call),.acts[data-only="command"] .act:not(.command),.acts[data-only="said"] .act:not(.said){display:none}
.at-step{display:block;width:100%;padding:var(--s-sm) var(--s-lg);background:var(--chalk);border-top:1px solid var(--line);text-align:left;font-size:var(--fs-sm);line-height:1.5}
.acts>li:first-child .at-step{border-top:0}.at-step[aria-current="step"]{font-weight:500}
.act-who,.act-at,.act-where,.act-end,.act-parts dt{font:var(--label);line-height:1.75;letter-spacing:.01em;color:var(--text-3)}
.act-who{display:block}
.act{display:grid;grid-template-columns:var(--s-2xl) minmax(0,1fr);column-gap:var(--s-md);align-items:start;padding:0 var(--s-lg)}
.act{border-top:1px solid var(--line)}
.act-at{text-align:right;padding-top:calc((var(--touch) - 1.75*var(--fs-xs))/2)}
.act-said{padding:var(--s-sm) 0 var(--s-md);font-size:var(--fs-sm);line-height:1.5;max-width:44em;white-space:pre-wrap;overflow-wrap:anywhere}
.act-said code{font:var(--label)}
.act details{margin:0;min-width:0}
.act-line{display:flex;align-items:center;gap:var(--s-sm);min-height:var(--touch);list-style:none;color:var(--text)}
.act summary::-webkit-details-marker{display:none}
.act summary:hover .act-name{text-decoration:underline;text-underline-offset:.2em}
.act-mark{flex:none;width:var(--s-md);height:var(--s-md);overflow:hidden;color:transparent;background:var(--text);-webkit-mask:var(--tick) center/contain no-repeat;mask:var(--tick) center/contain no-repeat}
.act-mark.bad{background:var(--error);-webkit-mask-image:var(--cross);mask-image:var(--cross)}
.act-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 var(--fs-xs)/1.75 var(--mono);letter-spacing:.01em}
.act-name b{font-weight:500;font-size:var(--fs-sm)}
.act details[open] .act-name{white-space:pre-wrap;overflow-wrap:anywhere}
.act-end{flex:none;display:flex;gap:var(--s-sm);white-space:nowrap}.act-note{color:var(--error)}
.act-parts{display:grid;grid-template-columns:minmax(0,1fr);margin:0 0 var(--s-md)}
.act-parts dd{margin:0 0 var(--s-sm)}.act-parts pre{margin:0;max-height:24rem;overflow:auto}
@media(max-width:54em){.rp-log{order:1;border-top:1px solid var(--line)}.kinds,.at-step,.rp-log .meta{padding-left:var(--s-md);padding-right:var(--s-md)}.kept{padding:var(--s-md)}.kept-lines{padding-right:var(--s-md)}.kind{height:var(--touch)}
  .act{grid-template-columns:minmax(0,1fr);padding:0 var(--s-md)}.act-at{display:none}}`;

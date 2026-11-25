// Local review UI: serves the run folders written by the reporter or RunRecorder.
//   /                      every run, newest first
//   /runs/<journey>/<run>  one run: the promise, whether it held, and the run player (see run-player.js)
//   /captions/<journey>/<run>/<video>.vtt  each line of a video as a captions track
// Reads run results v1. Older run files (draft 0) are shown in v1 terms.
import { createServer } from "node:http";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { hostAllowed, wrongHostMessage } from "../shared/local-host.js";
import { checkRun } from "../format/run-check.js";
import { findJourney } from "../format/run-folder.js";
import { LABELS, REVIEW_PASSES, batchResult, esc, isCheck, reviewCountText, runTitle, screenshotFile, screenshotPage, stepState, videoAt } from "../shared/display.js";
import { FILE_NAME, runResult } from "../format/runfile.js";
import { RUN_PLAYER_CSS, RUN_PLAYER_SCRIPT, runPlayerHtml } from "./run-player.js";

/**
 * @typedef {import("node:http").IncomingMessage} Request
 * @typedef {import("node:http").ServerResponse} Response
 * @typedef {import("../shared/display.js").MediaItem} MediaItem
 * @typedef {import("../format/runfile.js").Run} Run
 * @typedef {import("../format/runfile.js").Finding} Finding
 * @typedef {Partial<import("../format/runfile.js").ActionStep & import("../format/runfile.js").CheckStep>} StepFields an action or a check, field by field
 * @typedef {Run & {journey: {title?: string}, promise?: string, legacy?: boolean, problems?: string[]}} ShownRun a run as the page shows it
 * @typedef {{journey: string, id: string, run: ShownRun}} RunEntry
 * @typedef {{line: number, summary: string, users: Array<{user: string, outline: string|null,
 *   requests: Array<{line: number|null, method: string, path: string, status: number}>,
 *   errors: Array<{line: number|null, text: string}>, more?: {requests?: number, errors?: number}}>}} AppReport
 *   failure.json, written by the runner when a run fails (see src/runner/reported.js)
 */

/**
 * Listens on 127.0.0.1 unless you pass another host, so the runs stay on this machine.
 * @param {{dir?: string, port?: number, host?: string}} [options]
 */
export function serveReview({ dir = "journey-runs", port = 4400, host = "127.0.0.1" } = {}) {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    const { port: listening } = /** @type {import("node:net").AddressInfo} */ (server.address());
    if (!hostAllowed(host, req.headers.host)) return res.writeHead(403, { "content-type": "text/plain" }).end(wrongHostMessage(host, listening));
    let url;
    try {
      url = decodeURIComponent(/** @type {string} */ (req.url).split("?")[0]);
    } catch {
      return res.writeHead(400, { "content-type": "text/plain" }).end("Bad request: the path is not valid percent-encoding.");
    }
    try {
      if (url === "/") return html(res, indexPage(listRuns(root)));
      const run = url.match(/^\/runs\/([^/]+)\/([^/]+)\/?$/);
      if (run) return html(res, runPage(readRun(root, run[1], run[2]), run[1], run[2], safeJoin(root, run[1], run[2])));
      const track = url.match(/^\/captions\/([^/]+)\/([^/]+)\/([^/]+)\.vtt$/);
      if (track) {
        const shown = readRun(root, track[1], track[2]);
        const video = (shown.media ?? []).find((m) => m.kind === "video" && m.file === track[3]);
        if (!video) return res.writeHead(404).end("Not found");
        return res.writeHead(200, { "content-type": "text/vtt; charset=utf-8" }).end(captionTrack(shown.steps, video));
      }
      const file = url.match(/^\/files\/([^/]+)\/([^/]+)\/([^/]+)$/);
      if (file && FILE_NAME.test(file[3]) && file[3] !== "run.json") return sendFile(req, res, safeJoin(root, file[1], file[2], file[3]));
      res.writeHead(404).end("Not found");
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain" }).end(String(/** @type {Error | undefined} */ (error)?.message ?? error));
    }
  });
  server.listen(port, host, () => console.log(`journeysfirst review: http://${host}:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}  (reading ${root})`));
  return server;
}

/**
 * Every run folder under root, newest first, in v1 terms.
 * @param {string} root
 * @returns {RunEntry[]}
 */
export function listRuns(root) {
  if (!existsSync(root)) return [];
  /** @type {RunEntry[]} */
  const runs = [];
  for (const journey of readdirSync(root)) {
    const journeyDir = join(root, journey);
    if (!statSync(journeyDir).isDirectory()) continue;
    for (const id of readdirSync(journeyDir)) {
      const path = join(journeyDir, id, "run.json");
      if (existsSync(path)) runs.push({ journey, id, run: forDisplay(JSON.parse(readFileSync(path, "utf8"))) });
    }
  }
  return runs.sort((a, b) => (b.run.started_at ?? "").localeCompare(a.run.started_at ?? ""));
}

/**
 * @param {string} root
 * @param {string} journey
 * @param {string} id
 */
function readRun(root, journey, id) {
  return forDisplay(JSON.parse(readFileSync(safeJoin(root, journey, id, "run.json"), "utf8")));
}

/**
 * A run as the rules say it stands, never as stored (see checkRun). Problems
 * from validation (against the journey when journeys/<name>.journey.yaml is
 * found) are kept to show on the page.
 * @param {any} raw a parsed run.json, not yet validated
 * @returns {ShownRun}
 */
export function forDisplay(raw) {
  if (Array.isArray(raw?.outcomes)) return { ...fromLegacy(raw), problems: [] };
  let journey = null;
  try {
    journey = findJourney(raw).journey;
  } catch {
    // An unreadable journey file only means the steps aren't compared.
  }
  const { run, problems } = checkRun(raw, journey ?? undefined);
  const steps = Array.isArray(run?.steps) ? run.steps.filter((s) => s && typeof s === "object") : [];
  // The run names its journey by file name; the journey file has the title a person wrote.
  const shown = journey?.title ? { ...run, journey: { ...run?.journey, title: journey.title } } : run;
  return { ...shown, steps, problems, ...(journey?.promise ? { promise: journey.promise } : {}) };
}

/**
 * A draft 0 run file (it has outcomes) in v1 field names, for display only:
 * each step is an action, followed by its outcomes as checks.
 * @param {any} run a parsed draft 0 run.json
 * @returns {ShownRun}
 */
export function fromLegacy(run) {
  if (!Array.isArray(run.outcomes)) return run;
  /** @type {Run["steps"]} */
  const steps = [];
  for (const step of run.steps ?? []) {
    steps.push({ says: step.says, by: "", status: step.status ?? "done", screenshots: step.screenshot ? [step.screenshot] : [] });
    for (const o of run.outcomes.filter((/** @type {any} */ x) => x.after === step.id)) {
      steps.push({ check: o.says, id: o.id, by: "", verdict: o.verdict, proof: o.detail ?? undefined, evidence: [] });
    }
  }
  return {
    format: run.format,
    legacy: true,
    id: run.id,
    journey: { name: run.journey?.id, version: run.journey?.version, case: null, title: run.journey?.title },
    result: runResult(steps),
    started_at: run.started_at ?? run.startedAt,
    finished_at: run.finished_at ?? run.finishedAt,
    ran_by: { agent: typeof run.agent === "string" ? run.agent : run.agent?.name },
    steps,
  };
}

/**
 * @param {string} root
 * @param {string[]} parts
 */
function safeJoin(root, ...parts) {
  const path = normalize(join(root, ...parts));
  if (path !== root && !path.startsWith(root + sep)) throw new Error("Path outside the runs folder.");
  return path;
}

/** @param {RunEntry[]} runs */
function indexPage(runs) {
  /** Repeated runs of one test, kept together under their first run's place. @type {Map<string, RunEntry[]>} */
  const batches = new Map();
  for (const entry of runs) {
    const batch = entry.run.repeat?.batch;
    if (batch) batches.set(batch, [...(batches.get(batch) ?? []), entry]);
  }
  const shown = new Set();
  const rows = runs
    .map((entry) => {
      const batch = entry.run.repeat?.batch;
      if (!batch) return runRow(entry);
      if (shown.has(batch)) return "";
      shown.add(batch);
      return batchRow(/** @type {RunEntry[]} */ (batches.get(batch)));
    })
    .join("");
  return layout("Journey runs", `<h1>Journey runs</h1>${rows || '<p class="empty">No runs yet. Run a journey and its run shows up here.</p>'}`);
}

/** Several runs of one journey: "4 of 5 runs passed", and a link to each run. @param {RunEntry[]} entries */
function batchRow(entries) {
  const sorted = [...entries].sort((a, b) => (a.run.repeat?.n ?? 0) - (b.run.repeat?.n ?? 0));
  const first = sorted[0];
  const { result, summary } = batchResult(sorted.map((e) => e.run), first.run.repeat?.of ?? sorted.length);
  const links = sorted
    .map(({ journey, id, run }) => `<a href="/runs/${esc(journey)}/${esc(id)}">${badge(run.result)} run ${esc(run.repeat?.n)}</a>`)
    .join(" ");
  return `<div class="row">
        <span class="title">${badge(result)} ${esc(title(first.run))}${first.run.journey?.case ? ` <span class="how">(${esc(first.run.journey.case)})</span>` : ""}</span>
        <span class="summary">${esc(summary)}</span>
        <span class="runs">${links}</span>
        ${indexMeta(first.run)}
      </div>`;
}

/** @param {RunEntry} entry */
function runRow({ journey, id, run }) {
  return `<a class="row" href="/runs/${esc(journey)}/${esc(id)}">
        <span class="title">${badge(run.result)} ${esc(title(run))}${run.journey?.case ? ` <span class="how">(${esc(run.journey.case)})</span>` : ""}${found(run)}</span>
        <span class="summary">${checkSummary(run)}</span>
        ${indexMeta(run)}
      </a>`;
}

/** @param {ShownRun} run */
function indexMeta(run) {
  const labels = [run.started_at && `Started: ${when(run.started_at)}`, run.ran_by?.agent && `Run by: ${run.ran_by.agent}`, run.legacy && "Draft 0",
    run.problems?.length && `${run.problems.length} problems in the run file`];
  return `<span class="meta row-meta">${labels.filter(Boolean).map((label) => `<span>${esc(label)}</span>`).join("")}</span>`;
}

/** @param {ShownRun} run */
function checkSummary(run) {
  const checks = run.steps.filter(isCheck);
  if (!checks.length) return "No checks recorded.";
  const passed = checks.filter((step) => step.verdict === "passed").length;
  const failed = checks.filter((step) => step.verdict === "failed").length;
  const remaining = checks.length - passed - failed;
  if (checks.length === 1) return `1 check ${passed ? "passed" : failed ? "failed" : "not verified"}.`;
  return `${passed} of ${checks.length} checks passed${failed ? `, ${failed} failed` : ""}${remaining ? `, ${remaining} not verified` : ""}.`;
}

/** @param {ShownRun} run */
function runDetails(run) {
  const people = new Set([...Object.keys(run.users ?? {}), ...Object.keys(run.played_by ?? {})]);
  const rows = [
    ["Started", when(run.started_at)],
    ["Run by", [run.ran_by?.agent, run.ran_by?.model].filter(Boolean).join(", ")],
    ["Case", run.journey?.case],
    ["Journey version", run.journey?.version],
    ...Object.entries(run.tags ?? {}),
    ...(run.repos ?? []).map((r) => ["Repository", `${r.repo}${r.branch ? ` ${r.branch}` : ""}${r.commit ? ` @ ${String(r.commit).slice(0, 7)}` : ""}`]),
    ...[...people].map((u) => [`Role: ${u === "you" ? "You" : u}`, [run.played_by?.[u] && `Played by ${run.played_by[u]}`, run.users?.[u] && `Account: ${run.users[u]}`].filter(Boolean).join(". ")]),
    ...Object.entries(run.values ?? {}).map(([name, v]) => [`\${${name}}`, v.secret ? "Hidden" : JSON.stringify(v.value)]),
  ].filter(([, value]) => value !== "" && value !== undefined);
  return rows.length ? `<details class="run-details"><summary>Run details</summary><dl>${rows.map(([name, value]) => `<dt>${esc(name)}</dt><dd>${esc(value)}</dd>`).join("")}</dl></details>` : "";
}

/**
 * @param {ShownRun} run
 * @param {string} journey
 * @param {string} id
 * @param {string} folder the run folder on disk, to say where its trace is
 */
function runPage(run, journey, id, folder) {
  /** @param {string | undefined} name */
  const fileUrl = (name) => `/files/${esc(journey)}/${esc(id)}/${esc(name)}`;
  const media = (run.media ?? []).filter((m) => m.kind === "video" && typeof m.tags?.user === "string");
  const videos = media.map((v) => ({ user: String(v.tags?.user), src: fileUrl(v.file), captions: `/captions/${esc(journey)}/${esc(id)}/${esc(v.file)}.vtt` }));
  const report = appReport(run, folder);
  const steps = run.steps.map((/** @type {StepFields} */ step, i) => {
    const at = videoAt(step, media);
    const card = stepCard(step, i + 1, fileUrl, Boolean(at)) + (report?.line === i + 1 ? reportedSection(report) : "");
    return { n: i + 1, text: String(step.check ?? step.says ?? ""), isCheck: isCheck(step), state: stepState(step), by: step.by || undefined, at: at?.seconds, card };
  });
  const openAt = (steps.find((s) => s.state === "failed") ?? steps.find((s) => s.isCheck && s.state !== "passed"))?.n ?? steps.length;
  return layout(
    title(run),
    `<p><a href="/">All runs</a></p>
     <h1>${esc(run.promise ?? title(run))}</h1>
     <p class="verdict-row">${badge(run.result)} <span class="summary">${checkSummary(run)}</span></p>
     ${run.problems?.length ? `<section class="problems"><p><b>This run file breaks the rules.</b> What is shown below is what the rules allow, not what the file claims.</p><ul>${run.problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></section>` : ""}
     ${findingsSection(run)}
     ${steps.length ? runPlayerHtml({ steps, videos, openAt }) : '<p class="empty">This run has no steps.</p>'}
     ${runDetails(run)}
     ${traceSection((run.media ?? []).filter((m) => m.kind === "trace"), folder, fileUrl)}
     ${reviewsSection(run)}
     <script>${RUN_PLAYER_SCRIPT}</script>`,
  );
}

/**
 * A step's details under the video: how it went, and how it was checked.
 * Its screenshots show when the step is not in a video, else they fold away.
 * @param {StepFields} step
 * @param {number} n
 * @param {(name: string | undefined) => string} fileUrl
 * @param {boolean} inVideo
 */
function stepCard(step, n, fileUrl, inVideo) {
  const state = stepState(step);
  const shots = (step.screenshots ?? []).map((s) => `<img src="${fileUrl(screenshotFile(s))}" alt="What ${esc(step.by || "the user")} saw at step ${n}"${screenshotPage(s) ? ` title="${esc(screenshotPage(s))}"` : ""}>`).join("");
  return `<p>${badge(state)}${step.added ? ' <span class="how">added by the agent</span>' : ""}</p>
    ${step.claimed ? `<p class="how">Claimed ${esc(step.claimed)}, but ${esc(lowerFirst(step.reason ?? "it had no evidence."))}</p>` : ""}
    ${step.reason && !step.claimed ? `<p class="error">${esc(step.reason)}</p>` : ""}
    ${step.cause && !step.claimed ? `<p class="how">Cause: ${esc(step.cause)}</p>` : ""}
    ${step.proof && step.proof !== step.reason ? `<p>${esc(step.proof)}</p>` : ""}
    ${evidenceList(step.evidence ?? [], { open: true, repeated: [step.reason, step.proof] })}
    ${shots ? (inVideo ? `<details><summary>Screenshot</summary>${shots}</details>` : shots) : ""}`;
}

/**
 * What the app reported at a failed run's first failed line, when the run has
 * a failure.json. Null when it has none or the file can't be read.
 * @param {ShownRun} run
 * @param {string} folder
 * @returns {AppReport | null}
 */
function appReport(run, folder) {
  if (!(run.media ?? []).some((m) => m.kind === "capture" && m.file === "failure.json")) return null;
  try {
    const report = JSON.parse(readFileSync(join(folder, "failure.json"), "utf8"));
    return Number.isInteger(report?.line) && Array.isArray(report.users) ? report : null;
  } catch {
    return null;
  }
}

/**
 * The "What the app reported" block under the failed step: one sentence, then
 * each user's failed requests, console errors, and a folded screen outline.
 * @param {AppReport} report
 */
function reportedSection(report) {
  const at = (/** @type {number|null} */ line) => (line === null ? "setup" : `line ${line}`);
  const users = report.users.map((/** @type {AppReport["users"][number]} */ shown) => {
    const u = { ...shown, requests: shown.requests ?? [], errors: shown.errors ?? [], outline: shown.outline ?? null };
    const requests = u.requests.map((r) => `<li>${esc(at(r.line))}: <b>${esc(r.status)}</b> ${esc(r.method)} <code>${esc(r.path)}</code></li>`);
    const errors = u.errors.map((e) => `<li>${esc(at(e.line))}: ${esc(e.text)}</li>`);
    if (u.more?.requests) requests.push(`<li class="how">and ${esc(u.more.requests)} earlier failed requests</li>`);
    if (u.more?.errors) errors.push(`<li class="how">and ${esc(u.more.errors)} earlier console errors</li>`);
    const nothing = !u.requests.length && !u.errors.length ? '<p class="empty">No failed requests or console errors.</p>' : "";
    const outline = u.outline === null ? '<p class="empty">The screen outline was not captured.</p>' : `<details><summary>What ${esc(u.user)} saw on screen</summary><pre>${esc(u.outline)}</pre></details>`;
    return `<div class="reported-user"><p><b>${esc(u.user)}</b></p>${nothing}${requests.length ? `<p class="how">Failed requests</p><ul class="evidence">${requests.join("")}</ul>` : ""}${errors.length ? `<p class="how">Console errors</p><ul class="evidence">${errors.join("")}</ul>` : ""}${outline}</div>`;
  });
  return `<section class="reported"><p class="how">What the app reported</p><p>${esc(report.summary)}</p>${users.join("")}</section>`;
}

/**
 * Each line in a video as a WebVTT captions track: from its time in the video
 * to the next line's, or to its own end for the last. A video recorded on a
 * page that refused the caption bar (Trusted Types) still has captions this way.
 * @param {StepFields[]} steps
 * @param {MediaItem} video
 * @returns {string}
 */
export function captionTrack(steps, video) {
  const start = video.starts_at ?? 0;
  const shown = steps.filter((step) => step.at !== undefined && step.at >= start);
  const cues = shown.map((step, i) => {
    const from = /** @type {number} */ (step.at) - start;
    const next = shown[i + 1]?.at;
    const to = next !== undefined ? next - start : from + Math.max(step.took ?? 0, 3);
    const label = LABELS[/** @type {keyof typeof LABELS} */ (step.verdict)] ?? step.verdict;
    const words = isCheck(step) ? `${label ? `${label}: ` : "Check: "}${step.check}` : `${step.by ? `${step.by}: ` : ""}${step.says}`;
    return `${cueTime(from)} --> ${cueTime(Math.max(to, from + 0.5))}\n${vttText(words)}`;
  });
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

/** @param {number} s */
const cueTime = (s) => {
  const ms = Math.round(s * 1000);
  const pad = (/** @type {number} */ n, /** @type {number} */ w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
};

/** Cue text: no markup, and never an arrow that would end the cue's line. @param {string} text */
const vttText = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\s*\n\s*/g, " ");

/** @param {unknown} value @param {ReadonlyArray<string | undefined>} repeated @returns {string} */
function evidenceValue(value, repeated) {
  if (value === undefined || (typeof value === "string" && repeated.includes(value))) return "";
  if (Array.isArray(value)) {
    if (!value.length) return "No items";
    const items = value.map((item) => evidenceValue(item, repeated)).filter(Boolean);
    return items.length ? `<ul class="evidence-values">${items.map((item) => `<li>${item}</li>`).join("")}</ul>` : "";
  }
  if (value && typeof value === "object") {
    const rows = Object.entries(value).map(([key, item]) => evidenceField(key.replace(/([a-z0-9])([A-Z])/g, "$1 $2"), item, repeated)).join("");
    return rows ? `<dl>${rows}</dl>` : Object.keys(value).length ? "" : "No fields";
  }
  return esc(value === null ? "null" : value === "" ? '""' : value);
}

/** @param {string} label @param {unknown} value @param {ReadonlyArray<string | undefined>} [repeated] @returns {string} */
function evidenceField(label, value, repeated = []) {
  const shown = evidenceValue(value, repeated);
  return shown ? `<dt>${esc(label)}</dt><dd>${shown}</dd>` : "";
}

/** @param {import("../format/runfile.js").Evidence[]} items @param {{open?: boolean, repeated?: ReadonlyArray<string | undefined>}} [options] */
function evidenceList(items, { open = false, repeated } = {}) {
  if (!items.length) return "";
  const rows = items.map((e) => {
    const fields = evidenceField("Query", e.query) + evidenceField("Address", e.url) + evidenceField("Expected", e.expected) +
      evidenceField("Got", e.got, repeated) + evidenceField("Observed", e.saw, repeated);
    return `<li><b>${esc(typeof e.source === "string" ? e.source.charAt(0).toUpperCase() + e.source.slice(1) : "Evidence")}</b>
    ${e.key !== undefined ? `<span class="how"> · Key: ${esc(e.key)}</span>` : e.login && e.login !== "you" ? `<span class="how"> · Login: ${esc(e.login)}</span>` : ""}
    ${fields ? `<dl>${fields}</dl>` : ""}
    <details><summary>Raw JSON</summary><pre>${esc(JSON.stringify(e, null, 2))}</pre></details></li>`;
  }).join("");
  return `<details${open ? " open" : ""}><summary>Evidence (${items.length})</summary><ul class="evidence">${rows}</ul></details>`;
}

/**
 * Each Playwright trace in the run, with the command that opens it. The page
 * has no trace viewer of its own.
 * @param {MediaItem[]} traces
 * @param {string} folder
 * @param {(name: string | undefined) => string} fileUrl
 */
function traceSection(traces, folder, fileUrl) {
  if (!traces.length) return "";
  const where = (/** @type {string} */ file) => {
    const path = relative(process.cwd(), join(folder, file));
    return path.startsWith("..") || isAbsolute(path) ? join(folder, file) : path;
  };
  const items = traces.map((t) => `<li><a href="${fileUrl(t.file)}" download>${esc(t.file)}</a><pre>npx playwright show-trace ${esc(where(t.file))}</pre></li>`).join("");
  return `<section class="start"><p class="how">Playwright trace</p><p>Every action, network call and console message in this run. Open it with:</p><ul class="evidence">${items}</ul><p class="how">A trace holds anything the page or the network saw, including tokens and personal data. Keep it on this machine. Publishing a run leaves its trace out.</p></section>`;
}

/**
 * What the review found, under the verdict. A finding never changes the verdict.
 * @param {ShownRun} run
 */
function findingsSection(run) {
  const head = '<section class="start" aria-label="Findings"><h2>Findings</h2>';
  if (!Array.isArray(run.findings)) return `${head}<p>Not reviewed.</p></section>`;
  const items = findingsOf(run);
  if (!items.length) return `${head}<p>Reviewed. Nothing found.</p></section>`;
  /** @type {Map<string, Finding[]>} */
  const groups = new Map([...Object.values(REVIEW_PASSES), "Questions"].map((name) => [name, []]));
  for (const f of items) {
    const word = String(f.criterion ?? "").split("-")[0];
    const name = f.ask !== undefined ? "Questions" : (Object.hasOwn(REVIEW_PASSES, word) ? /** @type {Record<string, string>} */ (REVIEW_PASSES)[word] : "Other");
    groups.set(name, [...(groups.get(name) ?? []), f]);
  }
  const reviews = reviewsOf(run);
  /** @param {Finding} f @param {string} group */
  const item = (f, group) => `<li>
      <p class="says">${esc(f.says)}</p>
      ${f.ask !== undefined ? `<p>${esc(f.ask)}</p>` : ""}
      ${f.step !== undefined ? `<p class="how"><a href="?step=${esc(f.step)}#steps">Step ${esc(f.step)}</a></p>` : ""}
      ${reviews.filter((r) => r.on === f.id).map((r) => `<p class="call"><b>${esc(r.by)}</b>: ${esc(r.says)} <span class="how">${esc(when(r.at))}</span></p>`).join("")}
      ${evidenceList(Array.isArray(f.evidence) ? f.evidence.filter((e) => e && typeof e === "object") : [])}
      <details><summary>Review criterion</summary><p>${esc(group)}: ${esc(f.criterion)}</p></details>
    </li>`;
  const body = [...groups].flatMap(([name, list]) => list.map((f) => item(f, name)));
  return `${head}<ul class="findings">${body.join("")}</ul></section>`;
}

/**
 * The run's findings that are objects. The file may not be valid, so nothing
 * else about them is assumed.
 * @param {ShownRun} run
 * @returns {Finding[]}
 */
const findingsOf = (run) => (Array.isArray(run.findings) ? run.findings.filter(isObject) : []);

/** The run's reviews that are objects, for the same reason. @param {ShownRun} run */
const reviewsOf = (run) => (Array.isArray(run.reviews) ? run.reviews.filter(isObject) : []);

/** @param {unknown} item */
const isObject = (item) => Boolean(item) && typeof item === "object" && !Array.isArray(item);

/** The count of findings beside a result, like "2 findings". @param {ShownRun} run */
const found = (run) => (reviewCountText(run) ? ` <span class="how found">${esc(reviewCountText(run))}</span>` : "");

/**
 * People's calls. A call on a finding shows the finding's sentence with its id.
 * @param {ShownRun} run
 */
function reviewsSection(run) {
  const reviews = reviewsOf(run);
  if (!reviews.length) return "";
  const sentence = new Map(findingsOf(run).map((f) => [f.id, f.says]));
  return `<section class="start"><p class="how">Reviews</p><ul>${reviews.map((r) => `<li><b>${esc(r.on)}</b>: ${esc(r.says)} <span class="how">${esc(r.by)}, ${esc(when(r.at))}${sentence.has(r.on) ? `. On: ${esc(sentence.get(r.on))}` : ""}</span></li>`).join("")}</ul></section>`;
}

const title = (/** @type {ShownRun} */ run) => runTitle(run);

/** @param {string | undefined} state */
function badge(state) {
  return state ? `<span class="verdict ${esc(state)}">${esc(LABELS[/** @type {keyof typeof LABELS} */ (state)] ?? state)}</span>` : "";
}

/** @param {string} text */
const lowerFirst = (text) => text.charAt(0).toLowerCase() + text.slice(1);
/** @param {string | undefined} iso */
const when = (iso) => (iso ? new Date(iso).toLocaleString() : "");

/**
 * @param {string} heading
 * @param {string} body
 */
function layout(heading, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(heading)}</title>
<style>
:root{--ink:#141516;--muted:#6b6d69;--rule:#e6e6e3;--tint:#f3f3f0;--pass:#0c7741;--fail:#a32057;--wait:#6b583c}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,sans-serif;color:var(--ink);background:#fff;line-height:1.45}
main{max-width:1180px;margin:0 auto;padding:32px 16px 64px}h1{font-size:30px;margin:8px 0 6px}a{color:var(--ink)}
.meta,.how,.empty{color:var(--muted);font-size:14px}
.row{display:flex;flex-direction:column;gap:4px;padding:16px 0;border-top:1px solid var(--rule);text-decoration:none}
.row .title{font-weight:600}
.row-meta{display:flex;flex-wrap:wrap;gap:4px 16px}a.row:hover .title{text-decoration:underline}
.runs{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:14px}.runs a{text-decoration:none}
.verdict{display:inline-block;font-size:12px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;padding:3px 8px;border-radius:999px;white-space:nowrap;color:var(--wait);background:var(--tint)}
.verdict.passed,.verdict.done{color:var(--pass);background:#e8f6ec}.verdict.failed{color:var(--fail);background:#fdebef}
img{width:100%;border:1px solid var(--rule);border-radius:12px;display:block;margin-top:8px}
${RUN_PLAYER_CSS}
button{font:inherit;font-size:13px;padding:2px 10px;border-radius:999px;border:0;background:var(--ink);color:#fff;cursor:pointer}
.error{color:var(--fail);font-size:14px}
.verdict-row{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.summary{font-weight:600}
.problems{border:1px solid var(--fail);border-radius:12px;padding:4px 16px;margin:12px 0;font-size:14px}.problems ul{padding-left:20px}
details{margin-top:6px;font-size:14px}summary{cursor:pointer;color:var(--muted)}
pre{background:var(--tint);border-radius:8px;padding:8px 10px;font-size:12px;overflow-x:auto;white-space:pre-wrap;word-break:break-word;margin:6px 0}
.evidence{list-style:none;padding:0;margin:6px 0}.evidence li{padding:6px 0;border-top:1px solid var(--rule)}
.evidence dl,.run-details dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;margin:6px 0}
.evidence dt,.run-details dt{font-weight:600}.evidence dd,.run-details dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}
.evidence dd dl{margin:0}.evidence ul.evidence-values{margin:0;padding-left:16px}.evidence-values li{padding:0;border:0}
.run-details{border-top:1px solid var(--rule);margin-top:20px;padding-top:8px}.run-details dl{max-width:620px}
.start{border-top:1px solid var(--rule);padding:8px 0}.start ul{margin:4px 0;padding-left:20px}
.start h2{font-size:17px;margin:4px 0}.found{font-weight:400}
.start .findings{list-style:none;padding:0;margin:4px 0 8px}.findings li{padding:10px 0;border-top:1px solid var(--rule)}.findings li:first-child{border-top:0}
.reported{border-top:1px solid var(--rule);margin-top:12px;padding-top:4px}.reported-user{padding:4px 0}.reported-user p{margin:4px 0}.reported code{font-size:13px;word-break:break-all}
.findings p{margin:2px 0}.findings .says{font-weight:600}.findings a{color:var(--muted)}
@media(max-width:600px){
  .evidence dl,.run-details dl{grid-template-columns:minmax(0,1fr);gap:2px}
  .evidence dt,.run-details dt{overflow-wrap:anywhere}
  .evidence dd+dt,.run-details dd+dt{margin-top:6px}
  .evidence dd dl{border-left:1px solid var(--rule);padding-left:10px}
}
</style></head><body><main>${body}</main></body></html>`;
}

/**
 * @param {Response} res
 * @param {string} body
 */
function html(res, body) {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
}

/** @type {Record<string, string>} */
const CONTENT_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".webm": "video/webm", ".mp4": "video/mp4", ".zip": "application/zip", ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8", ".html": "text/plain; charset=utf-8" };

// Videos need byte ranges, or the browser can't jump to a step's time.
/**
 * @param {Request} req
 * @param {Response} res
 * @param {string} path
 */
function sendFile(req, res, path) {
  const bytes = readFileSync(path);
  const type = CONTENT_TYPES[extname(path)] ?? "application/octet-stream";
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (!range) return res.writeHead(200, { "content-type": type, "accept-ranges": "bytes" }).end(bytes);
  const start = range[1] ? Number(range[1]) : 0;
  const end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
  res.writeHead(206, { "content-type": type, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${bytes.length}` }).end(bytes.subarray(start, end + 1));
}

// Local review UI: serves the run folders written by the reporter or RunRecorder.
//   /                      every run, newest first
//   /runs/<journey>/<run>  one run: the promise, whether it held, and the run player (see run-player.js)
//   /captions/<journey>/<run>/<video>.vtt  each line of a video as a captions track
// Reads run results v1. Older run files (draft 0) are shown in v1 terms.
import { createServer } from "node:http";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { hostAllowed, wrongHostMessage } from "../shared/local-host.js";
import { checkRun } from "../format/run-check.js";
import { findJourney } from "../format/run-folder.js";
import { REVIEW_PASSES, batchResult, esc, isCheck, reviewCountText, runTitle, screenshotFile, screenshotPage, stepState, videoAt } from "../shared/display.js";
import { FILE_NAME, runResult } from "../format/runfile.js";
import { VERSION } from "../shared/version.js";
import { RUN_PLAYER_SCRIPT, runPlayerHtml } from "./run-player.js";
import { badge } from "./primitives.js";
import { PAGE_CSS } from "./style.js";
import { FONTS, MARK } from "./tokens.js";
import { readSession, sessionHtml } from "./session.js";
import { transcriptPanels } from "./transcripts.js";
import { captionTrack, videoHolds } from "./video-lines.js";

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
 * @param {{followSymlinks?: boolean}} [options]
 * @returns {RunEntry[]}
 */
export function listRuns(root, { followSymlinks = true } = {}) {
  if (!existsSync(root)) return [];
  /** @type {RunEntry[]} */
  const runs = [];
  for (const journey of readdirSync(root)) {
    const journeyDir = join(root, journey);
    if (!(followSymlinks ? statSync(journeyDir) : lstatSync(journeyDir)).isDirectory()) continue;
    for (const id of readdirSync(journeyDir)) {
      const folder = join(journeyDir, id);
      if (!followSymlinks && !lstatSync(folder).isDirectory()) continue;
      const path = join(folder, "run.json");
      if (followSymlinks ? existsSync(path) : lstatSync(path, { throwIfNoEntry: false })?.isFile()) {
        runs.push({ journey, id, run: forDisplay(JSON.parse(readFileSync(path, "utf8"))) });
      }
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

/** @param {RunEntry[]} runs @param {(journey: string, id: string) => string} runUrl */
export function indexPage(runs, runUrl = (journey, id) => `/runs/${encodeURIComponent(journey)}/${encodeURIComponent(id)}`) {
  /** Repeated runs of one test, kept together under their first run's place. @type {Map<string, RunEntry[]>} */
  const batches = new Map();
  for (const entry of runs) {
    const batch = entry.run.repeat?.batch;
    if (batch) batches.set(batch, [...(batches.get(batch) ?? []), entry]);
  }
  const shown = new Set();
  let day = "";
  const rows = runs
    .map((entry) => {
      const batch = entry.run.repeat?.batch;
      if (batch && shown.has(batch)) return "";
      if (batch) shown.add(batch);
      const row = batch ? batchRow(/** @type {RunEntry[]} */ (batches.get(batch)), runUrl) : runRow(entry, runUrl);
      // A band names the day above the first run of that day.
      const started = dayOf(entry.run.started_at);
      const band = started && started !== day ? `<div class="day">${esc(started)}</div>` : "";
      day = started || day;
      return band + row;
    })
    .join("");
  const failed = runs.filter((entry) => entry.run.result === "failed").length;
  const heading = runs.length ? `${runs.length} ${runs.length === 1 ? "run" : "runs"}${failed ? `, ${failed} failed` : ""}` : "Journey runs";
  return layout("Journey runs", `<h1>${heading}</h1>${rows ? `<div class="rows">${rows}</div>` : '<p class="empty">No runs yet. Run a journey and its run shows up here.</p>'}`, [{ text: "Journey runs" }]);
}

/** @param {RunEntry[]} entries @param {(journey: string, id: string) => string} runUrl */
function batchRow(entries, runUrl) {
  const sorted = [...entries].sort((a, b) => (a.run.repeat?.n ?? 0) - (b.run.repeat?.n ?? 0));
  const first = sorted[0];
  const { result, summary } = batchResult(sorted.map((e) => e.run), first.run.repeat?.of ?? sorted.length);
  const links = sorted
    .map(({ journey, id, run }) => `<a href="${esc(runUrl(journey, id))}">${badge(run.result)} run ${esc(run.repeat?.n)}</a>`)
    .join(" ");
  return `<div class="row">
        <span class="title">${badge(result)} ${esc(title(first.run))}${first.run.journey?.case ? ` <span class="how">(${esc(first.run.journey.case)})</span>` : ""}</span>
        <span class="summary">${esc(summary)}</span>
        <span class="runs">${links}</span>
        ${indexMeta(first.run)}
      </div>`;
}

/** @param {RunEntry} entry @param {(journey: string, id: string) => string} runUrl */
function runRow({ journey, id, run }, runUrl) {
  return `<a class="row" href="${esc(runUrl(journey, id))}">
        <span class="title">${badge(run.result)} ${esc(title(run))}${run.journey?.case ? ` <span class="how">(${esc(run.journey.case)})</span>` : ""}${found(run)}</span>
        <span class="summary">${checkSummary(run)}</span>
        ${indexMeta(run)}
      </a>`;
}

/** @param {ShownRun} run */
function indexMeta(run) {
  // The day is in the band above the row, so the row has only the time.
  const labels = [run.started_at && new Date(run.started_at).toLocaleTimeString(), run.ran_by?.agent, run.legacy && "Draft 0",
    run.problems?.length && `${run.problems.length} problems in the run file`];
  return `<span class="meta row-meta">${labels.filter(Boolean).map((label) => `<span>${esc(label)}</span>`).join("")}</span>`;
}

/** @param {ShownRun} run */
function checkSummary(run) {
  const checks = run.steps.filter(isCheck);
  if (!checks.length) return "No checks recorded.";
  const passed = checks.filter((step) => step.verdict === "passed").length;
  const failed = checks.filter((step) => step.verdict === "failed").length;
  const blocked = checks.filter((step) => step.verdict === "blocked").length;
  const unverified = checks.length - passed - failed - blocked;
  if (checks.length === 1) return `1 check ${passed ? "passed" : failed ? "failed" : blocked ? "blocked" : "not verified"}.`;
  const counts = [`${passed} of ${checks.length} checks passed`];
  if (failed) counts.push(`${failed} failed`);
  if (blocked) counts.push(`${blocked} blocked`);
  if (unverified) counts.push(`${unverified} not verified`);
  return counts.join(", ") + ".";
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
  return rows.length ? `<div class="run-details"><dl>${rows.map(([name, value]) => `<dt>${esc(name)}</dt><dd>${esc(value)}</dd>`).join("")}</dl></div>` : "";
}

/**
 * @param {ShownRun} run
 * @param {string} journey
 * @param {string} id
 * @param {string} folder the run folder on disk, to say where its trace is
 * @param {{file: (name: string | undefined) => string | undefined, captions: (name: string) => string | undefined, includeTranscripts?: boolean}} [assets] approved exported assets
 */
export function runPage(run, journey, id, folder, assets) {
  /** @param {string | undefined} name */
  const liveFile = (name) => `/files/${esc(journey)}/${esc(id)}/${esc(name)}`;
  const fileUrl = assets?.file ?? liveFile;
  const media = (run.media ?? []).filter((m) => m.kind === "video" && typeof m.tags?.user === "string" && fileUrl(m.file));
  const videos = media.map((v) => ({ user: String(v.tags?.user), src: /** @type {string} */ (fileUrl(v.file)),
    captions: assets ? assets.captions(v.file) : `/captions/${esc(journey)}/${esc(id)}/${esc(v.file)}.vtt`, holds: videoHolds(run.steps, v, fileUrl) }));
  const report = assets ? null : appReport(run, folder);
  const showTranscripts = !assets || assets.includeTranscripts;
  // An agent's run with no video shows its session where the video would be, with the files it kept as tabs beside it.
  const session = showTranscripts && !media.length ? readSession(run, folder) : null;
  /** @type {Array<{file: string, body: string, truncated: boolean}>} */
  const kept = [];
  const transcripts = showTranscripts ? transcriptPanels(run, folder, session ? { skip: session.file, kept } : {}) : new Map();
  const steps = run.steps.map((/** @type {StepFields} */ step, i) => {
    const at = videoAt(step, media);
    const shots = screenshots(step, i + 1, fileUrl);
    const card = stepCard(step, at || session ? shots : "") + (report?.line === i + 1 ? reportedSection(report) : "") + (transcripts.get(i + 1) ?? "");
    return { n: i + 1, text: String(step.check ?? step.says ?? ""), isCheck: isCheck(step), state: stepState(step), by: step.by || undefined, at: at?.seconds, card, shot: at || session ? undefined : shots || undefined };
  });
  const openAt = (steps.find((s) => s.state === "failed") ?? steps.find((s) => s.isCheck && s.state !== "passed"))?.n ?? steps.length;
  const repo = run.repos?.[0];
  const facts = [when(run.started_at), run.ran_by?.agent, repo && `${repo.branch ?? repo.repo}${repo.commit ? ` @ ${String(repo.commit).slice(0, 7)}` : ""}`, run.journey?.case && `case ${run.journey.case}`].filter(Boolean);
  const details = runDetails(run) + (transcripts.get(0) ?? "") + (assets ? "" : traceSection((run.media ?? []).filter((m) => m.kind === "trace"), folder, liveFile));
  const panels = [{ name: "findings", label: reviewCountText(run) || "Findings", html: findingsSection(run) + reviewsSection(run) }, ...(details ? [{ name: "details", label: "Run details", html: details }] : [])];
  return layout(
    title(run),
    `<section class="strip">
       <p class="verdict-row">${badge(run.result)} <span class="summary">${checkSummary(run)}</span> <span class="facts">${facts.map(esc).join(" · ")}</span></p>
       <h1>${esc(run.promise ?? title(run))}</h1>
     </section>
     ${run.problems?.length ? `<section class="problems"><p><b>This run file breaks the rules.</b> What is shown below is what the rules allow, not what the file claims.</p><ul>${run.problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></section>` : ""}
     ${steps.length ? runPlayerHtml({ steps, videos, openAt, panels, log: session ? sessionHtml(session, run.steps, kept) : "" }) : `<p class="empty">This run has no steps.</p>${panels.map((p) => p.html).join("")}`}
     <script>${RUN_PLAYER_SCRIPT}</script>`,
    [{ text: "All runs", href: assets ? "../../../index.html" : "/" }, { text: title(run) }, ...(run.started_at ? [{ text: when(run.started_at) }] : [])],
    true,
  );
}

/**
 * A step's screenshots, as HTML. Empty when it has none that can be shown.
 * @param {StepFields} step
 * @param {number} n
 * @param {(name: string | undefined) => string | undefined} fileUrl
 */
function screenshots(step, n, fileUrl) {
  return (step.screenshots ?? []).map((s) => {
    const url = fileUrl(screenshotFile(s));
    return url ? `<img src="${url}" alt="What ${esc(step.by || "the user")} saw at step ${n}"${screenshotPage(s) ? ` title="${esc(screenshotPage(s))}"` : ""}>` : "";
  }).join("");
}

/**
 * A step's details under its line: how it went, and how it was checked.
 * @param {StepFields} step
 * @param {string} folded the step's screenshots when it is in a video, where they fold away.
 *   A step in no video shows them where the video would be.
 */
function stepCard(step, folded) {
  return `${step.added ? '<p class="how">added by the agent</p>' : ""}
    ${step.claimed ? `<p class="how">Claimed ${esc(step.claimed)}, but ${esc(lowerFirst(step.reason ?? "it had no evidence."))}</p>` : ""}
    ${step.reason && !step.claimed ? `<p class="error">${esc(step.reason)}</p>` : ""}
    ${step.cause && !step.claimed ? `<p class="how">Cause: ${esc(step.cause)}</p>` : ""}
    ${step.proof && step.proof !== step.reason ? `<p>${esc(step.proof)}</p>` : ""}
    ${evidenceList(step.evidence ?? [], { open: true, repeated: [step.reason, step.proof] })}
    ${folded ? `<details><summary>Screenshot</summary>${folded}</details>` : ""}`;
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

/** @param {string} text */
const lowerFirst = (text) => text.charAt(0).toLowerCase() + text.slice(1);
/** @param {string | undefined} iso */
const when = (iso) => (iso ? new Date(iso).toLocaleString() : "");
/** The day a run started, like "Nov 25, 2026". @param {string | undefined} iso */
const dayOf = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "");

/**
 * @param {string} heading
 * @param {string} body
 * @param {Array<{text: string, href?: string}>} path where this page is, for the header bar. The last one is this page.
 * @param {boolean} [fit] the page fills one screen and its panels scroll, where a page otherwise scrolls as a whole
 */
function layout(heading, body, path, fit = false) {
  const crumbs = path.map(({ text, href }, i) => (href ? `<a href="${esc(href)}">${esc(text)}</a>` : `<span${i === path.length - 1 ? ' aria-current="page"' : ""}>${esc(text)}</span>`)).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(heading)}</title>
${FONTS}<style>${PAGE_CSS}</style></head><body${fit ? ' class="fit"' : ""}><div class="frame"><header class="bar"><span class="logo">${MARK}</span>${crumbs}</header><main>${body}</main><footer class="foot"><span>Santori Labs</span><span>journeysfirst ${VERSION}</span></footer></div></body></html>`;
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

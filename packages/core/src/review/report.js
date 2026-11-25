// A run folder as a single HTML file, and as markdown for a pull request.
// Both read the run file. Neither copies a video, a trace or a screenshot's
// bytes: the HTML points at the files beside it, and the markdown names checks.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readRunFolder } from "../format/run-folder.js";
import { LABELS, isCheck, screenshotFile, stepState } from "../shared/display.js";

/**
 * Write report.html into a run folder. Returns the file's path.
 * @param {string} folder
 * @returns {string}
 */
export function writeReport(folder) {
  const { run } = readRunFolder(folder);
  const file = join(folder, "report.html");
  writeFileSync(file, reportHtml(run));
  return file;
}

/**
 * The run as one HTML page. Screenshot images are relative paths in the same folder.
 * @param {import("../format/runfile.js").Run} run
 * @returns {string}
 */
export function reportHtml(run) {
  const title = `${run.journey.name}: ${label(run.result)}`;
  const steps = run.steps.map((step, index) => stepHtml(step, index + 1)).join("\n");
  const media = (run.media ?? []).map((item) => `<li><a href="${esc(item.file)}">${esc(item.file)}</a> (${esc(item.kind)})</li>`).join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
body{margin:0;padding:24px;font:16px/1.45 system-ui,sans-serif;color:#1c1c1c;background:#fff}
h1{font-size:22px;margin:0 0 8px}
.summary{margin:0 0 20px}
ol{padding:0;list-style:none}
li{border-top:1px solid #e4e4e4;padding:12px 0}
.state{font-size:12px;font-weight:700;letter-spacing:.03em;text-transform:uppercase}
.passed,.done{color:#0b7a3e}.failed{color:#b0124f}.blocked,.not_checked,.not_run,.not_fully_checked{color:#7a6440}
img{max-width:100%;height:auto;margin-top:8px;border:1px solid #e4e4e4}
</style>
</head>
<body>
<h1>${esc(run.journey.name)}</h1>
<p class="summary"><span class="state ${esc(run.result)}">${esc(label(run.result))}</span> ${esc(run.summary ?? "")}</p>
<ol>
${steps}
</ol>
${media ? `<h2>Files</h2><ul>${media}</ul>` : ""}
</body>
</html>
`;
}

/**
 * Markdown for a GitHub pull request comment. Text only: no images, video or traces.
 * @param {import("../format/runfile.js").Run} run
 * @returns {string}
 */
export function summaryMarkdown(run) {
  const head = `## ${run.journey.name}: ${label(run.result)}`;
  const summary = run.summary ? `\n\n${oneLine(run.summary)}` : "";
  const rows = run.steps.map((step, index) => {
    const name = isCheck(step) ? step.id : `step ${index + 1}`;
    const why = isCheck(step) && step.verdict === "passed" ? step.proof : step.reason;
    return `| ${cell(name)} | ${cell(label(stepState(step)))} | ${cell(why)} |`;
  });
  return `${head}${summary}\n\n| Line | Result | Why |\n| --- | --- | --- |\n${rows.join("\n")}\n`;
}

/**
 * @param {import("../format/runfile.js").ActionStep | import("../format/runfile.js").CheckStep} step
 * @param {number} n
 */
function stepHtml(step, n) {
  const state = stepState(step) ?? "";
  const text = isCheck(step) ? step.check : step.says;
  const why = isCheck(step) && step.verdict === "passed" ? step.proof : step.reason;
  const shots = (step.screenshots ?? []).map(screenshotFile).filter(Boolean);
  const images = shots.map((file) => `<img src="${esc(file)}" alt="${esc(text)}">`).join("");
  const id = isCheck(step) ? ` <code>${esc(step.id)}</code>` : "";
  return `<li>
<p><span class="state ${esc(state)}">${n}. ${esc(label(state))}</span>${id} ${esc(text)}</p>
${why ? `<p>${esc(why)}</p>` : ""}
${step.by ? `<p>${esc(step.by)}</p>` : ""}
${images}
</li>`;
}

/** @param {string|undefined} state */
function label(state) {
  return (state && LABELS[/** @type {keyof typeof LABELS} */ (state)]) || state || "";
}

/** @param {unknown} value */
function esc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** @param {unknown} value */
function cell(value) {
  return oneLine(value).replace(/\|/g, "\\|");
}

/** @param {unknown} value */
function oneLine(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").trim();
}

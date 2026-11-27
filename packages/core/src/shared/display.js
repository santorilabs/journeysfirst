// Helpers for showing a run, with no Node imports, so a browser can load them.
// The review UI, runAnswer and web apps use these.

/** What each verdict, status and result is called on a page. */
export const LABELS = {
  passed: "Passed",
  failed: "Failed",
  blocked: "Blocked",
  not_checked: "Not checked",
  not_fully_checked: "Not fully checked",
  done: "Done",
  not_run: "Not run",
};

/**
 * @typedef {string | {file: string, url?: string}} Screenshot
 * @typedef {{check: string, id: string, verdict: string, [field: string]: unknown}} CheckLike
 * @typedef {{file: string, kind: string, starts_at?: number, tags?: Record<string, unknown>}} MediaItem
 */

/**
 * A check step, as opposed to an action.
 * @param {unknown} step
 * @returns {step is import("../format/runfile.js").CheckStep}
 */
export const isCheck = (step) => Boolean(step) && typeof step === "object" && /** @type {{check?: unknown}} */ (step).check !== undefined;

/**
 * The file name of a screenshot item.
 * @param {Screenshot | undefined} item
 * @returns {string|undefined}
 */
export const screenshotFile = (item) => (typeof item === "string" ? item : item?.file);

/**
 * The full address of the page a screenshot shows, when the run recorded it.
 * @param {Screenshot | undefined} item
 * @returns {string|undefined}
 */
export const screenshotPage = (item) => (typeof item === "string" ? undefined : item?.url);

/**
 * A step's state: a check's verdict, or an action's status.
 * @param {{verdict?: string, status?: string, check?: unknown}} step
 * @returns {string|undefined}
 */
export const stepState = (step) => (isCheck(step) ? step.verdict : step.status);

/**
 * A run's title for a page: the journey's title when known, else its name made readable.
 * @param {{journey?: {name?: string, title?: string}}} run
 * @param {{title?: string} | null} [journey] the journey file, when known
 */
export function runTitle(run, journey) {
  const name = journey?.title ?? run.journey?.title ?? run.journey?.name ?? "Journey";
  return name.charAt(0).toUpperCase() + name.slice(1).replaceAll("-", " ");
}

/**
 * Seconds as m:ss.
 * @param {number} seconds
 */
export const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/**
 * How long a line stays up after an action, in ms, so a person watching can follow.
 * A paced video waits this long while it records. For any other video the review page waits, not the run.
 */
export const DEFAULT_PAUSE = 500;

/** After a check, its verdict stays up for this many pauses, so it can be read. */
export const CHECK_PAUSES = 5;

/**
 * The video of the user who did a step, and how far into it the step
 * starts. Undefined when the step has no time or that user has no video.
 * @param {{by?: string, at?: number}} step
 * @param {MediaItem[] | undefined} media the run's media
 * @returns {{user: string, file: string, seconds: number} | undefined}
 */
export function videoAt(step, media) {
  if (step.at === undefined || !step.by) return undefined;
  const video = (media ?? []).find((m) => m?.kind === "video" && m.tags?.user === step.by);
  return video ? { user: step.by, file: video.file, seconds: Math.max(0, step.at - (video.starts_at ?? 0)) } : undefined;
}

/**
 * Text made safe to put in HTML.
 * @param {unknown} value
 */
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => /** @type {Record<string, string>} */ ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/**
 * Each mark's place on a video of this length, from 0 to 1, in time order.
 * Marks closer than `gap` (a share of the line) are pushed apart so every
 * step keeps its own mark: steps that all happen in the first second sit side
 * by side at the start, not on top of each other. When there are more marks
 * than fit, they spread evenly over the whole line. It uses nothing outside
 * itself, so the review page's script can carry it as text.
 * @template {{n: number, seconds: number}} M
 * @param {M[]} marks
 * @param {number} seconds the video's length
 * @param {number} gap
 * @returns {(M & {at: number})[]}
 */
export function spreadMarks(marks, seconds, gap) {
  const sorted = [...marks].sort((a, b) => a.seconds - b.seconds || a.n - b.n);
  if (sorted.length > 1 && gap * (sorted.length - 1) > 1) gap = 1 / (sorted.length - 1);
  const at = sorted.map((m) => (seconds > 0 ? Math.min(1, Math.max(0, m.seconds / seconds)) : 0));
  for (let i = 1; i < at.length; i++) at[i] = Math.max(at[i], at[i - 1] + gap);
  for (let i = at.length - 1; i >= 0; i--) at[i] = Math.min(at[i], i === at.length - 1 ? 1 : at[i + 1] - gap);
  return sorted.map((m, i) => ({ ...m, at: Math.max(0, at[i]) }));
}

/**
 * How a batch of repeated runs went: it passed only if every run passed.
 * @param {Array<{result?: string}>} runs the batch's runs that were written
 * @param {number} of how many runs the batch asked for
 * @returns {{result: string, summary: string}}
 */
export function batchResult(runs, of) {
  const passed = runs.filter((r) => r.result === "passed").length;
  const missing = of - runs.length;
  const result = passed === of ? "passed" : runs.some((r) => r.result === "failed") ? "failed" : "not_fully_checked";
  return { result, summary: `${passed} of ${of} runs passed${missing > 0 ? `; ${missing} did not finish` : ""}.` };
}

/** The passes of a review, by the first word of a criterion's id, in the order a page shows them. */
export const REVIEW_PASSES = { file: "Journey file", intuitive: "Intuitive", simple: "Simple", foundation: "Right foundation" };

/**
 * What a review of the run found, counted. null when the run was not reviewed
 * (it has no findings list). An item with `ask` is a question, not a finding.
 * seen: how many items a person has made a call on, in `reviews`.
 * @param {{findings?: unknown, reviews?: unknown}} run
 * @returns {{findings: number, questions: number, seen: number} | null}
 */
export function reviewCounts(run) {
  if (!Array.isArray(run?.findings)) return null;
  const items = run.findings.filter((f) => f && typeof f === "object" && !Array.isArray(f));
  const reviewed = new Set((Array.isArray(run.reviews) ? run.reviews : []).map((r) => r?.on));
  const questions = items.filter((f) => f.ask !== undefined).length;
  return { findings: items.length - questions, questions, seen: items.filter((f) => reviewed.has(f.id)).length };
}

/**
 * The counts as words, like "2 findings, 1 question". Empty when the run was
 * not reviewed or the review found nothing.
 * @param {{findings?: unknown, reviews?: unknown}} run
 */
export function reviewCountText(run) {
  const counts = reviewCounts(run);
  if (!counts) return "";
  /** @param {number} n @param {string} word */
  const some = (n, word) => (n ? `${n} ${word}${n === 1 ? "" : "s"}` : "");
  return [some(counts.findings, "finding"), some(counts.questions, "question")].filter(Boolean).join(", ");
}

/**
 * One line on the run's review, for a terminal or a PR: "Not reviewed.",
 * "Review: nothing found." or "Review: 2 findings, 1 question, 1 seen by a person."
 * @param {{findings?: unknown, reviews?: unknown}} run
 */
export function reviewLine(run) {
  const counts = reviewCounts(run);
  if (!counts) return "Not reviewed.";
  const found = reviewCountText(run);
  return found ? `Review: ${found}${counts.seen ? `, ${counts.seen} seen by a person` : ""}.` : "Review: nothing found.";
}

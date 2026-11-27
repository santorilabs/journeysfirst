// A video's lines on the review page: where each line starts in the video,
// the captions track that says which line is in progress, and where the
// player holds a video that recorded with no waiting.
import { CHECK_PAUSES, DEFAULT_PAUSE, LABELS, isCheck, screenshotFile } from "../shared/display.js";

/**
 * @typedef {import("../shared/display.js").MediaItem} MediaItem
 * @typedef {import("./review.js").StepFields} StepFields
 */

/**
 * Each line a video shows, with where it starts in the video and where the next line starts, in seconds.
 * @param {StepFields[]} steps
 * @param {MediaItem} video
 */
function videoLines(steps, video) {
  const start = video.starts_at ?? 0;
  const shown = steps.filter((step) => step.at !== undefined && step.at >= start);
  return shown.map((step, i) => ({ step, from: /** @type {number} */ (step.at) - start, to: shown[i + 1]?.at === undefined ? undefined : /** @type {number} */ (shown[i + 1].at) - start }));
}

/** Whether the run waited after each line while this video recorded. A video from before the tag did. @param {MediaItem} video */
const isPaced = (video) => video.tags?.paced !== false;

/**
 * Each line in a video as a WebVTT captions track: from its time in the video
 * to the next line's, or to its own end for the last. In a paced video a line
 * stays at least half a second.
 * @param {StepFields[]} steps
 * @param {MediaItem} video
 * @returns {string}
 */
export function captionTrack(steps, video) {
  const least = isPaced(video) ? 0.5 : 0.001;
  const cues = videoLines(steps, video).map(({ step, from, to = from + Math.max(step.took ?? 0, 3) }) => {
    const label = LABELS[/** @type {keyof typeof LABELS} */ (step.verdict)] ?? step.verdict;
    const words = isCheck(step) ? `${label ? `${label}: ` : "Check: "}${step.check}` : `${step.by ? `${step.by}: ` : ""}${step.says}`;
    return `${cueTime(from)} --> ${cueTime(Math.max(to, from + least))}\n${vttText(words)}`;
  });
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

/**
 * Where the player holds a video that recorded with no waiting: just before each
 * line ends, for as long as a paced run waits there. Undefined for a paced video.
 * @param {StepFields[]} steps
 * @param {MediaItem} video
 * @param {(name: string | undefined) => string | undefined} fileUrl
 * @returns {import("./player.js").Hold[] | undefined}
 */
export function videoHolds(steps, video, fileUrl) {
  if (isPaced(video)) return undefined;
  return videoLines(steps, video).map(({ step, from, to = from + (step.took ?? 0) }) => ({
    // One video frame before the next line, so the line's own caption is still up.
    at: Math.round(Math.max(to - 0.04, (from + to) / 2) * 1000) / 1000,
    ms: DEFAULT_PAUSE * (isCheck(step) ? CHECK_PAUSES : 1),
    shot: step.by === video.tags?.user && step.screenshots?.length ? fileUrl(screenshotFile(step.screenshots[0])) : undefined,
  }));
}

/** @param {number} s */
const cueTime = (s) => {
  const ms = Math.round(s * 1000);
  const pad = (/** @type {number} */ n, /** @type {number} */ w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
};

/** Cue text: no markup, and never an arrow that would end the cue's line. @param {string} text */
const vttText = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\s*\n\s*/g, " ");

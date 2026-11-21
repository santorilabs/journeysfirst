/** What each verdict, status and result is called on a page. */
export declare const LABELS: {
    passed: string;
    failed: string;
    blocked: string;
    not_checked: string;
    not_fully_checked: string;
    done: string;
    not_run: string;
};
export type Screenshot = string | {
    file: string;
    url?: string;
};
export type CheckLike = {
    check: string;
    id: string;
    verdict: string;
    [field: string]: unknown;
};
export type MediaItem = {
    file: string;
    kind: string;
    starts_at?: number;
    tags?: Record<string, unknown>;
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
export declare const isCheck: (step: unknown) => step is import("../format/runfile.js").CheckStep;
/**
 * The file name of a screenshot item.
 * @param {Screenshot | undefined} item
 * @returns {string|undefined}
 */
export declare const screenshotFile: (item: Screenshot | undefined) => string | undefined;
/**
 * The full address of the page a screenshot shows, when the run recorded it.
 * @param {Screenshot | undefined} item
 * @returns {string|undefined}
 */
export declare const screenshotPage: (item: Screenshot | undefined) => string | undefined;
/**
 * A step's state: a check's verdict, or an action's status.
 * @param {{verdict?: string, status?: string, check?: unknown}} step
 * @returns {string|undefined}
 */
export declare const stepState: (step: {
    verdict?: string;
    status?: string;
    check?: unknown;
}) => string | undefined;
/**
 * A run's title for a page: the journey's title when known, else its name made readable.
 * @param {{journey?: {name?: string, title?: string}}} run
 * @param {{title?: string} | null} [journey] the journey file, when known
 */
export declare function runTitle(run: {
    journey?: {
        name?: string;
        title?: string;
    };
}, journey?: {
    title?: string;
} | null): string;
/**
 * Seconds as m:ss.
 * @param {number} seconds
 */
export declare const clock: (seconds: number) => string;
/**
 * The video of the user who did a step, and how far into it the step
 * starts. Undefined when the step has no time or that user has no video.
 * @param {{by?: string, at?: number}} step
 * @param {MediaItem[] | undefined} media the run's media
 * @returns {{user: string, file: string, seconds: number} | undefined}
 */
export declare function videoAt(step: {
    by?: string;
    at?: number;
}, media: MediaItem[] | undefined): {
    user: string;
    file: string;
    seconds: number;
} | undefined;
/**
 * Text made safe to put in HTML.
 * @param {unknown} value
 */
export declare function esc(value: unknown): string;
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
export declare function spreadMarks<M extends {
    n: number;
    seconds: number;
}>(marks: M[], seconds: number, gap: number): (M & {
    at: number;
})[];
/**
 * How a batch of repeated runs went: it passed only if every run passed.
 * @param {Array<{result?: string}>} runs the batch's runs that were written
 * @param {number} of how many runs the batch asked for
 * @returns {{result: string, summary: string}}
 */
export declare function batchResult(runs: Array<{
    result?: string;
}>, of: number): {
    result: string;
    summary: string;
};
/** The passes of a review, by the first word of a criterion's id, in the order a page shows them. */
export declare const REVIEW_PASSES: {
    file: string;
    intuitive: string;
    simple: string;
    foundation: string;
};
/**
 * What a review of the run found, counted. null when the run was not reviewed
 * (it has no findings list). An item with `ask` is a question, not a finding.
 * seen: how many items a person has made a call on, in `reviews`.
 * @param {{findings?: unknown, reviews?: unknown}} run
 * @returns {{findings: number, questions: number, seen: number} | null}
 */
export declare function reviewCounts(run: {
    findings?: unknown;
    reviews?: unknown;
}): {
    findings: number;
    questions: number;
    seen: number;
} | null;
/**
 * The counts as words, like "2 findings, 1 question". Empty when the run was
 * not reviewed or the review found nothing.
 * @param {{findings?: unknown, reviews?: unknown}} run
 */
export declare function reviewCountText(run: {
    findings?: unknown;
    reviews?: unknown;
}): string;
/**
 * One line on the run's review, for a terminal or a PR: "Not reviewed.",
 * "Review: nothing found." or "Review: 2 findings, 1 question, 1 seen by a person."
 * @param {{findings?: unknown, reviews?: unknown}} run
 */
export declare function reviewLine(run: {
    findings?: unknown;
    reviews?: unknown;
}): string;

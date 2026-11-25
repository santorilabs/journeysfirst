/** The most requests and the most console errors kept for each user. */
export declare const MOST_ITEMS = 10;
/** The most lines kept from a screen outline. */
export declare const OUTLINE_LINES = 40;
export type FailedRequest = {
    line: number | null;
    method: string;
    path: string;
    status: number;
};
export type ConsoleError = {
    line: number | null;
    text: string;
};
export type UserReport = {
    user: string;
    requests: FailedRequest[];
    errors: ConsoleError[];
    more?: {
        requests?: number;
        errors?: number;
    };
    outline: string | null;
};
export type FailureReport = {
    line: number;
    says: string;
    by: string;
    since: number;
    summary: string;
    users: UserReport[];
};
export type AppWatch = {
    requests: FailedRequest[];
    errors: ConsoleError[];
    clear: () => void;
};
export type CapturedUser = {
    user: string;
    requests: FailedRequest[];
    errors: ConsoleError[];
    outline: string | null;
};
export type Captured = {
    line: number;
    says: string;
    by: string;
    since: number;
    users: CapturedUser[];
};
/**
 * @typedef {{line: number|null, method: string, path: string, status: number}} FailedRequest
 *   line: the journey line in progress, or null for setup before the first line
 * @typedef {{line: number|null, text: string}} ConsoleError
 * @typedef {{user: string, requests: FailedRequest[], errors: ConsoleError[], more?: {requests?: number, errors?: number},
 *   outline: string|null}} UserReport outline: null when it was not captured (a closed page, or Playwright before 1.49)
 * @typedef {{line: number, says: string, by: string, since: number, summary: string, users: UserReport[]}} FailureReport
 *   line: the failing line. since: the first line the report covers.
 * @typedef {{requests: FailedRequest[], errors: ConsoleError[], clear: () => void}} AppWatch
 * @typedef {{user: string, requests: FailedRequest[], errors: ConsoleError[], outline: string|null}} CapturedUser
 * @typedef {{line: number, says: string, by: string, since: number, users: CapturedUser[]}} Captured
 */
/**
 * Start keeping what one user's pages report. lineNow says which journey
 * line is in progress. clear drops what was kept, after each check.
 * @param {import("@playwright/test").BrowserContext} context
 * @param {() => number|null} lineNow
 * @returns {AppWatch}
 */
export declare function watchApp(context: import("@playwright/test").BrowserContext, lineNow: () => number | null): AppWatch;
/**
 * What each user's pages reported since the last check, with a screen outline
 * of each page that is still open. Called while the pages are open.
 * @param {Map<string, {page: import("@playwright/test").Page, app: AppWatch}>} pages
 * @param {string[]} secrets declared secret values, covered on screen before the outline
 */
export declare function captureUsers(pages: Map<string, {
    page: import("@playwright/test").Page;
    app: AppWatch;
}>, secrets: string[]): Promise<CapturedUser[]>;
/**
 * A short text outline of what is on the user's screen, with password and
 * secret fields covered first. Null when it can't be read.
 * @param {import("@playwright/test").Page} page
 * @param {string[]} secrets
 * @returns {Promise<string|null>}
 */
export declare function screenOutline(page: import("@playwright/test").Page, secrets: string[]): Promise<string | null>;
/**
 * The report for a failing line, with every text redacted and masked.
 * @param {Captured & {redact: (text: string) => string}} input
 * @returns {FailureReport}
 */
export declare function failureReport({ line, says, by, since, users, redact }: Captured & {
    redact: (text: string) => string;
}): FailureReport;
/**
 * One plain sentence: the first thing to look at. A failed request at the
 * failing line comes first, then one earlier, then a console error.
 * @param {UserReport[]} users the user the line is about first
 * @param {number} line
 * @param {number} since
 */
export declare function summarize(users: UserReport[], line: number, since: number): string;
/**
 * The report as Markdown, for the agent that fixes the run.
 * @param {FailureReport} report
 */
export declare function failureMarkdown(report: FailureReport): string;
/**
 * A request's path with no query or fragment. A request to another origin
 * than the page keeps its origin, so a call to an API host is told apart.
 * @param {string} url
 * @param {string} [pageUrl]
 */
export declare function requestPath(url: string, pageUrl?: string): string;

// What the app reported to each user when a run fails: the requests that came
// back 4xx or 5xx, the console errors, and a short text outline of the screen.
// Only playwright.js uses it. It writes two files into the run folder:
//   failure.json  the report, for the review page
//   failure.md    the same report, for the agent that fixes the run (journey-fix)
// The report covers the failing line and the lines since the last check that
// ran before it, because the request that broke a check is often made by the
// action line before it. Headers and request bodies are never kept. A path
// keeps no query. Every text goes through the run's redaction and maskText.
import { MASK, applyMask, maskText, restoreMask } from "./mask.js";
import { userLabel } from "./captions.js";

/** The most requests and the most console errors kept for each user. */
export const MOST_ITEMS = 10;
/** The most lines kept from a screen outline. */
export const OUTLINE_LINES = 40;
/** The most characters kept from one console error. */
const ERROR_CHARS = 300;
/** How long the screen outline may take, in ms. A slow page gets no outline. */
const OUTLINE_MS = 2000;

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
export function watchApp(context, lineNow) {
  /** @type {AppWatch} */
  const watch = {
    requests: [],
    errors: [],
    clear: () => {
      watch.requests = [];
      watch.errors = [];
    },
  };
  context.on("response", (response) => {
    if (response.status() < 400) return;
    const request = response.request();
    watch.requests.push({ line: lineNow(), method: request.method(), path: requestPath(request.url(), frameUrl(request)), status: response.status() });
  });
  context.on("console", (message) => {
    if (message.type() === "error") watch.errors.push({ line: lineNow(), text: message.text() });
  });
  context.on("weberror", (error) => watch.errors.push({ line: lineNow(), text: String(error.error()?.message ?? error.error()) }));
  return watch;
}

/**
 * What each user's pages reported since the last check, with a screen outline
 * of each page that is still open. Called while the pages are open.
 * @param {Map<string, {page: import("@playwright/test").Page, app: AppWatch}>} pages
 * @param {string[]} secrets declared secret values, covered on screen before the outline
 */
export async function captureUsers(pages, secrets) {
  /** @type {CapturedUser[]} */
  const users = [];
  for (const [user, { page, app }] of pages) {
    users.push({ user, requests: [...app.requests], errors: [...app.errors], outline: await screenOutline(page, secrets) });
  }
  return users;
}

/**
 * A short text outline of what is on the user's screen, with password and
 * secret fields covered first. Null when it can't be read.
 * @param {import("@playwright/test").Page} page
 * @param {string[]} secrets
 * @returns {Promise<string|null>}
 */
export async function screenOutline(page, secrets) {
  const body = page.locator("body");
  // ariaSnapshot came in Playwright 1.49. On an older version there is no outline.
  if (typeof body.ariaSnapshot !== "function" || page.isClosed()) return null;
  let covered = false;
  try {
    covered = (await page.evaluate(applyMask, { secrets, mask: MASK })) === true;
    const outline = await body.ariaSnapshot({ timeout: OUTLINE_MS });
    const lines = outline.split("\n");
    return lines.length > OUTLINE_LINES ? [...lines.slice(0, OUTLINE_LINES), `(${lines.length - OUTLINE_LINES} more lines)`].join("\n") : outline;
  } catch {
    return null;
  } finally {
    if (covered) await page.evaluate(restoreMask).catch(() => {});
  }
}

/**
 * The report for a failing line, with every text redacted and masked.
 * @param {Captured & {redact: (text: string) => string}} input
 * @returns {FailureReport}
 */
export function failureReport({ line, says, by, since, users, redact }) {
  const clean = (/** @type {string} */ text) => maskText(redact(text));
  const shown = users.map(({ user, requests, errors, outline }) => {
    const more = { requests: Math.max(0, requests.length - MOST_ITEMS), errors: Math.max(0, errors.length - MOST_ITEMS) };
    /** @type {UserReport} */
    const report = {
      user,
      requests: requests.slice(-MOST_ITEMS).map((r) => ({ ...r, path: clean(r.path) })),
      errors: errors.slice(-MOST_ITEMS).map((e) => ({ ...e, text: clean(firstLine(e.text)).slice(0, ERROR_CHARS) })),
      outline: outline === null ? null : clean(outline),
    };
    if (more.requests || more.errors) report.more = { ...(more.requests ? { requests: more.requests } : {}), ...(more.errors ? { errors: more.errors } : {}) };
    return report;
  });
  // The user the line is about comes first.
  shown.sort((a, b) => Number(b.user === by) - Number(a.user === by));
  return { line, says: clean(says), by, since, summary: summarize(shown, line, since), users: shown };
}

/**
 * One plain sentence: the first thing to look at. A failed request at the
 * failing line comes first, then one earlier, then a console error.
 * @param {UserReport[]} users the user the line is about first
 * @param {number} line
 * @param {number} since
 */
export function summarize(users, line, since) {
  const where = (/** @type {number|null} */ at) => (at === line ? "at this line" : at === null ? "before the first line" : `at line ${at}`);
  const who = (/** @type {string} */ user) => (user === "you" ? "You" : `The ${user}`);
  const whose = (/** @type {string} */ user) => (user === "you" ? "Your" : `The ${user}'s`);
  for (const pick of [(/** @type {FailedRequest} */ r) => r.line === line, () => true]) {
    for (const { user, requests } of users) {
      const hit = [...requests].reverse().find(pick);
      if (hit) return `${who(user)} got a ${hit.status} from ${hit.method} ${hit.path} ${where(hit.line)}.`;
    }
  }
  for (const { user, errors } of users) {
    const hit = errors.at(-1);
    if (hit) return `${whose(user)} page logged an error ${where(hit.line)}.`;
  }
  return since === line ? "No user got a failed request or a console error at this line." : `No user got a failed request or a console error from line ${since} to this line.`;
}

/**
 * The report as Markdown, for the agent that fixes the run.
 * @param {FailureReport} report
 */
export function failureMarkdown(report) {
  const span = report.since === report.line ? `line ${report.line}` : `lines ${report.since} to ${report.line}`;
  const out = [
    `# What the app reported at line ${report.line}`,
    "",
    `Line ${report.line} (${report.by}): ${report.says}`,
    "",
    report.summary,
    "",
    `This covers ${span}, for every user. Request headers and bodies are not kept. Secrets are covered.`,
  ];
  for (const user of report.users) {
    out.push("", `## ${userLabel(user.user)}`, "");
    if (!user.requests.length && !user.errors.length) out.push("No failed requests or console errors.", "");
    if (user.requests.length) {
      out.push("Failed requests:", "");
      for (const r of user.requests) out.push(`- line ${r.line ?? "setup"}: ${r.status} ${r.method} ${r.path}`);
      if (user.more?.requests) out.push(`- and ${user.more.requests} earlier`);
      out.push("");
    }
    if (user.errors.length) {
      out.push("Console errors:", "");
      for (const e of user.errors) out.push(`- line ${e.line ?? "setup"}: ${e.text}`);
      if (user.more?.errors) out.push(`- and ${user.more.errors} earlier`);
      out.push("");
    }
    out.push(`What ${user.user} saw on screen at line ${report.line}:`, "");
    out.push(user.outline === null ? "Not captured." : ["```yaml", user.outline, "```"].join("\n"));
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/**
 * A request's path with no query or fragment. A request to another origin
 * than the page keeps its origin, so a call to an API host is told apart.
 * @param {string} url
 * @param {string} [pageUrl]
 */
export function requestPath(url, pageUrl) {
  try {
    const address = new URL(url);
    let origin = "";
    try {
      origin = pageUrl && new URL(pageUrl).origin === address.origin ? "" : address.origin;
    } catch {
      origin = address.origin;
    }
    return `${origin === "null" ? "" : origin}${address.pathname}`;
  } catch {
    return String(url).split(/[?#]/)[0];
  }
}

/**
 * The address of the page that made a request. A service worker's request has no page.
 * @param {import("@playwright/test").Request} request
 */
function frameUrl(request) {
  try {
    return request.frame().url();
  } catch {
    return undefined;
  }
}

/** @param {string} text */
const firstLine = (text) => String(text ?? "").split("\n")[0].trim();

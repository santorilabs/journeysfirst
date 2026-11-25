// What to say when a run has nowhere to open the app. init prints this when
// it cannot set baseURL and webServer. The Playwright fixture throws it
// before a relative address fails with a browser error.

/** Printed when a config sets neither use.baseURL nor webServer. */
export const MISSING_TARGET = [
  "This run has no baseURL and no webServer.",
  "Set use.baseURL in playwright.config.js to the app's address, like http://127.0.0.1:4321.",
  "Set webServer.command to the command that starts the app, and webServer.url to that same address.",
  "To see a passing run first, run: npx journeysfirst init --demo",
].join(" ");

/**
 * The message when neither an address nor a server is set. Null when a run can open a page.
 * @param {{baseURL?: unknown, webServer?: unknown}} [target]
 * @returns {string | null}
 */
export function missingTarget(target = {}) {
  const base = typeof target.baseURL === "string" && target.baseURL.trim().length > 0;
  const server = target.webServer != null && target.webServer !== false && !(Array.isArray(target.webServer) && target.webServer.length === 0);
  return base || server ? null : MISSING_TARGET;
}

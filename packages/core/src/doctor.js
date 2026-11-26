// doctor: is this repo ready to run a journey? Node, Playwright, its browser,
// the config, whether baseURL answers, and each journey file. Each check is
// one line. A failed check says what to do next.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadJourney, validateJourney } from "./format/format.js";
import { missingTarget } from "./shared/target.js";

const CONFIGS = ["js", "ts", "mjs", "cjs", "mts", "cts"].map((ext) => `playwright.config.${ext}`);
const MIN_NODE = 20;
const BROWSER_INSTALL = "npx playwright install --only-shell chromium";
const PLAYWRIGHT_INSTALL = "npm install --save-dev @playwright/test";

/**
 * @typedef {{ok: boolean, name: string, says: string}} DoctorLine
 * @typedef {{installed: boolean, browser: boolean, executablePath?: string, error?: string}} PlaywrightStatus
 * @typedef {{status?: number}} FetchReply
 */

/**
 * @param {{root?: string, node?: string, playwright?: () => Promise<PlaywrightStatus>, fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<{ok: boolean, lines: DoctorLine[]}>}
 */
export async function doctor({ root = process.cwd(), node = process.versions.node, playwright = detectPlaywright, fetchImpl = globalThis.fetch } = {}) {
  const terminal = existsSync(join(root, ".journeysfirst-terminal"));
  const lines = [
    nodeLine(node),
    ...(terminal ? [{ ok: true, name: "Terminal", says: "Terminal mode. Browser and Playwright config checks are skipped." }]
      : [...await playwrightLines(playwright), ...await configLines(root, fetchImpl)]),
    ...journeyLines(root),
  ];
  return { ok: lines.every((line) => line.ok), lines };
}

/**
 * @param {string} node
 * @returns {DoctorLine}
 */
function nodeLine(node) {
  const major = Number(String(node).split(".")[0]);
  if (major >= MIN_NODE) return { ok: true, name: "Node", says: `v${node}. This package needs Node ${MIN_NODE} or newer.` };
  return { ok: false, name: "Node", says: `v${node} is older than ${MIN_NODE}. Install Node ${MIN_NODE} or newer.` };
}

/**
 * @param {() => Promise<PlaywrightStatus>} playwright
 * @returns {Promise<DoctorLine[]>}
 */
async function playwrightLines(playwright) {
  let status;
  try {
    status = await playwright();
  } catch (error) {
    status = { installed: false, browser: false, error: /** @type {Error} */ (error).message };
  }
  if (!status.installed) {
    return [{ ok: false, name: "Playwright", says: `Playwright is not installed, so no journey can run. Install it: ${PLAYWRIGHT_INSTALL}` }];
  }
  if (!status.browser) {
    return [
      { ok: true, name: "Playwright", says: "@playwright/test is installed." },
      { ok: false, name: "Browser", says: `Chromium is not installed. Run: ${BROWSER_INSTALL}` },
    ];
  }
  return [
    { ok: true, name: "Playwright", says: "@playwright/test is installed." },
    { ok: true, name: "Browser", says: `Chromium is installed${status.executablePath ? ` at ${status.executablePath}` : ""}.` },
  ];
}

/** @returns {Promise<PlaywrightStatus>} */
async function detectPlaywright() {
  try {
    const { chromium } = await import("@playwright/test");
    const executablePath = chromium.executablePath();
    return { installed: true, browser: existsSync(executablePath), executablePath };
  } catch (error) {
    return { installed: false, browser: false, error: /** @type {Error} */ (error).message };
  }
}

/**
 * @param {string} root
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<DoctorLine[]>}
 */
async function configLines(root, fetchImpl) {
  const name = CONFIGS.find((file) => existsSync(join(root, file)));
  if (!name) return [{ ok: false, name: "Config", says: "No playwright.config.js. Run npx journeysfirst init." }];
  /** @type {{use?: {baseURL?: unknown}, webServer?: unknown} | null} */
  let config = null;
  let error = "";
  if (name.endsWith(".js") || name.endsWith(".mjs")) {
    try {
      const loaded = await import(pathToFileURL(join(root, name)).href);
      config = loaded.default ?? null;
    } catch (thrown) {
      error = /** @type {Error} */ (thrown).message;
    }
  }
  if (!config) {
    const text = readFileSync(join(root, name), "utf8");
    const gap = missingTarget({ baseURL: /\bbaseURL\s*:/.test(text) ? "set" : "", webServer: /\bwebServer\s*:/.test(text) ? {} : undefined });
    if (name.endsWith(".ts") || name.endsWith(".mts") || name.endsWith(".cts")) {
      return [{ ok: !gap, name: "Config", says: gap ?? `${name} sets baseURL or webServer. doctor cannot open a TypeScript config to try the address. Run npx playwright test.` }];
    }
    return [{ ok: false, name: "Config", says: error ? `${name} did not load. ${error}` : (gap ?? `${name} has no baseURL to try.`) }];
  }
  const gap = missingTarget({ baseURL: config.use?.baseURL, webServer: config.webServer });
  if (gap) return [{ ok: false, name: "Config", says: `${name}: ${gap}` }];
  const baseURL = typeof config.use?.baseURL === "string" && config.use.baseURL ? config.use.baseURL : serverUrl(config.webServer);
  return [
    { ok: true, name: "Config", says: `${name} is set.` },
    await reachLine(baseURL, config.webServer != null && config.webServer !== false, fetchImpl),
  ];
}

/** @param {unknown} webServer @returns {string} */
function serverUrl(webServer) {
  const one = Array.isArray(webServer) ? webServer[0] : webServer;
  return one && typeof one === "object" && "url" in one && typeof one.url === "string" ? one.url : "";
}

/**
 * @param {string} baseURL
 * @param {boolean} webServer
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<DoctorLine>}
 */
async function reachLine(baseURL, webServer, fetchImpl) {
  if (!/^https?:\/\//.test(baseURL)) return { ok: false, name: "baseURL", says: `baseURL must be an http address. It is ${JSON.stringify(baseURL)}.` };
  try {
    const reply = /** @type {FetchReply} */ (await fetchImpl(baseURL, { signal: AbortSignal.timeout(2000), redirect: "manual" }));
    return { ok: true, name: "baseURL", says: `${baseURL} answered ${reply.status ?? "ok"}.` };
  } catch {
    if (webServer) return { ok: true, name: "baseURL", says: `${baseURL} did not answer. webServer is set, so Playwright starts it for a run.` };
    return { ok: false, name: "baseURL", says: `${baseURL} did not answer. Start the app, or set webServer.command to the command that starts it.` };
  }
}

/**
 * @param {string} root
 * @returns {DoctorLine[]}
 */
function journeyLines(root) {
  const dir = join(root, "journeys");
  const files = filesUnder(dir).filter((file) => file.endsWith(".journey.yaml") || file.endsWith(".journey.yml"));
  if (!files.length) return [{ ok: false, name: "Journeys", says: "No journey files in journeys/. Run npx journeysfirst init --demo, or follow journey-onboard." }];
  /** @type {DoctorLine[]} */
  const problems = [];
  for (const file of files) {
    const shown = file.slice(root.length + 1);
    try {
      const found = validateJourney(loadJourney(file));
      if (found.length) problems.push({ ok: false, name: shown, says: found.join(" ") });
    } catch (error) {
      problems.push({ ok: false, name: shown, says: /** @type {Error} */ (error).message });
    }
  }
  if (problems.length) return problems;
  return [{ ok: true, name: "Journeys", says: `${files.length} journey ${files.length === 1 ? "file is" : "files are"} valid.` }];
}

/** @param {string} dir @returns {string[]} */
function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const found = [];
  const walk = (/** @type {string} */ current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const file = join(current, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) found.push(file);
    }
  };
  walk(dir);
  return found.sort();
}

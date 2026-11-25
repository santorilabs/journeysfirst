// The first run on a fresh repo: init's example passes in a real browser, and
// a config with neither baseURL nor webServer fails with what to set.
// Needs Playwright's Chromium (npx playwright install --only-shell chromium).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadJourney, validateJourney } from "../src/format/format.js";
import { readRunFolder } from "../src/format/run-folder.js";
import { init } from "../src/setup.js";
import { MISSING_TARGET, missingTarget } from "../src/shared/target.js";

const PLAYWRIGHT = new URL("../../../node_modules/@playwright/test/cli.js", import.meta.url).pathname;
const REPO_MODULES = new URL("../../../node_modules", import.meta.url).pathname;
const CORE = new URL("..", import.meta.url).pathname;

test("missingTarget is set only when both baseURL and webServer are absent", () => {
  assert.equal(missingTarget({}), MISSING_TARGET);
  assert.equal(missingTarget({ baseURL: "  ", webServer: [] }), MISSING_TARGET);
  assert.equal(missingTarget({ webServer: false }), MISSING_TARGET);
  assert.equal(missingTarget({ baseURL: "http://127.0.0.1:4321" }), null);
  assert.equal(missingTarget({ webServer: { command: "npm start" } }), null);
  assert.match(MISSING_TARGET, /Set use\.baseURL/);
  assert.match(MISSING_TARGET, /npx journeysfirst init --demo/);
});

test("init on a fresh repo writes an example journey that passes", () => {
  const dir = fresh();
  const changes = init({ root: dir });
  assert.ok(changes.some((line) => line.startsWith("added e2e/see-the-example.spec.js")), changes.join("\n"));
  const journey = loadJourney(join(dir, "journeys/see-the-example.journey.yaml"));
  assert.deepEqual(validateJourney(journey), []);
  const port = String(20000 + Math.floor(Math.random() * 20000));
  const result = playwright(dir, { JOURNEYS_PORT: port });
  assert.equal(result.status, 0, result.output);
  const runs = join(dir, "journey-runs/see-the-example");
  const ids = existsSync(runs) ? readdirSync(runs) : [];
  assert.equal(ids.length, 1, result.output);
  const { run } = readRunFolder(join(runs, ids[0]), { journey });
  assert.equal(run.result, "passed");
  assert.deepEqual(run.verified, ["You see \"You are in.\""]);
});

test("a journey with neither baseURL nor webServer fails with what to set", () => {
  const dir = fresh();
  mkdirSync(join(dir, "journeys"), { recursive: true });
  mkdirSync(join(dir, "e2e"), { recursive: true });
  writeFileSync(join(dir, "journeys/own.journey.yaml"), "format: journeysfirst/v1\ntitle: Open the page\npromise: You can open the page.\nstart: The page is what the browser will open.\nsteps:\n  - Open the page.\n");
  writeFileSync(join(dir, "e2e/own.spec.js"), `import { test } from "journeysfirst/playwright";
test.journey("journeys/own.journey.yaml", { video: false, measure: false }, async ({ journey }) => {
  const page = await journey.page("you");
  await journey.step("Open the page.", { by: "you" }, async () => { await page.goto("/"); });
});
`);
  const changes = init({ root: dir });
  assert.ok(changes.some((line) => line.includes(MISSING_TARGET)), changes.join("\n"));
  assert.ok(!existsSync(join(dir, "demo")));
  const result = playwright(dir, {});
  assert.notEqual(result.status, 0);
  assert.match(result.output, /This run has no baseURL and no webServer/);
  assert.match(result.output, /npx journeysfirst init --demo/);
  assert.doesNotMatch(result.output, /was not able to start/);
});

/** @returns {string} a temp repo whose node_modules can load this package and Playwright */
function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "jf-first-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fresh", private: true, type: "module" }));
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  symlinkSync(CORE, join(dir, "node_modules/journeysfirst"));
  symlinkSync(join(REPO_MODULES, "@playwright"), join(dir, "node_modules/@playwright"));
  return dir;
}

/** @param {string} cwd @param {Record<string, string>} env */
function playwright(cwd, env) {
  const result = spawnSync(process.execPath, [PLAYWRIGHT, "test"], {
    cwd,
    env: { ...process.env, ...env, CI: "1" },
    encoding: "utf8",
    timeout: 120_000,
  });
  return { status: result.status, output: result.stdout + result.stderr };
}

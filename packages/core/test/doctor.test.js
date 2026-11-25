import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { doctor } from "../src/doctor.js";

const BIN = new URL("../bin/journeysfirst.js", import.meta.url).pathname;
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-doctor-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
  return dir;
};
const says = (/** @type {{lines: {name: string, says: string, ok: boolean}[]}} */ result, name) => result.lines.find((line) => line.name === name);

test("doctor reports an old Node, a missing browser, a config with no target, and no journeys", async () => {
  const result = await doctor({
    root: repo(),
    node: "18.20.0",
    playwright: async () => ({ installed: true, browser: false }),
  });
  assert.equal(result.ok, false);
  assert.match(says(result, "Node").says, /older than 20/);
  assert.match(says(result, "Browser").says, /npx playwright install --only-shell chromium/);
  assert.match(says(result, "Config").says, /npx journeysfirst init/);
  assert.match(says(result, "Journeys").says, /npx journeysfirst init --demo/);
});

test("doctor names the install command when Playwright is missing, and does not also ask for the browser", async () => {
  const result = await doctor({ root: repo(), node: "22.0.0", playwright: async () => ({ installed: false, browser: false }) });
  assert.match(says(result, "Playwright").says, /npm install --save-dev @playwright\/test/);
  assert.equal(says(result, "Browser"), undefined);
});

test("a valid journey and a baseURL that answers is ok, and a down address with webServer is still ok", async () => {
  const up = repo();
  writeJourney(up, "format: journeysfirst/v1\ntitle: Open\npromise: You can open it.\nstart: The page is up.\nsteps:\n  - Open it.\n  - check: The page is open.\n    id: open\n");
  writeFileSync(join(up, "playwright.config.js"), "export default { use: { baseURL: 'http://127.0.0.1:4321' }, webServer: { command: 'node demo/serve.mjs', url: 'http://127.0.0.1:4321' } };\n");
  const ready = await doctor({
    root: up,
    node: "20.0.0",
    playwright: async () => ({ installed: true, browser: true, executablePath: "/browsers/chromium" }),
    fetchImpl: async () => ({ status: 200 }),
  });
  assert.equal(ready.ok, true, ready.lines.map((line) => line.says).join("\n"));
  assert.match(says(ready, "baseURL").says, /answered 200/);
  assert.match(says(ready, "Journeys").says, /1 journey file is valid/);

  const down = repo();
  writeJourney(down, "format: journeysfirst/v1\ntitle: Open\npromise: You can open it.\nstart: The page is up.\nsteps:\n  - Open it.\n  - check: The page is open.\n    id: open\n");
  writeFileSync(join(down, "playwright.config.js"), "export default { use: { baseURL: 'http://127.0.0.1:9' }, webServer: { command: 'npm start' } };\n");
  const waiting = await doctor({
    root: down,
    node: "22.1.0",
    playwright: async () => ({ installed: true, browser: true }),
    fetchImpl: async () => { throw new Error("connect"); },
  });
  assert.equal(waiting.ok, true, waiting.lines.map((line) => `${line.ok} ${line.says}`).join("\n"));
  assert.match(says(waiting, "baseURL").says, /did not answer. webServer is set/);
});

test("a baseURL that does not answer, with no webServer, fails and says to start the app", async () => {
  const dir = repo();
  writeJourney(dir, "format: journeysfirst/v1\ntitle: Open\npromise: You can open it.\nstart: The page is up.\nsteps:\n  - Open it.\n  - check: The page is open.\n    id: open\n");
  writeFileSync(join(dir, "playwright.config.js"), "export default { use: { baseURL: 'http://127.0.0.1:9' } };\n");
  const result = await doctor({
    root: dir,
    node: "22.0.0",
    playwright: async () => ({ installed: true, browser: true }),
    fetchImpl: async () => { throw new Error("connect"); },
  });
  assert.equal(result.ok, false);
  assert.match(says(result, "baseURL").says, /did not answer. Start the app/);
});

test("an invalid journey is named, and the other checks can still pass", async () => {
  const dir = repo();
  writeJourney(dir, "format: journeysfirst/v1\ntitle: Open\nsteps:\n  - Open it.\n");
  writeFileSync(join(dir, "playwright.config.js"), "export default { use: { baseURL: 'http://127.0.0.1:4321' }, webServer: { url: 'http://127.0.0.1:4321' } };\n");
  const result = await doctor({
    root: dir,
    node: "22.0.0",
    playwright: async () => ({ installed: true, browser: true }),
    fetchImpl: async () => ({ status: 200 }),
  });
  assert.equal(result.ok, false);
  assert.match(says(result, "journeys/open.journey.yaml").says, /promise is missing/);
});

test("the doctor command prints each check and exits 1 when a journey is missing", () => {
  const dir = repo();
  const res = spawnSync(process.execPath, [BIN, "doctor"], { cwd: dir, encoding: "utf8" });
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /ok Node: v\d+/);
  assert.match(res.stdout, /NO Journeys: No journey files in journeys\//);
  assert.match(res.stdout, /NO Config: No playwright.config.js/);
  assert.match(res.stdout, /Fix the lines marked NO/);
});

/** @param {string} dir @param {string} yaml */
function writeJourney(dir, yaml) {
  mkdirSync(join(dir, "journeys"), { recursive: true });
  writeFileSync(join(dir, "journeys/open.journey.yaml"), yaml);
}

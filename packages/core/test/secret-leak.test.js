// A sign-in journey must not leave a password, an API key, or a declared secret
// in the run folder, the trace, the report, or the summary. The same strings
// are still present before redaction, so a skipped rewrite would fail this grep.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readZip, redactZip } from "../src/runner/mask.js";
import { summaryMarkdown, writeReport } from "../src/review/report.js";
import { readRunFolder } from "../src/format/run-folder.js";

const PASSWORD = "pw-leak-hunter2-demo";
const API_KEY = "key-leak-abcd9876ef";
const SECRET = "sec-leak-s3cr3t-demo";
const NEEDLES = [PASSWORD, API_KEY, SECRET];
const PLAYWRIGHT = new URL("../../../node_modules/@playwright/test/cli.js", import.meta.url).pathname;
const REPO_MODULES = new URL("../../../node_modules", import.meta.url).pathname;
const CORE = new URL("..", import.meta.url).pathname;

test("an unredacted trace still contains the password, the key and the secret", () => {
  const raw = [
    `<input type="password" name="password" value="${PASSWORD}">`,
    `<input name="api_key" value="${API_KEY}">`,
    `Fill "${PASSWORD}"`,
    `.fill("${PASSWORD}")`,
    `"result":{"value":"${API_KEY}"}`,
    SECRET,
  ].join("\n");
  for (const needle of NEEDLES) assert.ok(raw.includes(needle));
  const text = readZip(redactZip(storedZip("trace.trace", raw), [SECRET])).find((entry) => entry.name === "trace.trace").data.toString("utf8");
  for (const needle of NEEDLES) assert.equal(text.includes(needle), false, needle);
});

test("a sign-in run leaves no password, key or declared secret in any artifact", { timeout: 120_000 }, () => {
  const dir = fresh();
  writeFileSync(join(dir, "playwright.config.js"), `import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  reporter: [["list"], ["journeysfirst/reporter", { outputDir: "journey-runs" }]],
  use: { baseURL: "http://127.0.0.1:9", trace: "retain-on-failure" },
});
`);
  writeFileSync(join(dir, "journeys/sign-in.journey.yaml"), `format: journeysfirst/v1
title: Sign in
promise: I want to sign in.
start: The sign-in page is open.
steps:
  - Enter the password and the key.
  - check: You see "Welcome".
    id: signed-in
`);
  writeFileSync(join(dir, "e2e/sign-in.spec.js"), `import { test } from "journeysfirst/playwright";
const PASSWORD = ${JSON.stringify(PASSWORD)};
const API_KEY = ${JSON.stringify(API_KEY)};
const SECRET = ${JSON.stringify(SECRET)};
test.journey("journeys/sign-in.journey.yaml", { video: false, measure: false }, async ({ journey }) => {
  journey.value("code", SECRET, { secret: true });
  const page = await journey.page("you");
  await journey.step("Enter the password and the key.", { by: "you" }, async () => {
    await page.setContent('<h1>Sign in</h1><input id="password" type="password" name="password"><input id="api_key" name="api_key" type="text"><p id="note"></p>');
    await page.locator("#password").fill(PASSWORD);
    await page.locator("#api_key").fill(API_KEY);
    await page.locator("#note").evaluate((el, secret) => { el.textContent = "code " + secret; }, SECRET);
  });
  await journey.check("signed-in", { by: "you" }, async () => ({
    passed: false,
    proof: "Read the heading.",
    reason: "The page did not say Welcome.",
    evidence: [{ source: "page", login: "you", url: "http://127.0.0.1:9/sign-in", saw: "a heading that is not Welcome" }],
  }));
});
`);
  const result = spawnSync(process.execPath, [PLAYWRIGHT, "test"], {
    cwd: dir,
    env: { ...process.env, CI: "1" },
    encoding: "utf8",
    timeout: 90_000,
  });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  const runs = join(dir, "journey-runs/sign-in");
  const ids = existsSync(runs) ? readdirSync(runs) : [];
  assert.equal(ids.length, 1, result.stdout + result.stderr);
  const folder = join(runs, ids[0]);
  writeReport(folder);
  writeFileSync(join(folder, "summary.md"), summaryMarkdown(readRunFolder(folder).run));
  const hits = [...hitsIn(folder, NEEDLES), ...hitsIn(join(dir, "test-results"), NEEDLES)];
  assert.deepEqual(hits, [], hits.join("\n"));
});

/** @param {string} dir @param {string[]} needles */
function hitsIn(dir, needles) {
  /** @type {string[]} */
  const hits = [];
  if (!existsSync(dir)) return hits;
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else search(path, readFileSync(path), needles, hits);
    }
  };
  walk(dir);
  return hits;
}

/** @param {string} path @param {Buffer} buf @param {string[]} needles @param {string[]} hits */
function search(path, buf, needles, hits) {
  for (const needle of needles) if (buf.includes(Buffer.from(needle))) hits.push(`${path} contains ${needle}`);
  if (!path.endsWith(".zip")) return;
  const entries = readZip(buf);
  if (!entries) return;
  for (const entry of entries) {
    for (const needle of needles) if (entry.data.includes(Buffer.from(needle))) hits.push(`${path}!${entry.name} contains ${needle}`);
  }
}

/** @returns {string} */
function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "jf-secret-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "secret", private: true, type: "module" }));
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  mkdirSync(join(dir, "journeys"), { recursive: true });
  mkdirSync(join(dir, "e2e"), { recursive: true });
  symlinkSync(CORE, join(dir, "node_modules/journeysfirst"));
  symlinkSync(join(REPO_MODULES, "@playwright"), join(dir, "node_modules/@playwright"));
  return dir;
}

/** A zip Playwright's reader accepts, with the text stored as one entry. @param {string} name @param {string} data */
function storedZip(name, data) {
  const nameBuf = Buffer.from(name);
  const body = Buffer.from(data);
  const local = Buffer.alloc(30 + nameBuf.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  nameBuf.copy(local, 30);
  const central = Buffer.alloc(46 + nameBuf.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  nameBuf.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length + body.length, 16);
  return Buffer.concat([local, body, central, end]);
}

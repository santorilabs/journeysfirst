// A sign-in journey must not leave a password, an API key, or a declared secret
// in the run folder, the trace, the report, or the summary. The same strings
// are still present before redaction, so a skipped rewrite would fail this grep.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { readZip, redactZip } from "../src/runner/mask.js";
import { summaryMarkdown, writeReport } from "../src/review/report.js";
import { readRunFolder } from "../src/format/run-folder.js";
import { serveReview } from "../src/review/review.js";

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
test.journey("journeys/sign-in.journey.yaml", { recording: false, measure: false }, async ({ journey }) => {
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

test("what the app reported at a failed line names the 403 and keeps no secret from a header, a URL or a console message", { timeout: 120_000 }, async () => {
  const HEADER = "hdr-leak-7a6b5c4d3e";
  const IN_URL = "url-leak-1f2e3d4c5b";
  const IN_CONSOLE = "con-leak-9a8b7c6d5e";
  const DECLARED = "dcl-leak-0f1e2d3c4b";
  const IN_LINK = "lnk-leak-5e4d3c2b1a";
  const needles = [HEADER, IN_URL, IN_CONSOLE, DECLARED, IN_LINK];
  // The viewer's page asks for the doc with a key in a header and a token in
  // the URL. The app answers 403, and the page logs both secrets.
  const app = createServer((req, res) => {
    if (req.url?.startsWith("/api/doc")) return void res.writeHead(403, { "content-type": "application/json" }).end('{"error":"no access"}');
    res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><h1>Doc</h1><p id="code"></p><a href="/join?invite=${IN_LINK}">Join</a><script>
const code = new URLSearchParams(location.search).get("code");
document.getElementById("code").textContent = "Your code is " + code;
fetch("/api/doc/q3?token=${IN_URL}", { headers: { authorization: "Bearer ${HEADER}" } }).then((r) => {
  console.error("Could not load the doc: api_key=${IN_CONSOLE} code " + code);
  document.querySelector("h1").textContent = "You don't have access";
});
</script>`);
  });
  await new Promise((done) => app.listen(0, "127.0.0.1", () => done(undefined)));
  const base = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (app.address()).port}`;
  const dir = fresh();
  writeFileSync(join(dir, "playwright.config.js"), `import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  reporter: [["list"], ["journeysfirst/reporter", { outputDir: "journey-runs" }]],
  use: { baseURL: ${JSON.stringify(base)}, trace: "retain-on-failure" },
});
`);
  writeFileSync(join(dir, "journeys/view-a-doc.journey.yaml"), `format: journeysfirst/v1
title: View a doc
promise: I want the viewer to see the doc.
users: [viewer]
start: The viewer has a link to the doc.
steps:
  - The viewer opens the link.
  - check: The viewer sees the doc.
    id: viewer-sees-it
`);
  writeFileSync(join(dir, "e2e/view-a-doc.spec.js"), `import { test } from "journeysfirst/playwright";
test.journey("journeys/view-a-doc.journey.yaml", { recording: false, measure: false }, async ({ journey }) => {
  journey.value("code", ${JSON.stringify(DECLARED)}, { secret: true });
  const viewer = await journey.page("viewer", { account: "signed out" });
  await journey.step("The viewer opens the link.", { by: "viewer" }, async () => {
    await viewer.goto("/view?code=${DECLARED}");
    await viewer.getByText("You don't have access").waitFor();
  });
  await journey.check("viewer-sees-it", { by: "viewer" }, async () => {
    const heading = await viewer.locator("h1").textContent();
    return { passed: heading === "Doc", proof: "Read the heading.", reason: "The viewer does not see the doc.", evidence: [{ source: "page", login: "viewer", url: "/view", saw: String(heading) }] };
  });
});
`);
  const result = await new Promise((done) => {
    const child = spawn(process.execPath, [PLAYWRIGHT, "test"], { cwd: dir, env: { ...process.env, CI: "1" } });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("close", (status) => done({ status, out }));
  });
  app.close();
  assert.notEqual(result.status, 0, result.out);
  const runs = join(dir, "journey-runs/view-a-doc");
  assert.ok(existsSync(runs), result.out);
  const folder = join(runs, readdirSync(runs)[0]);
  const md = readFileSync(join(folder, "failure.md"), "utf8");
  assert.match(md, /The viewer got a 403 from GET \/api\/doc\/q3 at line 1\./, md);
  assert.match(md, /- line 1: 403 GET \/api\/doc\/q3\n/);
  assert.match(md, /Could not load the doc: api_key=•+ code \$\{code\}/, "the console error is there, with both secrets covered");
  assert.match(md, /You don't have access/, "the screen outline is there");
  assert.match(md, /\/url: \/join\n/, "a link on screen keeps its path, not its query");
  const review = serveReview({ dir: join(dir, "journey-runs"), port: 0 });
  await new Promise((done) => review.once("listening", done));
  try {
    const page = await (await fetch(`http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (review.address()).port}/runs/view-a-doc/${basename(folder)}`)).text();
    assert.match(page, /What the app reported/);
    assert.match(page, /The viewer got a 403 from GET \/api\/doc\/q3 at line 1\./);
    const hits = [...hitsIn(folder, needles).filter((hit) => /failure\.(md|json)|run\.json/.test(hit)), ...needles.filter((n) => page.includes(n)).map((n) => `the review page contains ${n}`)];
    assert.deepEqual(hits, [], hits.join("\n"));
  } finally {
    review.close();
  }
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

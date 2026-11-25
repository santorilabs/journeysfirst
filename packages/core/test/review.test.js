import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "@playwright/test";
import { fromLegacy, listRuns, serveReview } from "../src/review/review.js";
import { parseJourney } from "../src/format/format.js";
import { RunRecorder } from "../src/runner/recorder.js";
import { JOURNEY, PNG, VIEWER_SAW, findings, recordAllPassed, recorder } from "./helpers.js";
import { batchResult, reviewLine, spreadMarks } from "../src/shared/display.js";
import JourneyReporter from "../src/runner/reporter.js";
import { readZip } from "../src/runner/mask.js";
import { RUN_ATTACHMENT } from "../src/runner/playwright.js";
import { readFileSync, readdirSync } from "node:fs";

/** A runs folder with one passing v1 run, one failing v1 run and one draft 0 run. */
function runsFolder() {
  const dir = mkdtempSync(join(tmpdir(), "jf-review-"));
  recordAllPassed(recorder({ outputDir: dir })).finish();
  const failing = recordAllPassed(recorder({ outputDir: dir, id: "2026-11-08-1802-7d2e" }));
  const reason = "The link still works after sharing was turned off.";
  const proof = "Opened the link again.";
  failing.check("viewer-blocked", { by: "viewer", verdict: "failed", proof, evidence: [
    VIEWER_SAW,
    { source: "log", login: "viewer", query: "Open the closed link", expected: "Link closed", got: { status: 200, message: reason, action: proof } },
  ], reason });
  failing.attach({ name: "viewer.webm", body: "video", kind: "video", starts_at: 1, tags: { user: "viewer" } });
  failing.playedBy("viewer", "Claude Code 2.4.1, opus");
  failing.attach({ name: "trace.zip", body: "zip", kind: "trace" });
  failing.finish();

  const old = join(dir, "share-by-link", "05333fcf-bbc6-467b-b741-b927c8264fdf");
  mkdirSync(old, { recursive: true });
  writeFileSync(
    join(old, "run.json"),
    JSON.stringify({
      format: "journeysfirst-run/v1",
      id: "05333fcf-bbc6-467b-b741-b927c8264fdf",
      journey: { id: "share-by-link", title: "Share my work by link", version: "abc" },
      agent: { name: "claude-code", model: null },
      started_at: "2026-11-05T04:13:26.031Z",
      steps: [{ id: "open", says: "The viewer opens the link.", status: "done", screenshot: "step-open.png" }],
      outcomes: [{ id: "sees-it", after: "open", says: "The viewer sees it.", verdict: "passed", detail: "heading matched", evidence: [] }],
    }),
  );
  return dir;
}

test("the review UI lists v1 runs and older draft 0 runs", () => {
  const runs = listRuns(runsFolder());
  assert.equal(runs.length, 3);
  assert.deepEqual(runs.map((r) => r.run.result).sort(), ["failed", "passed", "passed"]);
});

test("the run list and run page show the journey's title when the journey file is there, not its file name", async () => {
  const root = mkdtempSync(join(tmpdir(), "jf-review-"));
  mkdirSync(join(root, "journeys"));
  writeFileSync(join(root, "journeys/share-by-link.journey.yaml"), JOURNEY);
  const dir = join(root, "journey-runs");
  recordAllPassed(recorder({ outputDir: dir, id: "2026-11-08-1802-titled00" })).finish();
  const cwd = process.cwd();
  process.chdir(root);
  const server = serveReview({ dir, port: 0 });
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const index = await (await fetch(base)).text();
    assert.match(index, /<span class="title">.*Share a presentation by link/);
    assert.doesNotMatch(index, /Share by link/);
    const page = await (await fetch(`${base}/runs/share-by-link/2026-11-08-1802-titled00`)).text();
    assert.match(page, /<title>Share a presentation by link<\/title>/);
  } finally {
    server.close();
    process.chdir(cwd);
  }
});

test("a draft 0 run is shown in v1 terms", () => {
  const run = fromLegacy({
    format: "journeysfirst-run/v0",
    journey: { id: "share-by-link", title: "Share my work by link" },
    agent: "claude-code",
    startedAt: "2026-11-05T04:13:26.031Z",
    steps: [{ id: "turn-on", says: "The owner turns it on.", status: "done" }],
    outcomes: [{ id: "link-on", after: "turn-on", says: "It is on.", verdict: "failed" }],
  });
  assert.deepEqual(run.steps.map((s) => s.says ?? s.check), ["The owner turns it on.", "It is on."]);
  assert.equal(run.result, "failed");
  assert.equal(run.ran_by.agent, "claude-code");
  assert.equal(run.started_at, "2026-11-05T04:13:26.031Z");
});

test("the UI never shows a stored verdict or result the rules would change", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-review-"));
  const { folder, run } = recordAllPassed(recorder({ outputDir: dir, id: "2026-11-08-1900-forged00" })).finish();
  run.steps[3].evidence = []; // claims passed with nothing behind it
  run.steps[4] = { ...run.steps[4], status: "not_run" }; // and an action never ran
  writeFileSync(join(folder, "run.json"), JSON.stringify(run)); // result still says passed

  const [listed] = listRuns(dir);
  assert.equal(listed.run.result, "not_fully_checked");
  assert.equal(listed.run.steps[3].verdict, "not_checked");
  assert.equal(listed.run.steps[3].claimed, "passed");
  assert.deepEqual(listed.run.verified, ["Link sharing is still on after a reload.", 'The viewer can no longer see "Q3 plan".']);
  assert.match(listed.run.problems.join("\n"), /result is "passed", but the steps give "not_fully_checked"/);

  const server = serveReview({ dir, port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const page = await (await fetch(`http://127.0.0.1:${server.address().port}/runs/share-by-link/2026-11-08-1900-forged00`)).text();
    assert.match(page, /This run file breaks the rules\./);
    assert.match(page, /<span class="verdict not_fully_checked">Not fully checked<\/span>/);
    assert.doesNotMatch(page, /<span class="verdict passed">Passed<\/span> All 3 checks passed/);
    assert.match(page, /Claimed passed, but no evidence came from the viewer&#39;s own login\.|Claimed passed, but no evidence was attached\./);
  } finally {
    server.close();
  }
});

test("a run page shows each step, who did it, proof, cause and where it is in the video", async () => {
  const server = serveReview({ dir: runsFolder(), port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  assert.equal(server.address().address, "127.0.0.1", "only this machine can open it");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const index = await (await fetch(base)).text();
    assert.match(index, /Not fully checked|Passed/);
    const page = await (await fetch(`${base}/runs/share-by-link/2026-11-08-1802-7d2e`)).text();
    assert.match(page, /The viewer can no longer see &quot;Q3 plan&quot;/);
    assert.match(page, /<p class="error">The link still works after sharing was turned off\.<\/p>/);
    assert.match(page, /Cause: product/);
    const withoutRaw = page.replace(/<pre>[\s\S]*?<\/pre>/g, "");
    assert.equal((withoutRaw.match(/The link still works after sharing was turned off\./g) ?? []).length, 1);
    assert.equal((withoutRaw.match(/Opened the link again\./g) ?? []).length, 1);
    assert.doesNotMatch(index, /The link still works after sharing was turned off/);
    assert.match(page, /2 of 3 checks passed, 1 failed\./);
    assert.match(page, /<dt>Expected<\/dt><dd>Link closed<\/dd><dt>Got<\/dt><dd><dl><dt>status<\/dt><dd>200<\/dd>/);
    assert.match(page, /<details><summary>Raw JSON<\/summary><pre>/);
    assert.match(page, /<span class="line-kind">Action · You<\/span>/);
    assert.match(page, /<span class="step-status good">Done<\/span>/);
    assert.match(page, /<span class="step-status bad">Failed<\/span>/);
    assert.doesNotMatch(page, /No screenshot\.|class="badge"|from you&#39;s login/);
    assert.match(page, /class="line" data-step="7" data-user="viewer" data-at="[\d.]+" aria-current="step"/, "the failing check is in the viewer's video, and the page opens on it");
    assert.match(page, /<section class="run-player" aria-label="The run" data-open="7" id="steps">/);
    assert.match(page, /<details class="run-details"><summary>Run details<\/summary>[\s\S]*<dt>Role: viewer<\/dt><dd>Played by Claude Code 2\.4\.1, opus<\/dd>/, "who played a role is in the folded run details");
    assert.match(page, /<h1>Share by link<\/h1>/, "with no journey file to read the promise from, the heading is the title");
    assert.match(page, /src="\/files\/share-by-link\/2026-11-08-1802-7d2e\/step-1.png"/);
    const video = await fetch(`${base}/files/share-by-link/2026-11-08-1802-7d2e/viewer.webm`, { headers: { range: "bytes=1-2" } });
    assert.equal(video.status, 206);
    assert.equal(await video.text(), "id");
    assert.match(page, /<a href="\/files\/share-by-link\/2026-11-08-1802-7d2e\/trace.zip" download>trace.zip<\/a><pre>npx playwright show-trace \S+share-by-link\/2026-11-08-1802-7d2e\/trace.zip<\/pre>/, "the trace is listed with the command that opens it");
    assert.equal((await fetch(`${base}/files/share-by-link/2026-11-08-1802-7d2e/trace.zip`)).headers.get("content-type"), "application/zip");
  } finally {
    server.close();
  }
});

test("the index and run page count blocked checks separately from unverified checks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-review-"));
  const run = recordAllPassed(recorder({ outputDir: dir, id: "2026-11-08-1900-blocked0" }));
  run.blocked("viewer-blocked", { by: "viewer", cause: "environment", reason: "The second account was not available." });
  run.check("link-on", { by: "you", verdict: "not_checked" });
  run.finish();
  const server = await listening({ dir });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const index = await (await fetch(base)).text();
    const page = await (await fetch(`${base}/runs/share-by-link/2026-11-08-1900-blocked0`)).text();
    for (const html of [index, page]) assert.match(html, /1 of 3 checks passed, 1 blocked, 1 not verified\./);
    assert.match(page, /The second account was not available\./);
  } finally {
    server.close();
  }
});

test("nested evidence remains readable on a narrow screen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-review-"));
  const run = recorder({ outputDir: dir, id: "2026-11-08-1900-narrow00" });
  const call = "GET /albums/shared/photos/search";
  const field = 'assets.items[0].metadata.originalFileName = "sample.jpg"';
  run.check("viewer-blocked", { by: "viewer", verdict: "failed", proof: "Read the response fields.", reason: "The response contained a hidden field.", evidence: [
    { source: "api", login: "viewer", url: "/albums/shared/photos/search", got: { hidden_details_found: 1, found: [{ call, field }] } },
  ] });
  run.finish();
  const server = await listening({ dir });
  try {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
      await page.goto(`http://127.0.0.1:${server.address().port}/runs/share-by-link/2026-11-08-1900-narrow00`);
      for (const value of [call, field]) {
        const box = await page.getByText(value, { exact: true }).boundingBox();
        assert.ok(box && box.width > 180 && box.height < 80, `the value has room to wrap normally: ${value}`);
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    } finally {
      await browser.close();
    }
  } finally {
    server.close();
  }
});

test("a step nobody did is not matched to a video with no user", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-review-"));
  const run = recorder({ outputDir: dir, id: "2026-11-08-1900-novideo0" });
  run.step(1, { by: "you", screenshots: PNG });
  run.attach({ name: "screen.webm", body: "video", kind: "video" });
  run.finish();
  const server = serveReview({ dir, port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const page = await fetch(`http://127.0.0.1:${server.address().port}/runs/share-by-link/2026-11-08-1900-novideo0`);
    assert.equal(page.status, 200);
    assert.doesNotMatch(await page.text(), /data-at=/);
  } finally {
    server.close();
  }
});

test("run content is printed as text, never as markup", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-review-"));
  const journey = parseJourney(`format: journeysfirst/v1
title: <img src=x onerror=alert(1)>
promise: Text stays text.
start: Nothing.
steps:
  - <script>alert(1)</script>
  - check: The page shows "<b>bold</b>".
    id: shows-it
`);
  const run = RunRecorder.start({ journey, name: "xss", outputDir: dir, ranBy: { agent: "<script>alert(2)</script>" }, repos: [] });
  run.step(1, { by: "you", screenshots: PNG });
  run.check("shows-it", { by: "you", verdict: "passed", proof: "</pre><script>alert(3)</script>", evidence: [{ source: "page", login: "you", url: "https://x.test/", saw: "<svg onload=alert(4)>" }] });
  const { run: written } = run.finish();
  const server = serveReview({ dir, port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const index = await (await fetch(base)).text();
    const page = await (await fetch(`${base}/runs/xss/${written.id}`)).text();
    for (const html of [index, page]) assert.doesNotMatch(html, /<script>alert|<img src=x|<svg onload|<b>bold/);
    assert.equal((page.match(/<script>/g) ?? []).length, 1, "only the page's own script");
    assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(page, /&lt;\/pre&gt;&lt;script&gt;alert\(3\)/);
  } finally {
    server.close();
  }
});

test("a run page leads with each finding and keeps its criterion, step, evidence and any call on it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-review-"));
  /** A passing run with these findings, or none. */
  const write = (id, found, reviews) => {
    const { folder, run } = recordAllPassed(recorder({ outputDir: dir, id })).finish();
    writeFileSync(join(folder, "run.json"), JSON.stringify({ ...run, ...(found ? { findings: found } : {}), ...(reviews ? { reviews } : {}) }));
  };
  const markup = { id: "foundation-scale-1", criterion: "foundation-scale", step: 1, says: "<b>9 px</b> is not in the list.", evidence: [{ source: "page", login: "you", url: "https://x.test/", saw: "<svg onload=alert(4)>" }] };
  write("not-reviewed", null);
  write("nothing-found", []);
  write("with-findings", [...findings(), markup], [{ by: "ana@example.test", at: "2026-11-08T18:25:00Z", on: "foundation-values-3", says: "Keep it." }]);
  const server = await listening({ dir });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = async (id) => (await fetch(`${base}/runs/share-by-link/${id}`)).text();
    assert.match(await page("not-reviewed"), /<h2>Findings<\/h2><p>Not reviewed\.<\/p>/);
    assert.match(await page("nothing-found"), /<h2>Findings<\/h2><p>Reviewed\. Nothing found\.<\/p>/);

    const found = await page("with-findings");
    assert.match(found, /<span class="verdict passed">Passed<\/span> <span class="summary">3 of 3 checks passed\.<\/span>/);
    assert.deepEqual([...found.matchAll(/<summary>Review criterion<\/summary><p>([^:]+):/g)].map((m) => m[1]), ["Intuitive", "Right foundation", "Questions"]);
    assert.match(found, /<p class="says">Nothing on the screen changes after &quot;Copy link&quot;\.<\/p>\s*<p class="how"><a href="\?step=1#steps">Step 1<\/a><\/p>/);
    assert.match(found, /<details><summary>Review criterion<\/summary><p>Intuitive: intuitive-feedback<\/p>/);
    assert.match(found, /<p>Is a 4 px corner right for this button\?<\/p>/);
    assert.match(found, /<p class="call"><b>ana@example\.test<\/b>: Keep it\./);
    assert.match(found, /the dialog is the same before and after the click/, "the evidence is there");
    assert.match(found, /<li><b>foundation-values-3<\/b>: Keep it\. <span class="how">ana@example\.test, [^<]*\. On: &quot;Download&quot; has a 4 px corner\. The measured line has 10 and 16 px\.<\/span>/, "a call on a finding shows the finding's sentence");
    assert.doesNotMatch(found, /<b>9 px|<svg onload/);
    assert.match(found, /&lt;b&gt;9 px&lt;\/b&gt; is not in the list\./);

    const index = await (await fetch(base)).text();
    assert.equal((index.match(/class="how found"/g) ?? []).length, 1, "only a run with findings shows a count in the list");
    assert.match(index, /<span class="how found">2 findings, 1 question<\/span>/);
  } finally {
    server.close();
  }
});

test("a findings list that breaks the rules shows as a problem, and the page still opens", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-review-"));
  const { folder, run } = recordAllPassed(recorder({ outputDir: dir, id: "bad-findings" })).finish();
  writeFileSync(join(folder, "run.json"), JSON.stringify({ ...run, findings: ["slow", { says: "No id." }] }));
  const server = await listening({ dir });
  try {
    const page = await (await fetch(`http://127.0.0.1:${server.address().port}/runs/share-by-link/bad-findings`)).text();
    assert.match(page, /This run file breaks the rules\./);
    assert.match(page, /finding 1 must be an object with id, criterion, says and evidence\./);
    assert.match(page, /<p class="says">No id\.<\/p>/);
  } finally {
    server.close();
  }
});

test("a run page opens when reviews holds a null, and a criterion named like a built-in goes under Other", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-review-"));
  const { folder, run } = recordAllPassed(recorder({ outputDir: dir, id: "odd" })).finish();
  const odd = { ...findings()[0], id: "odd-1", criterion: "toString" };
  writeFileSync(join(folder, "run.json"), JSON.stringify({ ...run, findings: [odd, ["a list"]], reviews: [null, { by: "ana@example.test", at: "2026-11-08T18:25:00Z", on: "odd-1", says: "Seen." }] }));
  const server = await listening({ dir });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/runs/share-by-link/odd`);
    assert.equal(response.status, 200);
    const page = await response.text();
    assert.match(page, /<summary>Review criterion<\/summary><p>Other: toString<\/p>/);
    assert.doesNotMatch(page, /native code/);
    assert.match(page, /<li><b>odd-1<\/b>: Seen\./);
  } finally {
    server.close();
  }
});

test("the review line counts findings, questions and the ones a person has seen", () => {
  assert.equal(reviewLine({ findings: [findings()[0], ["a list"]] }), "Review: 1 finding.", "a list inside findings is not a finding");
  assert.equal(reviewLine({}), "Not reviewed.");
  assert.equal(reviewLine({ findings: [] }), "Review: nothing found.");
  assert.equal(reviewLine({ findings: findings() }), "Review: 1 finding, 1 question.");
  assert.equal(reviewLine({ findings: [findings()[0], { ...findings()[0], id: "b" }], reviews: [{ on: "b" }] }), "Review: 2 findings, 1 seen by a person.");
});

/** A raw GET, so the path and Host header reach the server exactly as written. */
function rawGet(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    request({ host: "127.0.0.1", port, path, headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject).end();
  });
}

async function listening(options) {
  const server = serveReview({ port: 0, ...options });
  await new Promise((resolve) => server.once("listening", resolve));
  return server;
}

test("a path that is not valid percent-encoding gets a 400, and the server keeps running", async () => {
  const server = await listening({ dir: runsFolder() });
  const { port } = server.address();
  try {
    assert.deepEqual(await rawGet(port, "/%E0%A4"), { status: 400, body: "Bad request: the path is not valid percent-encoding." });
    assert.equal((await rawGet(port, "/")).status, 200);
  } finally {
    server.close();
  }
});

test("files are served only from inside the runs folder, not from a sibling with a longer name", async () => {
  const parent = mkdtempSync(join(tmpdir(), "jf-review-"));
  const dir = join(parent, "journey-runs");
  recordAllPassed(recorder({ outputDir: dir })).finish();
  mkdirSync(join(parent, "journey-runs-private"));
  writeFileSync(join(parent, "journey-runs-private", "notes.txt"), "private notes");
  const server = await listening({ dir });
  const { port } = server.address();
  try {
    const escaped = await rawGet(port, "/files/../journey-runs-private/notes.txt");
    assert.notEqual(escaped.status, 200);
    assert.doesNotMatch(escaped.body, /private notes/);
  } finally {
    server.close();
  }
});

test("bound to this machine, the server refuses a request for another host name (DNS rebinding)", async () => {
  const server = await listening({ dir: runsFolder() });
  const { port } = server.address();
  try {
    const rebound = await rawGet(port, "/", { host: `attacker.example.test:${port}` });
    assert.equal(rebound.status, 403);
    assert.match(rebound.body, /answers only requests to localhost/);
    for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, "localhost"]) {
      assert.equal((await rawGet(port, "/", { host })).status, 200, host);
    }
  } finally {
    server.close();
  }
});

test("bound to another host on purpose, the server answers any host name", async () => {
  const server = await listening({ dir: runsFolder(), host: "0.0.0.0" });
  try {
    assert.equal((await rawGet(server.address().port, "/", { host: "review.example.test" })).status, 200);
  } finally {
    server.close();
  }
});

test("each step points at its time in its user's video, and only that user's steps are marks on that video", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-review-"));
  const run = recorder({ outputDir: dir, id: "2026-11-08-1900-chapters" });
  run.step(1, { by: "you", at: 1, took: 2 });
  run.step(3, { by: "viewer", at: 12.5, took: 1 });
  run.attach({ name: "viewer.webm", body: "video", kind: "video", starts_at: 10, tags: { user: "viewer" } });
  run.finish();
  const server = serveReview({ dir, port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const page = await (await fetch(`http://127.0.0.1:${server.address().port}/runs/share-by-link/2026-11-08-1900-chapters`)).text();
    const steps = page.match(/<ol class="rp-steps"[^>]*>(.*?)<\/ol>/s)[1];
    assert.match(steps, /data-step="3" data-user="viewer" data-at="2.5"/, "12.5s into the run is 2.5s into a video that started at 10s");
    assert.doesNotMatch(steps, /data-step="1" data-user/, "you have no video, so your step has no place in one");
    const track = page.match(/<div class="track"[^>]*>(.*?)<\/div>/s)[1];
    assert.deepEqual([...track.matchAll(/data-step="(\d+)"/g)].map((m) => m[1]), ["3"]);
  } finally {
    server.close();
  }
});

test("a video's controls sit under it, not over it: play, position, time, speed and full screen", async () => {
  const server = serveReview({ dir: runsFolder(), port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const page = await (await fetch(`http://127.0.0.1:${server.address().port}/runs/share-by-link/2026-11-08-1802-7d2e`)).text();
    const video = page.match(/<video [^>]*>/)[0];
    assert.doesNotMatch(video, /\scontrols/, "the browser's own controls would cover the caption");
    const controls = page.slice(page.indexOf(video)).match(/<div class="controls">(.*?)<\/div>/s)[1];
    assert.match(controls, /class="play"/);
    assert.match(controls, /class="seek"/);
    assert.match(controls, /class="time"/);
    assert.deepEqual([...controls.matchAll(/<option value="([\d.]+)"/g)].map((m) => m[1]), ["0.5", "1", "1.5", "2"]);
    assert.match(controls, /class="full"/);
  } finally {
    server.close();
  }
});

test("each video has its lines as a captions track, off at first, with a CC button to show it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-review-"));
  const run = recorder({ outputDir: dir, id: "2026-11-08-1900-track" });
  run.step(1, { by: "you", at: 1, took: 2 });
  run.step(3, { by: "viewer", at: 12.5, took: 1 });
  run.check("viewer-sees-it", { by: "viewer", verdict: "failed", at: 14, took: 1.5, proof: "Opened the link.", evidence: [VIEWER_SAW], reason: "It said not found." });
  run.attach({ name: "viewer.webm", body: "video", kind: "video", starts_at: 10, tags: { user: "viewer" } });
  run.finish();
  const server = serveReview({ dir, port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const at = `http://127.0.0.1:${server.address().port}`;
    const page = await (await fetch(`${at}/runs/share-by-link/2026-11-08-1900-track`)).text();
    assert.match(page, /<track kind="captions" src="\/captions\/share-by-link\/2026-11-08-1900-track\/viewer\.webm\.vtt" srclang="en" label="Steps">/);
    assert.doesNotMatch(page, /<track[^>]*\sdefault/, "off at first, so it never doubles the caption bar");
    assert.match(page, /<button type="button" class="cc" aria-label="Show captions" aria-pressed="false">CC<\/button>/);
    const track = await fetch(`${at}/captions/share-by-link/2026-11-08-1900-track/viewer.webm.vtt`);
    assert.equal(track.headers.get("content-type"), "text/vtt; charset=utf-8");
    assert.equal(
      await track.text(),
      'WEBVTT\n\n00:00:02.500 --> 00:00:04.000\nviewer: The viewer opens the link.\n\n00:00:04.000 --> 00:00:07.000\nFailed: The viewer sees "Q3 plan".\n',
    );
    assert.equal((await fetch(`${at}/captions/share-by-link/2026-11-08-1900-track/nobody.webm.vtt`)).status, 404);
  } finally {
    server.close();
  }
});

test("marks in the same second sit side by side on the timeline, and never past its end", () => {
  const at = spreadMarks([{ n: 2, seconds: 0 }, { n: 1, seconds: 0 }, { n: 3, seconds: 10 }], 10, 0.1).map((m) => [m.n, Number(m.at.toFixed(2))]);
  assert.deepEqual(at, [[1, 0], [2, 0.1], [3, 1]]);
  const crowded = spreadMarks([1, 2, 3, 4, 5].map((n) => ({ n, seconds: 0 })), 1, 0.5).map((m) => Number(m.at.toFixed(2)));
  assert.deepEqual(crowded, [0, 0.25, 0.5, 0.75, 1], "more marks than fit spread over the whole line");
});

test("a batch passes only when every run passed, and says how many did", () => {
  const p = { result: "passed" }, f = { result: "failed" }, n = { result: "not_fully_checked" };
  assert.deepEqual(batchResult([p, p, p], 3), { result: "passed", summary: "3 of 3 runs passed." });
  assert.deepEqual(batchResult([p, f, p], 3), { result: "failed", summary: "2 of 3 runs passed." });
  assert.deepEqual(batchResult([p, n], 2), { result: "not_fully_checked", summary: "1 of 2 runs passed." });
  assert.deepEqual(batchResult([p, p], 3), { result: "not_fully_checked", summary: "2 of 3 runs passed; 1 did not finish." });
});

test("repeated runs show as one row on the runs page, with a link to each run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-batch-"));
  for (const n of [1, 2, 3]) {
    const run = recordAllPassed(recorder({ outputDir: dir, id: `2026-11-17-100${n}-batch`, repeat: { batch: "b1", n, of: 3 } }));
    if (n === 2) run.check("viewer-blocked", { by: "viewer", verdict: "failed", proof: "Opened the link again.", evidence: [VIEWER_SAW], reason: "The link still works." });
    run.finish();
  }
  const server = serveReview({ dir, port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const index = await (await fetch(`http://127.0.0.1:${server.address().port}`)).text();
    assert.equal(index.match(/class="row"/g)?.length, 1, "one row for the batch");
    assert.match(index, /2 of 3 runs passed\./);
    assert.match(index, /<span class="verdict failed">/);
    for (const n of [1, 2, 3]) assert.match(index, new RegExp(`href="/runs/share-by-link/2026-11-17-100${n}-batch">.*run ${n}</a>`));
  } finally {
    server.close();
  }
});

test("with --repeat-each, the reporter gives the runs of one test the same batch, numbered", () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-reporter-"));
  const reporter = new JourneyReporter({ outputDir: dir });
  const result = (id) => ({ attachments: [{ name: RUN_ATTACHMENT, body: Buffer.from(JSON.stringify(recordAllPassed(recorder({ id })).result().run)) }] });
  const test = (title, i) => ({ parent: { project: () => ({ repeatEach: 2 }) }, repeatEachIndex: i, titlePath: () => ["", "chromium", title] });
  reporter.onTestEnd(test("Share by link", 0), result("2026-11-17-1100-aaaa"));
  reporter.onTestEnd(test("Share by link", 1), result("2026-11-17-1101-bbbb"));
  reporter.onTestEnd(test("Another", 0), result("2026-11-17-1102-cccc"));
  const repeat = (id) => JSON.parse(readFileSync(join(dir, "share-by-link", id, "run.json"), "utf8")).repeat;
  const [a, b, c] = ["2026-11-17-1100-aaaa", "2026-11-17-1101-bbbb", "2026-11-17-1102-cccc"].map(repeat);
  assert.deepEqual([a.n, a.of, b.n, b.of], [1, 2, 2, 2]);
  assert.equal(a.batch, b.batch);
  assert.notEqual(a.batch, c.batch, "another test gets its own batch");
  const once = new JourneyReporter({ outputDir: dir });
  once.onTestEnd({ parent: { project: () => ({ repeatEach: 1 }) }, repeatEachIndex: 0, titlePath: () => ["x"] }, result("2026-11-17-1103-dddd"));
  assert.equal(repeat("2026-11-17-1103-dddd"), undefined, "a single run has no repeat");
  assert.ok(readdirSync(join(dir, "share-by-link")).length === 4);
});

test("the reporter keeps Playwright's trace in a run that did not pass, and never in one that passed", () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-trace-"));
  const zip = join(dir, "trace-source.zip");
  writeFileSync(zip, "zip bytes");
  const reporter = new JourneyReporter({ outputDir: dir });
  const test = { parent: { project: () => ({ repeatEach: 1 }) }, repeatEachIndex: 0, titlePath: () => ["x"] };
  const ended = (run) => ({ attachments: [{ name: RUN_ATTACHMENT, body: Buffer.from(JSON.stringify(run.result().run)) }, { name: "trace", path: zip, contentType: "application/zip" }] });
  const failing = recordAllPassed(recorder({ id: "2026-11-17-1200-fail" }));
  failing.check("viewer-blocked", { by: "viewer", verdict: "failed", proof: "Opened the link again.", evidence: [VIEWER_SAW], reason: "The link still works." });
  reporter.onTestEnd(test, ended(failing));
  reporter.onTestEnd(test, ended(recordAllPassed(recorder({ id: "2026-11-17-1201-pass" }))));
  const folder = (id) => join(dir, "share-by-link", id);
  const stored = (id) => JSON.parse(readFileSync(join(folder(id), "run.json"), "utf8"));
  assert.deepEqual(stored("2026-11-17-1200-fail").media, [{ file: "trace.zip", kind: "trace" }]);
  assert.equal(readFileSync(join(folder("2026-11-17-1200-fail"), "trace.zip"), "utf8"), "zip bytes");
  assert.equal(stored("2026-11-17-1201-pass").media, undefined, "a passing run lists no trace");
  assert.ok(!readdirSync(folder("2026-11-17-1201-pass")).includes("trace.zip"));
});

/** A one-file zip with the sizes in the local header, so the reporter's reader can open it. */
function storedZip(name, text) {
  const data = Buffer.from(text);
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30 + nameBuf.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  nameBuf.copy(local, 30);
  const central = Buffer.alloc(46 + nameBuf.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  nameBuf.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length + data.length, 16);
  return Buffer.concat([local, data, central, end]);
}

test("the reporter redacts a trace and does not leave the secret list on disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-trace-mask-"));
  const trace = join(dir, "trace-source.zip");
  writeFileSync(trace, storedZip("trace.trace", 'fill password=hunter2 and s3cr3t-value\n'));
  const secrets = join(dir, "secrets.json");
  writeFileSync(secrets, JSON.stringify(["s3cr3t-value"]));
  const reporter = new JourneyReporter({ outputDir: dir });
  const failing = recordAllPassed(recorder({ id: "2026-11-17-1300-mask" }));
  failing.check("viewer-blocked", { by: "viewer", verdict: "failed", proof: "Opened the link again.", evidence: [VIEWER_SAW], reason: "The link still works." });
  const test = { parent: { project: () => ({ repeatEach: 1 }) }, repeatEachIndex: 0, titlePath: () => ["x"] };
  reporter.onTestEnd(test, {
    attachments: [
      { name: RUN_ATTACHMENT, body: Buffer.from(JSON.stringify(failing.result().run)) },
      { name: "trace", path: trace, contentType: "application/zip" },
      { name: "journeysfirst-secrets", path: secrets, body: Buffer.from(JSON.stringify(["s3cr3t-value"])) },
    ],
  });
  const saved = readZip(readFileSync(join(dir, "share-by-link", "2026-11-17-1300-mask", "trace.zip")));
  const text = saved[0].data.toString("utf8");
  assert.doesNotMatch(text, /hunter2|s3cr3t-value/);
  assert.match(text, /password=/);
  const original = readZip(readFileSync(trace));
  assert.doesNotMatch(original[0].data.toString("utf8"), /hunter2|s3cr3t-value/);
  assert.equal(existsSync(secrets), false, "the secret list is removed from the test output");
  assert.ok(!readdirSync(join(dir, "share-by-link", "2026-11-17-1300-mask")).includes("secrets.json"));
});

test("a failed run's page shows what the app reported under the failed step, for each user", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-review-"));
  const failing = recordAllPassed(recorder({ outputDir: dir, id: "2026-11-08-1802-report00" }));
  failing.check("viewer-blocked", { by: "viewer", verdict: "failed", proof: "Opened the link again.", evidence: [VIEWER_SAW], reason: "The link still works after sharing was turned off." });
  const report = {
    line: 7,
    says: "The viewer can no longer see \"Q3 plan\".",
    by: "viewer",
    since: 5,
    summary: "The viewer got a 403 from GET /api/view/q3-plan at line 6.",
    users: [
      { user: "viewer", requests: [{ line: 6, method: "GET", path: "/api/view/q3-plan", status: 403 }], errors: [{ line: 6, text: "<b>Failed</b> to load" }], outline: "- heading \"Q3 plan\" [level=1]" },
      { user: "you", requests: [], errors: [], outline: null },
    ],
  };
  failing.attach({ name: "failure.json", body: JSON.stringify(report), kind: "capture", tags: { line: 7 } });
  failing.finish();
  const server = serveReview({ dir, port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const page = await (await fetch(`http://127.0.0.1:${server.address().port}/runs/share-by-link/2026-11-08-1802-report00`)).text();
    const block = page.match(/<section class="reported">[\s\S]*?<\/section>/)?.[0] ?? "";
    assert.match(block, /What the app reported<\/p><p>The viewer got a 403 from GET \/api\/view\/q3-plan at line 6\.<\/p>/);
    assert.match(block, /<b>viewer<\/b>[\s\S]*line 6: <b>403<\/b> GET <code>\/api\/view\/q3-plan<\/code>/);
    assert.match(block, /line 6: &lt;b&gt;Failed&lt;\/b&gt; to load/, "a console error is printed as text");
    assert.match(block, /<summary>What viewer saw on screen<\/summary><pre>- heading &quot;Q3 plan&quot; \[level=1\]<\/pre>/);
    assert.match(block, /<b>you<\/b><\/p><p class="empty">No failed requests or console errors\.<\/p><p class="empty">The screen outline was not captured\.<\/p>/);
    assert.equal(page.match(/class="reported"/g)?.length, 1, "only the failed step has the block");
  } finally {
    server.close();
  }
});

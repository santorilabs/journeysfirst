// End to end: run the share-by-link example in a real browser twice, once
// against the good demo app and once with its link bug, and check both run
// folders. Needs Playwright's Chromium (npx playwright install --only-shell chromium).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadJourney } from "../src/format/format.js";
import { readRunFolder } from "../src/format/run-folder.js";
import { measuredReport } from "../src/review/measured.js";

const EXAMPLE = new URL("../../../examples/share-by-link/", import.meta.url).pathname;
const PLAYWRIGHT = new URL("../../../node_modules/.bin/playwright", import.meta.url).pathname;
const JOURNEY = loadJourney(join(EXAMPLE, "journeys/share-by-link.journey.yaml"));

/** Run the example and return its exit code and the one run folder it wrote. */
function runExample(env, args = []) {
  const runs = mkdtempSync(join(tmpdir(), "jf-example-"));
  // Its own Playwright output folder: Playwright empties it at the start, so a shared one loses another run's videos.
  const result = spawnSync(PLAYWRIGHT, ["test", "--output", join(runs, "test-results"), ...args], {
    cwd: EXAMPLE,
    env: { ...process.env, ...env, JOURNEYSFIRST_RUNS_DIR: runs },
    encoding: "utf8",
    timeout: 120_000,
  });
  const journeyRuns = join(runs, "share-by-link");
  const ids = existsSync(journeyRuns) ? readdirSync(journeyRuns) : [];
  assert.equal(ids.length, 1, result.stdout + result.stderr);
  const folder = join(journeyRuns, ids[0]);
  return { status: result.status, output: result.stdout + result.stderr, ...readRunFolder(folder, { journey: JOURNEY }), folder };
}

test("the example passes against the good app", () => {
  const { status, output, run, files, folder } = runExample({});
  assert.equal(status, 0, output);
  assert.match(output, /tests\/share-by-link\.spec\.js:\d+:\d+ › Share a presentation by link/, "the test is listed at the spec's own line");
  assert.doesNotMatch(output, /runner\/playwright\.js:\d+/);
  assert.equal(run.result, "passed");
  assert.deepEqual(run.verified.length, 3);
  assert.deepEqual(run.steps.map((s) => s.by), ["you", "you", "viewer", "viewer", "you", "viewer", "viewer"]);
  assert.match(run.values.link.value, /\/view\/q3-plan$/);
  assert.deepEqual(run.media.filter((m) => m.kind === "video").map((m) => [m.file, m.tags.user, m.tags.paced]), [["you.webm", "you", false], ["viewer.webm", "viewer", false]], "a video for every user, recorded with no waiting");
  assert.ok(run.steps.at(-1).at < 5, `the run does not wait after each line: its last line starts ${run.steps.at(-1).at} s in`);
  assert.deepEqual(run.media.filter((m) => m.kind === "capture").map((m) => m.file), [1, 2, 3, 4, 5, 6, 7].map((n) => `measure-${n}.txt`), "every line's screen is measured for the review");
  const line1 = JSON.parse(files.get("measure-1.txt").toString());
  assert.match(line1.url, /^http:\/\/localhost:\d+\/$/);
  assert.deepEqual(line1.actions.filter((a) => !a.name.startsWith("open ")).map((a) => (a.field ? [a.name, "field"] : [a.name, a.changed, a.ms < 1000])), [["Share", "disabled on button", true], ["Anyone with the link can view", "field"], ["Copy link", "Copied", true]], "each click with the first change after it, and each field set");
  assert.deepEqual([line1.wide.width, line1.phone.width, line1.phone.pageWidth], [1280, 375, 375]);
  assert.deepEqual(line1.wide.fonts, { "system-ui": { n: 9, on: 'h1 "Q3 plan"' } });
  assert.deepEqual(Object.keys(line1.wide.spacing), ["3", "4", "8", "10", "16", "19", "20", "21", "24", "40", "48"]);
  assert.deepEqual(line1.phone.controls.map((c) => [c.name, c.in, c.small ?? false, c.strong ?? false]), [
    ['button "Share"', "page", false, false],
    ['input "Anyone with the link can view"', "dialog", false, false],
    ['button "Copy link"', "dialog", false, false],
    ['button "Done"', "dialog", false, false],
  ]);
  assert.deepEqual(line1.phone.cut, [], "the dialog fits a phone");
  assert.match(measuredReport(folder, { readme: join(folder, "no-readme.md") }), /\nNo measured criterion fails\.\n\nCounts: step 1: 2 clicks, 1 field; step 2: 1 click, 0 fields; step 5: 0 clicks, 1 field\.$/, "the example passes its own review's measured criteria");
  assert.ok(run.steps.every((s) => s.screenshots?.length === 1));
  assert.ok(files.has("step-7.png") && files.has("viewer.webm"));
  assert.ok(!run.media.some((m) => m.kind === "trace") && !files.has("trace.zip"), "a passing run keeps no trace");
});

test("recording: false in the config's use records no video for any user", () => {
  // A config beside the example's, so its testDir and webServer resolve the same.
  const config = join(EXAMPLE, `playwright.no-video-${process.pid}.config.js`);
  writeFileSync(config, 'import base from "./playwright.config.js";\nexport default { ...base, use: { ...base.use, recording: false } };\n');
  try {
    const { status, output, run, files } = runExample({}, ["--config", config]);
    assert.equal(status, 0, output);
    assert.equal(run.result, "passed");
    assert.deepEqual(run.media.filter((m) => m.kind === "video"), []);
    assert.ok(![...files.keys()].some((name) => name.endsWith(".webm")));
    assert.ok(run.steps.every((s) => s.screenshots?.length === 1), "screenshots are still taken");
  } finally {
    rmSync(config, { force: true });
  }
});

test("the example fails with cause product when the link keeps working", () => {
  const { status, output, run, files } = runExample({ DEMO_LINK_BUG: "1" });
  assert.equal(status, 1, output);
  assert.match(output, /The journey run is failed/);
  assert.equal(run.result, "failed");
  const blocked = run.steps.find((s) => s.id === "viewer-blocked");
  assert.equal(blocked.verdict, "failed");
  assert.equal(blocked.cause, "product");
  assert.equal(blocked.reason, "The link still works after sharing was turned off.");
  assert.deepEqual(run.media.filter((m) => m.kind === "trace"), [{ file: "trace.zip", kind: "trace" }], "a failed run keeps Playwright's trace");
  assert.equal(files.get("trace.zip").subarray(0, 2).toString(), "PK", "the trace is a zip");
  assert.deepEqual(run.not_verified, ['The viewer can no longer see "Q3 plan": the link still works after sharing was turned off.']);
});

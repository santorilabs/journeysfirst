import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { journeyPlan, journeyVersion, parseJourney } from "../src/format/format.js";
import { RunRecorder, runId } from "../src/runner/recorder.js";
import { validateRun } from "../src/format/runfile.js";
import { CASES, DRAFT_0, JOURNEY, ON, PNG, VIEWER_SAW, recordAllPassed, recorder } from "./helpers.js";

const step = (run, n) => run.result().run.steps[n - 1];

test("a full run passes, with steps in the journey's order and who did each", () => {
  const { run } = recordAllPassed(recorder()).result();
  assert.equal(run.result, "passed");
  assert.equal(run.summary, "All 3 checks passed.");
  assert.deepEqual(run.journey, { name: "share-by-link", version: journeyVersion(parseJourney(JOURNEY)), case: null });
  assert.deepEqual(run.steps.map((s) => s.by), ["you", "you", "viewer", "viewer", "you", "viewer", "viewer"]);
  assert.deepEqual(run.steps[0].screenshots, ["step-1.png"]);
  assert.deepEqual(run.users, { you: null, viewer: null });
  assert.deepEqual(run.verified.length, 3);
  assert.deepEqual(run.not_verified, []);
  assert.equal(run.ran_by.agent, "test");
  assert.deepEqual(run.repos, [{ repo: "acme/web", commit: "abc123", branch: "main" }]);
});

test("the run names the journeysfirst version that wrote it", () => {
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const { run } = recordAllPassed(recorder()).result();
  assert.equal(run.journeysfirst, version);
  assert.deepEqual(validateRun(run), []);
});

test("a claimed pass with no evidence becomes not_checked, and the run is not fully checked", () => {
  const run = recordAllPassed(recorder());
  run.check("link-on", { by: "you", verdict: "passed", proof: "It looked on." });
  const file = run.result().run;
  assert.equal(file.steps[1].verdict, "not_checked");
  assert.equal(file.steps[1].claimed, "passed");
  assert.equal(file.result, "not_fully_checked");
  assert.deepEqual(file.not_verified, ["Link sharing is still on after a reload: no evidence was attached."]);
});

test("a failed check fails the run, with cause product by default", () => {
  const run = recordAllPassed(recorder());
  run.check("viewer-blocked", { by: "viewer", verdict: "failed", proof: "Opened the link again.", evidence: [VIEWER_SAW], reason: "The link still works after sharing was turned off." });
  const file = run.result().run;
  assert.equal(file.result, "failed");
  assert.equal(file.steps[6].cause, "product");
  assert.equal(file.summary, "The link still works after sharing was turned off.");
  assert.throws(() => recorder().check("link-on", { by: "you", verdict: "failed", proof: "Read it." }), /step 2 \(check "link-on"\) is failed, so it needs a reason/);
});

test("the runner says who did each line; the recorder only checks it is someone in the journey", () => {
  const run = recorder();
  assert.throws(() => run.step(1), /step 1 has no by: say who did it, you or a name from users\./);
  assert.throws(() => run.step(1, { by: "admin" }), /step 1 has by "admin", which is not in users \(you, viewer\)\./);
  // The sentence names nobody, but the runner says the viewer did it, and that stands.
  run.step(1, { by: "viewer" });
  assert.equal(step(run, 1).by, "viewer");
  // A check passes only with evidence from the by user's own login.
  run.check("viewer-sees-it", { by: "you", verdict: "passed", proof: "Looked.", evidence: [VIEWER_SAW] });
  assert.equal(step(run, 4).verdict, "not_checked");
  assert.equal(step(run, 4).reason, "No evidence came from your own login.");
  // Lines nobody did have no by.
  assert.equal(step(run, 3).by, undefined);
  assert.deepEqual(validateRun(run.result().run), []);
});

test("lines not recorded are not_run or not_checked; lines after a blocked one are blocked", () => {
  const run = recorder();
  assert.equal(step(run, 1).status, "not_run");
  assert.equal(step(run, 2).verdict, "not_checked");
  run.blocked(3, { reason: "The viewer account could not be created." });
  assert.equal(step(run, 3).status, "blocked");
  assert.equal(step(run, 3).cause, "environment");
  assert.equal(step(run, 4).verdict, "blocked");
  assert.equal(step(run, 4).reason, "Step 3 was blocked: The viewer account could not be created.");
  assert.equal(run.result().run.result, "not_fully_checked");
  assert.deepEqual(validateRun(run.result().run), []);
  run.blocked("viewer-blocked", { reason: "The app did not start.", cause: "environment" });
  assert.equal(step(run, 7).verdict, "blocked");
});

test("steps are keyed by line number or sentence, checks by id", () => {
  const run = recorder();
  assert.throws(() => run.step("Do something else."), /is not an action in share-by-link\. Its actions are:\n {2}1\. Turn on link sharing/);
  assert.throws(() => run.step(2), /Line 2 is a check\. Record it with check\("link-on"\)/);
  assert.throws(() => run.check("nope"), /"nope" is not a check id in share-by-link\. Its checks are: link-on, viewer-sees-it, viewer-blocked/);
  assert.throws(() => run.step(1, { status: "ok" }), /status must be one of/);
  assert.throws(() => run.check("link-on", { verdict: "great" }), /verdict must be one of/);
});

test("evidence is checked when it is recorded", () => {
  const run = recorder();
  assert.throws(() => run.check("link-on", { by: "you", verdict: "passed", proof: "Read it.", evidence: [{ source: "api", login: "you" }] }), /api evidence needs url/);
  assert.throws(() => run.check("link-on", { by: "you", verdict: "passed", proof: "Read it.", evidence: [{ ...ON, login: "admin" }] }), /evidence login "admin" is not in users \(you, viewer\)/);
});

test("users, values, tags, media and more screenshots", () => {
  const run = recordAllPassed(recorder({ users: { you: "owner-7d2e@example.test" }, tags: { environment: "staging" } }));
  run.user("viewer", "viewer-91fa@example.test");
  assert.throws(() => run.user("admin", "x"), /"admin" is not a user in this journey/);
  run.playedBy("viewer", "a script");
  assert.throws(() => run.playedBy("admin", "a script"), /"admin" is not a user in this journey/);
  assert.throws(() => run.playedBy("viewer", " "), /Say who played viewer/);
  run.value("link", "http://localhost/view/q3-plan");
  run.value("phone", "+1 555 0142", { secret: true });
  run.tag("device", "Chrome, desktop");
  run.attach({ name: "viewer.webm", body: "video", kind: "video", starts_at: 12.4, tags: { user: "viewer" } });
  run.step(1, { by: "you", screenshots: [PNG] });
  const file = run.result().run;
  assert.deepEqual(file.users, { you: "owner-7d2e@example.test", viewer: "viewer-91fa@example.test" });
  assert.deepEqual(file.played_by, { viewer: "a script" });
  assert.equal(recordAllPassed(recorder()).result().run.played_by, undefined, "left out when nobody said");
  assert.deepEqual(file.values, { link: { value: "http://localhost/view/q3-plan" }, phone: { secret: true } });
  assert.doesNotMatch(JSON.stringify(file), /555 0142/);
  assert.deepEqual(file.tags, { environment: "staging", device: "Chrome, desktop" });
  assert.deepEqual(file.media, [{ file: "viewer.webm", kind: "video", starts_at: 12.4, tags: { user: "viewer" } }]);
  assert.deepEqual(file.steps[0].screenshots, ["step-1.png", "step-1-2.png"]);
  assert.deepEqual(validateRun(file), []);
});

test("a screenshot can say the page it was taken on", () => {
  const run = recordAllPassed(recorder());
  run.step(5, { by: "you", screenshots: [{ image: PNG, url: "https://app.example.test/p/q3-plan" }, PNG] });
  const file = run.result().run;
  assert.deepEqual(file.steps[4].screenshots, [{ file: "step-5.png", url: "https://app.example.test/p/q3-plan" }, "step-5-2.png"]);
  assert.deepEqual([...run.result().files.keys()].sort(), ["step-1.png", "step-3.png", "step-5-2.png", "step-5.png"]);
  assert.deepEqual(validateRun(file), []);
  assert.throws(() => run.step(5, { by: "you", screenshots: [{ image: PNG, url: "/p/q3-plan" }] }), /screenshot step-5-3\.png needs url to be the full address of the page/);
});

test("repos come from the caller when given, and from the local checkout otherwise", () => {
  const preview = [{ repo: "acme/web", commit: "f00d", branch: "preview-12" }];
  assert.deepEqual(recorder({ repos: preview }).result().run.repos, preview);
  assert.equal(recorder({ repos: [] }).result().run.repos, undefined);
  const local = recorder({ repos: undefined }).result().run.repos;
  assert.equal(local.length, 1);
  assert.match(local[0].commit, /^[0-9a-f]{40}$/);
});

test("a case run records which case ran, and needs the case id", () => {
  const journey = parseJourney(CASES);
  assert.throws(() => RunRecorder.start({ journey, name: "two-step-sign-in" }), /Say which one runs/);
  const run = RunRecorder.start({ journey, name: "two-step-sign-in", case: "not-now", repos: [] });
  run.check("nothing-sent", { by: "you", verdict: "passed", proof: "Counted texts since the start.", evidence: [{ source: "database", login: "you", query: "select count(*) from texts", got: 0 }] });
  const file = run.result().run;
  assert.deepEqual(file.journey.case, "not-now");
  assert.equal(file.steps.length, 3);
  assert.deepEqual(validateRun(file, journeyPlan(journey, "not-now")), []);
});

test("added checks copy added: true from the journey", () => {
  const journey = parseJourney(CASES);
  journey.cases[1].steps[2].added = true;
  const file = RunRecorder.start({ journey, name: "two-step-sign-in", case: "not-now", repos: [] }).result().run;
  assert.equal(file.steps[2].added, true);
  assert.deepEqual(validateRun(file, journeyPlan(journey, "not-now")), []);
});

test("a draft 0 journey still records, as v1 lines", () => {
  const run = RunRecorder.start({ journey: parseJourney(DRAFT_0), repos: [] });
  run.check("sees-it", { by: "viewer", verdict: "passed", proof: "Opened it.", evidence: [{ source: "page", login: "viewer", url: "/v" }] });
  const file = run.result().run;
  assert.equal(file.journey.name, "share-by-link");
  assert.deepEqual(Object.keys(file.users), ["owner", "viewer"]);
  assert.equal(file.steps[3].verdict, "passed");
  assert.deepEqual(validateRun(file), []);
});

test("run ids look like 2026-11-08-1802-7d2e91fa", () => {
  assert.match(runId(Date.parse("2026-11-08T18:02:11Z")), /^2026-11-08-1802-[0-9a-f]{8}$/);
});

test("finish writes run.json and its files to <journey name>/<run id>/", () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-"));
  const { folder, run } = recordAllPassed(recorder({ outputDir: dir })).finish();
  assert.equal(folder, join(dir, "share-by-link", run.id));
  assert.deepEqual(JSON.parse(readFileSync(join(folder, "run.json"), "utf8")), run);
  assert.deepEqual(readFileSync(join(folder, "step-1.png")), PNG);
});

test("a declared secret anywhere else in the run stops the run folder from being written", () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-secret-"));
  const run = recordAllPassed(recorder({ outputDir: dir }));
  run.value("code", "481516", { secret: true });
  run.check("link-on", { by: "you", verdict: "passed", proof: "Read the saved setting.", evidence: [{ ...ON, got: { linkSharing: true, code: "481516" } }] });
  run.step(5, { by: "you", status: "failed", cause: "test", reason: "Typed 481516 and the page froze." });
  assert.throws(() => run.finish(), (error) => {
    assert.match(error.message, /The secret \$\{code\} is in the run at steps\[1\]\.evidence\[0\]\.got\.code, steps\[4\]\.reason\./);
    assert.doesNotMatch(error.message, /481516/);
    return true;
  });
  assert.equal(existsSync(join(dir, "share-by-link")), false, "nothing written");
});

test("declared secrets in evidence keys stop the run without appearing in the error paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-secret-"));
  const run = recordAllPassed(recorder({ outputDir: dir }));
  run.value("code", "private+code", { secret: true });
  run.value("pin", 4312, { secret: true });
  run.check("link-on", { by: "you", verdict: "passed", proof: "Read the setting.",
    evidence: [{ ...ON, got: { "account-private+code": { pin_4312: "ordinary value" } } }] });
  assert.throws(() => run.finish(), (error) => {
    assert.match(error.message, /\$\{code\} is in the run at steps\[1\]\.evidence\[0\]\.got\.account-\[redacted\]/);
    assert.match(error.message, /\$\{pin\} is in the run at steps\[1\]\.evidence\[0\]\.got\.account-\[redacted\]\.pin_\[redacted\]/);
    assert.doesNotMatch(error.message, /private\+code|4312/);
    return true;
  });
  assert.equal(existsSync(join(dir, "share-by-link")), false);
});

test("a secret that appears nowhere else writes the run, and its value stays out of it", () => {
  const run = recordAllPassed(recorder({ outputDir: mkdtempSync(join(tmpdir(), "jf-secret-")) }));
  run.value("code", "481516", { secret: true });
  const { folder } = run.finish();
  assert.doesNotMatch(readFileSync(join(folder, "run.json"), "utf8"), /481516/);
});

test("an obvious secret in the run is covered, and an ordinary value is kept", () => {
  const run = recordAllPassed(recorder());
  run.check("link-on", {
    by: "you",
    verdict: "failed",
    proof: "Read Bearer abcdefghijklmnop from the header.",
    evidence: [{ ...ON, got: { password: "hunter2", code: "481516" } }],
    reason: "password=hunter2 and the code 481516 was rejected.",
  });
  const file = run.result().run;
  const json = JSON.stringify(file);
  assert.doesNotMatch(json, /hunter2|abcdefghijklmnop/);
  assert.match(json, /481516/);
  assert.equal(file.steps[1].evidence[0].got.password, "••••••••");
  assert.match(file.steps[1].reason, /password=/);
  assert.equal(file.summary.includes("hunter2"), false);
  assert.deepEqual(validateRun(file), []);
});

test("a value declared secret and then given again in the open is no longer checked as a secret", () => {
  const run = recordAllPassed(recorder({ outputDir: mkdtempSync(join(tmpdir(), "jf-secret-")) }));
  run.value("link", "https://app.example.test/view/q3-plan", { secret: true });
  run.value("link", "https://app.example.test/view/q3-plan");
  assert.equal(run.result().run.values.link.value, "https://app.example.test/view/q3-plan");
});

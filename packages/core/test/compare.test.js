// A run compared with main's run of the same journey: what each user lost or pays for, from measurements only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { addReview, readRunJson } from "../src/format/run-folder.js";
import { addCompareFindings, baselineFor, compareAll, compareFolder, compareReport, compareRuns } from "../src/review/compare.js";
import { exportReview } from "../src/review/export.js";
import { PNG } from "./helpers.js";

const control = (name) => ({ name, in: "main", left: 0, top: 0, width: 200, height: 40 });
const screen = (controls = [], text = "a1") => ({ width: 1280, pageWidth: 1280, text, spacing: {}, type: {}, fonts: {}, radius: {}, effects: {}, controls: controls.map(control), cut: [] });
const measure = (controls, actions = [], text) => ({ url: "http://localhost:4000/claims/1042", wide: screen(controls, text), actions });
const click = (name, ms = 20) => ({ name, ms, changed: "something" });
const CODE = 'input "Billing code"';

/** A claims journey: you open a claim, see its billing code, and the agent files it. */
function run(over = {}, verdicts = {}) {
  const check = (id, text, by) => ({ check: text, id, by, verdict: verdicts[id] ?? "passed", proof: "Read the screen.", evidence: [{ source: "page", login: by, url: "http://localhost:4000/", saw: "it" }], ...(verdicts[id] === "failed" ? { reason: "The billing code is not there." } : {}) });
  return {
    format: "journeysfirst-run/v1", id: "pr-1", journey: { name: "review-a-claim", version: "v1", case: null }, result: "passed", started_at: "2026-11-26T10:00:00Z", finished_at: "2026-11-26T10:00:09Z",
    ran_by: { agent: "test" }, repos: [{ repo: "acme/claims", commit: "bbb2222", branch: "move-billing" }], users: { you: "pat@example.test", agent: null },
    steps: [
      { says: "Open claim 1042.", by: "you", status: "done", screenshots: ["step-1.png"] },
      check("sees-billing-code", "You see the billing code.", "you"),
      { says: "The agent files the claim.", by: "agent", status: "done" },
      check("claim-filed", "The agent sees the claim is filed.", "agent"),
    ],
    ...over,
  };
}
const side = (measures, over, verdicts, calls = new Map()) => ({ run: run(over, verdicts), measures: new Map(measures), calls });
const MAIN = () => side([[1, measure([CODE, 'button "Approve"'], [click("Claim 1042")])], [2, measure([CODE, 'button "Approve"'])]], { id: "main-1", started_at: "2026-11-25T10:00:00Z", repos: [{ repo: "acme/claims", commit: "aaa1111", branch: "main" }] });
/** The planted change: the billing code is under Details, then Billing. Every check still passes. */
const MOVED = (over, verdicts) => side([[1, measure(['button "Approve"', 'button "Details"'], [click("Claim 1042")], "b2")], [2, measure([CODE, 'button "Approve"', 'button "Details"'], [click("Details"), click("Billing")], "c3")]], over, verdicts);
const outcome = (result, user) => result.users.find((u) => u.user === user);

test("a line that names no one is yours, so a check nobody did is never same", () => {
  const steps = run().steps.map(({ by, ...step }) => (step.id === "sees-billing-code" ? { ...step, verdict: "not_run" } : { ...step, by }));
  assert.equal(outcome(compareRuns(MAIN(), side([...MAIN().measures], { steps })), "you").outcome, "not_verified");
});

test("the same clicks and screens as main is same, and no step is listed", () => {
  const result = compareRuns(MAIN(), side([...MAIN().measures]));
  assert.equal(outcome(result, "you").outcome, "same");
  assert.deepEqual([result.items, result.steps, result.same], [[], [], 4]);
});

test("a control that was on screen when it opened and is now 2 clicks down is got worse, while every check still passes", () => {
  const result = compareRuns(MAIN(), MOVED());
  const you = outcome(result, "you");
  assert.equal(you.outcome, "worse");
  assert.match(you.says, /Billing code/);
  assert.match(you.says, /2 clicks/);
  assert.match(you.says, /checks? still pass/);
  const moved = result.items.find((item) => item.criterion === "compare-moved");
  assert.deepEqual([moved.kind, moved.step, moved.by, moved.measured.clicks, moved.measured.at], ["worse", 1, "you", 2, 2], "visible on open on main, 2 clicks deep now, first seen at step 2");
  assert.ok(result.items.some((item) => item.criterion === "compare-more-steps" && item.step === 2 && item.kind === "worse"), "the extra clicks are their own measured cost");
  assert.deepEqual(result.steps.map((s) => s.n), [1, 2], "only the changed steps are listed");
  assert.equal(result.same, 2);
  assert.deepEqual(result.steps[1].change.actions.map((a) => a.name), ["Details", "Billing"], "each side has the clicks it took");
  assert.ok(result.change.run.steps.filter((s) => s.check).every((s) => s.verdict === "passed"), "got worse never changes a verdict");
  assert.ok(result.questions.length >= 1 && result.questions.length <= 3 && result.questions.every((q) => q.ask && q.kind === "worse"), "each question is tied to a measured change");
});

test("a control that no screen in the run shows is got worse, and a new control or new words is only changed", () => {
  const gone = compareRuns(MAIN(), side([[1, measure(['button "Approve"'], [click("Claim 1042")])], [2, measure(['button "Approve"'])]]));
  assert.equal(outcome(gone, "you").outcome, "worse");
  assert.equal(gone.items.filter((item) => item.criterion === "compare-gone").length, 1, "said once, at the first screen it left");
  const both = (controls) => side([[1, measure(controls, [click("Claim 1042")])], [2, measure(controls)], [3, measure(controls)], [4, measure(controls)]]);
  const lost = compareRuns(both(['button "Print"']), both([]));
  assert.deepEqual(lost.users.map((u) => [u.user, u.outcome]), [["you", "worse"], ["agent", "worse"]], "each user who lost it is told");
  assert.notEqual(gone.items[0].id, lost.items[0].id, "a call on one loss never lands on a different loss at the same step");
  const added = compareRuns(MAIN(), side([[1, measure([CODE, 'button "Approve"', 'button "Print"'], [click("Claim 1042")], "z9")], [2, measure([CODE, 'button "Approve"'])]]));
  assert.equal(outcome(added, "you").outcome, "changed");
  assert.deepEqual(added.items.map((item) => item.kind), ["changed"]);
  assert.deepEqual(added.questions, [], "no question without a loss or a cost");
});

test("a click that crosses 1 second, or stops changing the screen, is got worse", () => {
  const slow = compareRuns(MAIN(), side([[1, measure([CODE, 'button "Approve"'], [click("Claim 1042", 1400)])], [2, MAIN().measures.get(2)]]));
  assert.deepEqual(slow.items.map((item) => [item.criterion, item.kind, item.step]), [["compare-slow", "worse", 1]]);
  const quick = compareRuns(MAIN(), side([[1, measure([CODE, 'button "Approve"'], [click("Claim 1042", 400)])], [2, MAIN().measures.get(2)]]));
  assert.deepEqual(quick.items, [], "slower but under 1 second is not said");
  const dead = compareRuns(MAIN(), side([[1, measure([CODE, 'button "Approve"'], [{ name: "Claim 1042", ms: null }])], [2, MAIN().measures.get(2)]]));
  assert.deepEqual(dead.items.map((item) => item.criterion), ["compare-slow"]);
  const twice = compareRuns(side([[1, measure([], [click("Save"), click("Save")])]]), side([[1, measure([], [{ name: "Save", ms: null }, { name: "Save", ms: null }])]]));
  assert.equal(new Set(twice.items.map((item) => item.id)).size, twice.items.length, "2 clicks that measure the same are one finding, so every id is its own");
});

test("a failed check is broke, whatever was measured, and a check that was not decided is not verified", () => {
  const broke = compareRuns(MAIN(), MOVED({}, { "sees-billing-code": "failed" }));
  assert.equal(outcome(broke, "you").outcome, "broke");
  assert.match(outcome(broke, "you").says, /billing code/i);
  assert.equal(outcome(compareRuns(MAIN(), MOVED({}, { "sees-billing-code": "blocked" })), "you").outcome, "not_verified");
  assert.deepEqual(broke.users.map((u) => u.outcome), ["broke", "not_compared"], "the worst is first");
});

test("with no main run, a changed journey, or nothing measured, a user is not compared, never same", () => {
  assert.deepEqual(compareRuns(null, MOVED()).users.map((u) => u.outcome), ["not_compared", "not_compared"]);
  const reworded = compareRuns(side([...MAIN().measures], { journey: { name: "review-a-claim", version: "v0", case: null } }), MOVED());
  assert.deepEqual(reworded.users.map((u) => u.outcome), ["not_compared", "not_compared"]);
  assert.match(reworded.why, /journey/);
  const result = compareRuns(MAIN(), side([...MAIN().measures]));
  assert.equal(outcome(result, "agent").outcome, "not_compared", "the agent's lines were not measured on either side");
  assert.match(outcome(result, "agent").says, /measure/i);
});

const call = (tool, over = {}) => ({ tool, ms: 40, reply: 2, ...over });

test("an agent is compared by its tool calls: a new error or a call that crosses 1 second is got worse, more calls is changed", () => {
  const calls = (list) => new Map([["claims.txt", list]]);
  const main = () => ({ ...MAIN(), calls: calls([call("claims.file")]) });
  const same = compareRuns(main(), side([...MAIN().measures], {}, {}, calls([call("claims.file")])));
  assert.equal(outcome(same, "agent").outcome, "same");
  const worse = compareRuns(main(), side([...MAIN().measures], {}, {}, calls([call("claims.file", { error: true, says: "No billing code." }), call("claims.file", { ms: 2100, reply: 4 })])));
  assert.equal(outcome(worse, "agent").outcome, "worse");
  assert.deepEqual(worse.items.map((item) => [item.criterion, item.kind, item.by]), [["compare-error", "worse", "agent"], ["compare-slow", "worse", "agent"], ["compare-more-calls", "changed", "agent"]]);
  assert.equal(outcome(worse, "you").outcome, "same", "one user's loss is not another's");
  assert.match(worse.items[0].says, /No billing code/);
  assert.doesNotMatch(compareRuns(main(), worse.change, { replies: false }).items[0].says, /No billing code/, "a page shared without transcripts leaves a tool's reply out");
  const more = compareRuns(main(), side([...MAIN().measures], {}, {}, calls([call("claims.read"), call("claims.file", { reply: 4 })])));
  assert.equal(outcome(more, "agent").outcome, "changed", "an agent takes a different path each run, so a count alone needs no person");
});

test("a run from an older commit than the change is stale", () => {
  assert.equal(compareRuns(MAIN(), MOVED(), { head: "bbb2222abcdef" }).stale, null);
  assert.match(compareRuns(MAIN(), MOVED(), { head: "ccc3333" }).stale, /bbb2222.*ccc3333/s);
  assert.equal(compareRuns(MAIN(), MOVED()).stale, null, "not judged when the change's commit is not given");
});

/** Write a side as a run folder. */
function folderOf(dir, { run: raw, measures }, files = {}) {
  const folder = join(dir, raw.journey.name, raw.id);
  mkdirSync(folder, { recursive: true });
  const media = [...measures.keys()].map((n) => ({ file: `measure-${n}.txt`, kind: "capture", tags: { user: raw.steps[n - 1].by } }));
  writeFileSync(join(folder, "run.json"), JSON.stringify({ ...raw, verified: raw.steps.filter((s) => s.check).map((s) => s.check), media }));
  for (const [n, m] of measures) writeFileSync(join(folder, `measure-${n}.txt`), JSON.stringify(m));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(folder, name), body);
  return folder;
}

test("the baseline is main's newest run of the same journey version, until a person accepts a run of the change", () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-compare-"));
  const mainDir = join(dir, "main");
  const runs = join(dir, "runs");
  const mainFolder = folderOf(mainDir, MAIN(), { "step-1.png": PNG });
  const first = folderOf(runs, MOVED(), { "step-1.png": PNG });
  assert.equal(baselineFor(first, mainDir).folder, mainFolder);
  assert.match(baselineFor(first, join(dir, "nowhere")).why, /main/);
  assert.equal(compareFolder(first, {}).why !== null, true, "with no main folder nothing is compared");

  const found = compareFolder(first, { mainDir });
  assert.equal(outcome(found, "you").outcome, "worse");
  const before = readRunJson(first);
  const written = addCompareFindings(first, found);
  assert.deepEqual([written.result, written.steps], [before.result, before.steps], "a finding never changes a verdict or the result");
  assert.ok(written.findings.every((f) => f.criterion.startsWith("compare-")));

  const second = folderOf(runs, MOVED({ id: "pr-2", started_at: "2026-11-26T11:00:00Z" }));
  assert.equal(baselineFor(second, mainDir).folder, mainFolder, "findings nobody answered accept nothing");
  assert.match(compareFolder(first, { mainDir }).stale, /newer run/, "an older run of the change is never shown as current");
  const asked = written.findings.filter((f) => f.ask);
  assert.ok(asked.length >= 1 && asked.length < written.findings.length, "a finding that asks nothing needs no call");
  addReview(first, { on: asked[0].id, by: "pat@example.test", says: "No. Put it back." });
  for (const f of asked.slice(1)) addReview(first, { on: f.id, by: "pat@example.test", says: "Accepted: fine." });
  assert.equal(baselineFor(second, mainDir).folder, mainFolder, "a call that says no accepts nothing");
  addReview(first, { on: asked[0].id, by: "pat@example.test", says: "Accepted: billing moved on purpose." });
  assert.equal(baselineFor(second, mainDir).folder, first, "a person accepting every finding makes that run the baseline");
  const after = compareFolder(second, { mainDir });
  assert.deepEqual([outcome(after, "you").outcome, after.stale, after.against], ["same", null, "the accepted run"]);
  assert.doesNotMatch(outcome(after, "you").says, /main/, "a run compared with an accepted run never says main");
  assert.equal(compareFolder(`${second}/`, { mainDir }).stale, null, "the same folder written another way is not a newer run");
  writeFileSync(join(runs, ".DS_Store"), "");
  mkdirSync(join(runs, "old", "draft"), { recursive: true });
  writeFileSync(join(runs, "old", "draft", "run.json"), JSON.stringify({ id: "draft", started_at: "2026-11-01T10:00:00Z", steps: [], outcomes: [] }));
  assert.deepEqual(compareAll(runs, { mainDir }).map((c) => c.change.run.id), ["pr-2"], "a stray file and a draft 0 run are left out");
  assert.match(compareFolder(first, { mainDir }).questions[0].calls[0].by, /pat/, "the page can say who accepted");

  const text = compareReport(compareAll(runs, { mainDir }));
  assert.match(text, /review-a-claim/);
  assert.match(text, /you\s+same/i);
  const cli = new URL("../bin/journeysfirst.js", import.meta.url).pathname;
  const markdown = execFileSync(process.execPath, [cli, "compare", first, "--main", mainDir, "--markdown"], { encoding: "utf8" });
  assert.match(markdown, /\| you \| Got worse \|/);

  const out = join(dir, "out");
  exportReview(runs, out, { mainDir });
  const page = readFileSync(join(out, "runs", "review-a-claim", "pr-1", "compare.html"), "utf8");
  assert.match(page, /Got worse/);
  assert.match(page, /src="assets\/main-step-1\.png"/, "main's screen is in the page with the change's, from a file in the export");
  assert.ok(page.indexOf('data-side="main"') < page.indexOf('data-side="change"'), "with scripts off both screens show, main first");
  assert.doesNotMatch(page, /<script[^>]+src=/, "the switch needs nothing but the page");
  assert.deepEqual([...page.matchAll(/data-tab="(\w+)"/g)].slice(0, 3).map((m) => m[1]), ["change", "main", "both"], "the change first, then main, then side by side");
  assert.doesNotMatch(page, /(?:href|src)="\//, "the export opens from a folder, with no server");
  assert.match(readFileSync(join(out, "compare.html"), "utf8"), /runs\/review-a-claim\/pr-2\/compare\.html/);
});

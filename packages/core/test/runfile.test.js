import assert from "node:assert/strict";
import { test } from "node:test";
import { journeyPlan, parseJourney, validateJourney } from "../src/format/format.js";
import { checkRun } from "../src/format/run-check.js";
import { runDigest, runFiles, runResult, settle, settleCheck, validateRun, verifiedLists } from "../src/format/runfile.js";
import { JOURNEY, findings, recordAllPassed, recorder, specRun } from "./helpers.js";

const plan = () => journeyPlan(parseJourney(JOURNEY));
/** A valid passing run, as plain JSON. */
const goodRun = () => structuredClone(recordAllPassed(recorder()).result().run);
/** Problems after changing a good run. */
const after = (change, withPlan) => {
  const run = goodRun();
  change(run);
  return validateRun(run, withPlan ? plan() : undefined);
};

test("attempt status can prevent a pass without hiding a recorded failure", () => {
  const { steps } = goodRun();
  const aborted = { status: "aborted", reason: "The runner timed out." };
  assert.equal(runResult(steps, { status: "complete" }), "passed");
  assert.equal(runResult(steps, aborted), "not_fully_checked");
  assert.equal(runResult(specRun().steps, aborted), "failed");
});

test("a recorded run is valid, and matches the journey's lines", () => {
  assert.deepEqual(validateRun(goodRun(), plan()), []);
});

test("v1 checks can still use launcher as metadata without changing the proof needed", () => {
  const journey = parseJourney(JOURNEY.replace("    id: link-on\n", "    id: link-on\n    launcher: codex\n"));
  assert.deepEqual(validateJourney(journey), []);
  assert.deepEqual(journeyPlan(journey), plan());
  const run = goodRun();
  run.steps[1].launcher = "codex";
  assert.deepEqual(validateRun(run, journeyPlan(journey)), []);
  assert.equal(settleCheck(run.steps[1]).verdict, "passed");
});

test("journeysfirst is optional, and a version string when present", () => {
  assert.deepEqual(after((r) => delete r.journeysfirst), []);
  assert.deepEqual(after((r) => (r.journeysfirst = 2)), ['journeysfirst must be the version of Journeys First that wrote the run, like "0.0.3".']);
});

test("required fields", () => {
  assert.deepEqual(validateRun(null), ["The file is not a run."]);
  assert.deepEqual(after((r) => (r.format = "journeysfirst-run/v0")), ['format must be "journeysfirst-run/v1".']);
  assert.deepEqual(after((r) => delete r.id), ["id is missing: give the run an id that never changes, like 2026-11-08-1802-7d2e."]);
  assert.deepEqual(after((r) => (r.id = "a/b")), ['id "a/b" must be a plain folder name: letters, digits, dots, dashes and underscores.']);
  assert.deepEqual(after((r) => delete r.journey), ["journey is missing: say which journey ran, as {name, version, case}."]);
  assert.deepEqual(after((r) => delete r.journey.name), ["journey.name must be the journey's file name, without .journey.yaml."]);
  assert.deepEqual(after((r) => delete r.journey.version), ["journey.version is missing: the version of the journey that ran."]);
  assert.deepEqual(after((r) => delete r.journey.case), ["journey.case must be the id of the case that ran, or null when the journey has no cases."]);
  assert.deepEqual(after((r) => delete r.started_at), ["started_at must be an ISO time, like 2026-11-08T18:02:11Z."]);
  assert.deepEqual(after((r) => (r.finished_at = "later")), ["finished_at must be an ISO time."]);
  assert.deepEqual(after((r) => (r.steps = [])), ["steps must list every step of the journey, in order."]);
  assert.deepEqual(after((r) => (r.result = "ok")), ["result must be one of: passed, failed, not_fully_checked."]);
});

test("the file names no project", () => {
  assert.deepEqual(after((r) => (r.project = "acme")), ["Remove project. A run belongs to whichever project it is published to."]);
});

test("a draft 0 run file is named as such", () => {
  assert.deepEqual(validateRun({ format: "journeysfirst-run/v1", steps: [], outcomes: [] }), [
    "This is a draft 0 run file: it has outcomes, not checks in steps. Run the journey again to write a v1 run.",
  ]);
});

test("action steps", () => {
  assert.deepEqual(after((r) => delete r.steps[0].says), ["step 1 has neither says (an action) nor check (a check)."]);
  assert.deepEqual(after((r) => (r.steps[0].check = "x")), ["step 1 has both says and check. An action has says; a check has check and id."]);
  assert.deepEqual(after((r) => delete r.steps[0].by), ["step 1 has no by: say who did it, you or a name from users."]);
  assert.deepEqual(after((r) => (r.steps[0].by = "admin")), ['step 1 has by "admin", which is not in users (you, viewer).']);
  // A line nobody did can leave out by.
  const notRun = (r) => {
    Object.assign(r.steps[4], { status: "not_run" });
    delete r.steps[4].by;
    r.result = "not_fully_checked";
  };
  assert.deepEqual(after(notRun), []);
  assert.deepEqual(after((r) => (r.steps[0].status = "ok")), ["step 1 status must be one of: done, failed, blocked, not_run."]);
  assert.deepEqual(after((r) => (r.steps[0].at = -1)), ["step 1 at must be seconds from the start of the run."]);
  assert.deepEqual(after((r) => (r.steps[0].took = "2s")), ["step 1 took must be a number of seconds."]);
  assert.deepEqual(after((r) => (r.steps[0].screenshots = ["../x.png"])), ["step 1 screenshots must be a list of file names in the run folder."]);
});

test("failed and blocked steps need a cause and a reason", () => {
  assert.deepEqual(after((r) => (r.steps[0].status = "blocked")), [
    "step 1 is blocked, so it needs a cause: product, test, environment.",
    "step 1 is blocked, so it needs a reason: what went wrong, in one plain sentence.",
  ]);
  const productBug = (r) => {
    Object.assign(r.steps[0], { status: "failed", cause: "product", reason: "The toggle did nothing." });
    r.result = "failed";
  };
  assert.deepEqual(after(productBug), []);
  assert.deepEqual(after((r) => (r.steps[0].cause = "luck")), ["step 1 cause must be one of: product, test, environment."]);
});

test("check steps", () => {
  assert.deepEqual(after((r) => delete r.steps[1].id), ['step 2 (check "undefined") has no id.']);
  assert.deepEqual(after((r) => (r.steps[1].verdict = "ok")), ['step 2 (check "link-on") verdict must be one of: passed, failed, blocked, not_checked.']);
  assert.deepEqual(after((r) => delete r.steps[1].proof), ['step 2 (check "link-on") has no proof: say how it was proven, in one plain sentence.']);
  assert.deepEqual(after((r) => (r.steps[1].evidence = "yes")), ['step 2 (check "link-on") evidence must be a list.']);
  assert.deepEqual(after((r) => (r.steps[1].claimed = "failed")), ['step 2 (check "link-on") claimed can only be "passed", on a not_checked check.']);
  assert.deepEqual(after((r) => (r.steps[1].added = "yes")), ['step 2 (check "link-on") added must be true or false.']);
});

test("evidence says its source, its login and how to look it up again", () => {
  const evidence = (item) => after((r) => (r.steps[1].evidence = [item, ...r.steps[1].evidence]));
  assert.deepEqual(evidence("a screenshot"), ['step 2 (check "link-on"): evidence must be an object with source and login.']);
  assert.deepEqual(evidence({ source: "vibes", login: "you" }), ['step 2 (check "link-on"): evidence source must be one of: page, api, database, log, message, launcher.']);
  assert.deepEqual(evidence({ source: "page", url: "/" }), ['step 2 (check "link-on"): evidence needs login: whose login it came from, you or a name from users. A read with an admin or service key names it in key instead.']);
  assert.deepEqual(evidence({ source: "page", login: "you" }), ['step 2 (check "link-on"): page evidence needs url, so someone can look it up again.']);
  assert.deepEqual(evidence({ source: "database", login: "you" }), ['step 2 (check "link-on"): database evidence needs query, so someone can look it up again.']);
  assert.deepEqual(evidence({ source: "message", login: "you" }), ['step 2 (check "link-on"): message evidence needs message_id, so someone can look it up again.']);
  assert.deepEqual(evidence({ source: "log", login: "admin", query: "service=api" }), ['step 2 (check "link-on"): evidence login "admin" is not in users (you, viewer).']);
  assert.deepEqual(evidence({ source: "log", login: "you", query: "service=api level=error" }), []);
});

test("a read with an admin or service key names the key instead of a login, and never stands in for a user", () => {
  const evidence = (item) => after((r) => (r.steps[1].evidence = [item, ...r.steps[1].evidence]));
  assert.deepEqual(evidence({ source: "database", key: "DB_SERVICE_KEY", query: "select 1" }), []);
  assert.deepEqual(evidence({ source: "database", login: "you", key: "DB_SERVICE_KEY", query: "select 1" }), ['step 2 (check "link-on"): evidence has both login and key. Use login for a user\'s own session, key for an admin or service key.']);
  const alone = settleCheck({ check: "x", id: "x", by: "you", verdict: "passed", evidence: [{ source: "database", key: "DB_SERVICE_KEY", query: "select 1" }] });
  assert.equal(alone.verdict, "not_checked");
  assert.equal(alone.reason, "No evidence came from your own login.");
  const both = settleCheck({ check: "x", id: "x", by: "you", verdict: "passed", evidence: [{ source: "database", key: "DB_SERVICE_KEY", query: "select 1" }, { source: "page", login: "you", url: "/" }] });
  assert.equal(both.verdict, "passed");
});

test("a pass needs evidence from the login of the user in by, or a reader settles it", () => {
  const run = goodRun();
  run.steps[3].evidence = [{ source: "page", login: "you", url: "/view/q3-plan" }];
  const { run: settled, settled: ids, problems } = checkRun(run);
  assert.deepEqual(problems, []);
  assert.deepEqual(ids, ["viewer-sees-it"]);
  assert.equal(settled.steps[3].reason, "No evidence came from the viewer's own login.");
});

test("a claimed pass with no evidence becomes not_checked, keeping the claim", () => {
  const settled = settleCheck({ check: "Link sharing is on.", id: "link-on", by: "you", verdict: "passed", proof: "Looked fine." });
  assert.equal(settled.verdict, "not_checked");
  assert.equal(settled.claimed, "passed");
  assert.equal(settled.reason, "No evidence was attached.");
  const other = settleCheck({ check: "x", id: "x", by: "viewer", verdict: "passed", evidence: [{ source: "page", login: "you", url: "/" }] });
  assert.equal(other.verdict, "not_checked");
  assert.equal(other.reason, "No evidence came from the viewer's own login.");
  const failed = { check: "x", id: "x", by: "you", verdict: "failed" };
  assert.equal(settleCheck(failed), failed);
});

test("the result: passed, failed, or not fully checked", () => {
  const check = (verdict) => ({ check: "x", id: "x", by: "you", verdict });
  const action = (status, cause) => ({ says: "Do it.", by: "you", status, ...(cause ? { cause, reason: "It broke." } : {}) });
  assert.equal(runResult([check("passed"), check("passed")]), "passed");
  assert.equal(runResult([action("done"), check("passed")]), "passed");
  assert.equal(runResult([check("passed"), check("failed"), check("blocked")]), "failed");
  assert.equal(runResult([check("passed"), check("blocked")]), "not_fully_checked");
  assert.equal(runResult([check("passed"), check("not_checked")]), "not_fully_checked");
  assert.equal(runResult([action("done")]), "not_fully_checked");
});

test("passed needs every action done; an action the product broke fails the run", () => {
  const check = { check: "x", id: "x", by: "you", verdict: "passed" };
  const action = (status, cause) => ({ says: "Do it.", by: "you", status, ...(cause ? { cause, reason: "It broke." } : {}) });
  assert.equal(runResult([action("failed", "product"), check]), "failed");
  assert.equal(runResult([action("failed", "test"), check]), "not_fully_checked");
  assert.equal(runResult([action("failed", "environment"), check]), "not_fully_checked");
  assert.equal(runResult([action("blocked", "environment"), check]), "not_fully_checked");
  assert.equal(runResult([action("not_run"), check]), "not_fully_checked");
  assert.deepEqual(after((r) => Object.assign(r.steps[4], { status: "failed", cause: "test", reason: "The locator broke." })), ['result is "passed", but the steps give "not_fully_checked".']);
  assert.deepEqual(after((r) => (r.steps[4].status = "not_run")), ['result is "passed", but the steps give "not_fully_checked".']);
});

test("verified and not_verified must match the checks", () => {
  assert.deepEqual(after((r) => r.verified.pop()), ['verified must list exactly the checks that passed: ["Link sharing is still on after a reload.","The viewer sees \\"Q3 plan\\".","The viewer can no longer see \\"Q3 plan\\"."].']);
  assert.deepEqual(after((r) => (r.verified = [...r.verified, "Something extra."])).length, 1);
  assert.deepEqual(after((r) => (r.not_verified = ["Link sharing is still on after a reload: it wasn't."])), [
    "not_verified must have one sentence for each check that did not pass, in order, each starting with the check: [].",
  ]);
  // The runner's own words after the check are fine, as in the spec's example.
  const failing = (change) =>
    after((r) => {
      Object.assign(r.steps[6], { verdict: "failed", cause: "product", reason: "The link still works." });
      Object.assign(r, { result: "failed", verified: r.verified.slice(0, 2), not_verified: ['The viewer can no longer see "Q3 plan": the viewer still saw it.'] });
      change(r);
    });
  assert.deepEqual(failing(() => {}), []);
  assert.equal(failing((r) => (r.not_verified = [])).length, 1);
});

test("a stored result the rules would change is a problem", () => {
  assert.deepEqual(after((r) => (r.steps[6].verdict = "not_checked")), [
    'result is "passed", but the steps give "not_fully_checked".',
    'verified must list exactly the checks that passed: ["Link sharing is still on after a reload.","The viewer sees \\"Q3 plan\\"."].',
    'not_verified must have one sentence for each check that did not pass, in order, each starting with the check: ["The viewer can no longer see \\"Q3 plan\\""].',
  ]);
});

test("checkRun turns a claimed pass without proof into not_checked and works the result out again", () => {
  const run = goodRun();
  run.steps[3].evidence = [];
  const { run: settled, settled: ids, problems } = checkRun(run, parseJourney(JOURNEY));
  assert.deepEqual(problems, []);
  assert.deepEqual(ids, ["viewer-sees-it"]);
  assert.equal(settled.steps[3].verdict, "not_checked");
  assert.equal(settled.steps[3].claimed, "passed");
  assert.equal(settled.result, "not_fully_checked");
  assert.equal(settled.summary, undefined);
  assert.deepEqual(settled.not_verified, ['The viewer sees "Q3 plan": no evidence was attached.']);
  assert.deepEqual(validateRun(settled, plan()), []);
  const good = goodRun();
  assert.equal(checkRun(good).run, good);
  // A stored result that was already wrong is a problem, reported against the file as stored.
  const wrong = goodRun();
  wrong.steps[3].evidence = [];
  wrong.steps[4].status = "not_run";
  assert.match(checkRun(wrong).problems.join("\n"), /result is "passed", but the steps give "not_fully_checked"/);
  assert.equal(checkRun(wrong).run.result, "not_fully_checked");
});

test("verified and not verified are plain sentences", () => {
  const lists = verifiedLists([
    { check: "Link sharing is on.", id: "a", by: "you", verdict: "passed" },
    { check: 'The viewer can no longer see "Q3 plan".', id: "b", by: "viewer", verdict: "failed", reason: "The viewer still saw it." },
    { check: "One text is sent.", id: "c", by: "you", verdict: "not_checked" },
  ]);
  assert.deepEqual(lists, {
    verified: ["Link sharing is on."],
    not_verified: ['The viewer can no longer see "Q3 plan": the viewer still saw it.', "One text is sent: not checked."],
  });
});

test("optional fields keep their shape", () => {
  assert.deepEqual(after((r) => (r.media = [{ file: "you.webm", kind: "video", tags: { person: "you" } }])), ["media item 1: tags.person is now called user. Rename it."]);
  assert.deepEqual(after((r) => (r.tags = ["staging"])), ['tags must be an object, like {environment: "staging"}.']);
  assert.deepEqual(after((r) => (r.users = { you: 3, viewer: null })), ['users must map each user to the account used, like {you: "owner@example.test"}.']);
  assert.deepEqual(after((r) => (r.played_by = { viewer: "Claude Code 2.4.1, opus" })), []);
  assert.deepEqual(after((r) => (r.repeat = { batch: "b1", n: 2, of: 5 })), []);
  assert.deepEqual(after((r) => (r.repeat = { batch: "b1", n: 6, of: 5 })), ['repeat must be {batch, n, of}: one of several runs of the same journey, like {batch: "a1b2c3d4", n: 2, of: 5}.']);
  assert.deepEqual(after((r) => (r.played_by = { viewer: "" })), ['played_by must map a user to who played it, like {agent: "Claude Code 2.4.1, opus"}.']);
  assert.deepEqual(after((r) => (r.played_by = { admin: "a script" })), ['played_by names "admin", which is not in users.']);
  assert.deepEqual(after((r) => (r.values = { phone: "+1 555" })), ["values.phone must be {value}, or {secret: true} for a secret."]);
  assert.deepEqual(after((r) => (r.values = { phone: { secret: true }, link: { value: "/v/1" }, plan: { value: "Q3", secret: false } })), []);
  assert.deepEqual(after((r) => (r.values = { link: {} })), ["values.link needs value, or secret: true for a secret."]);
});

test("a run with people is refused: it is now called users", () => {
  assert.deepEqual(after((r) => (r.people = r.users) && delete r.users), ["people is now called users. Rename it."]);
});

test("a secret value is never in a run file", () => {
  assert.deepEqual(after((r) => (r.values = { phone: { value: "+1 555", secret: true } })), [
    "values.phone is secret, so it must not carry its value. Write {secret: true}, as the journeysfirst recorder does. A run folder from an older recorder has the value: run the journey again.",
  ]);
  assert.deepEqual(after((r) => (r.repos = [{ commit: "abc" }])), ["repos item 1 needs repo, like owner/name."]);
  assert.deepEqual(after((r) => (r.media = [{ file: "you.mp4" }])), ["media item 1 needs file (a file name in the run folder) and kind."]);
  assert.deepEqual(after((r) => (r.media = [{ file: "you.mp4", kind: "video", starts_at: "soon" }])), ["media item 1: starts_at must be seconds from the start of the run."]);
  assert.deepEqual(after((r) => (r.summary = "")), ["summary must be a plain sentence."]);
  assert.deepEqual(after((r) => (r.verified = "all")), ["verified must be a list of plain sentences."]);
  assert.deepEqual(after((r) => (r.ran_by = "codex")), ["ran_by must be an object, like {agent, model}."]);
  assert.deepEqual(after((r) => (r.anything_new = { kept: true })), []);
});

test("reviews sit apart and never change a verdict", () => {
  const review = { by: "pat@example.test", at: "2026-11-08T18:20:00Z", on: "viewer-blocked", says: "Confirmed bug." };
  assert.deepEqual(after((r) => (r.reviews = [review])), []);
  assert.deepEqual(after((r) => (r.reviews = [{ ...review, on: "nope" }])), ['review 1 is on "nope", which is not a check id or a finding id in this run.']);
  assert.deepEqual(after((r) => (r.reviews = [{ by: "pat" }])), ["review 1 needs by, at, on and says."]);
});

test("a run with no findings is valid, and so is one with findings or an empty list", () => {
  assert.equal(goodRun().findings, undefined, "the recorder writes none: a run is not reviewed until a review says so");
  assert.deepEqual(validateRun(goodRun(), plan()), []);
  assert.deepEqual(after((r) => (r.findings = []), true), []);
  assert.deepEqual(after((r) => (r.findings = findings()), true), []);
});

test("the findings and reviews in the spec's example are valid", () => {
  const { findings: found, reviews } = specRun();
  assert.equal(found.length, 2);
  assert.deepEqual(after((r) => Object.assign(r, { findings: found, reviews }), true), []);
});

test("a finding needs an id, a criterion, a sentence and evidence", () => {
  const one = (change) => after((r) => {
    r.findings = findings();
    change(r.findings[0], r);
  });
  assert.deepEqual(after((r) => (r.findings = { id: "x" })), ["findings must be a list of {id, criterion, says, evidence}. Write an empty list when the review found nothing."]);
  assert.deepEqual(after((r) => (r.findings = ["slow"])), ["finding 1 must be an object with id, criterion, says and evidence."]);
  assert.deepEqual(one((f) => delete f.id), ["finding 1 has no id: give it a plain id, like intuitive-feedback-1."]);
  assert.deepEqual(one((f) => (f.id = "step 1")), ['finding 1 ("step 1") needs a plain id: letters, digits, dots, dashes and underscores.']);
  assert.deepEqual(one((f) => (f.id = "link-on")), ['finding 1 ("link-on") has the id of a check in this run. Give it its own id, like intuitive-feedback-1.']);
  assert.deepEqual(one((f, r) => (r.findings[1].id = f.id)), ['finding 2 ("intuitive-feedback-1") has the same id as an earlier finding. Each finding needs its own id.']);
  assert.deepEqual(one((f) => delete f.criterion), ['finding 1 ("intuitive-feedback-1") has no criterion: the id of the criterion it is about, like intuitive-feedback.']);
  assert.deepEqual(one((f) => (f.says = "")), ['finding 1 ("intuitive-feedback-1") has no says: what was found, in one plain sentence.']);
  for (const none of [undefined, [], "a screenshot"]) {
    assert.deepEqual(one((f) => (f.evidence = none)), ['finding 1 ("intuitive-feedback-1") has no evidence: say what you measured or saw, with its url and login.']);
  }
  assert.deepEqual(one((f) => (f.evidence[0].login = "admin")), ['finding 1 ("intuitive-feedback-1"): evidence login "admin" is not in users (you, viewer).']);
  assert.deepEqual(one((f) => delete f.evidence[0].url), ['finding 1 ("intuitive-feedback-1"): page evidence needs url, so someone can look it up again.']);
  for (const step of [0, 8, 1.5, "1"]) {
    assert.deepEqual(one((f) => (f.step = step)), ['finding 1 ("intuitive-feedback-1") step must be the number of the step it is about, from 1 to 7. Leave it out when it is about the whole journey.']);
  }
  assert.deepEqual(one((f) => delete f.step), [], "a finding about the whole journey has no step");
  assert.deepEqual(one((f) => (f.ask = true)), ['finding 1 ("intuitive-feedback-1") ask must be the one question for a person, as a plain sentence.']);
  assert.deepEqual(one((f) => (f.measured = { ms: 3100 })), [], "extra fields are kept");
});

test("a finding never changes a verdict or the result", () => {
  const plain = goodRun();
  const reviewed = { ...structuredClone(plain), findings: findings() };
  assert.equal(runResult(reviewed.steps), runResult(plain.steps));
  const { findings: kept, ...settled } = settle(reviewed).run;
  assert.deepEqual(settled, settle(plain).run);
  assert.deepEqual(kept, findings(), "settling keeps the findings as they are");
  assert.equal(checkRun(reviewed).run.result, "passed");
});

test("a review can be on a finding, by its id", () => {
  const review = { by: "ana@example.test", at: "2026-11-08T18:25:00Z", on: "foundation-values-3", says: "Keep it." };
  assert.deepEqual(after((r) => Object.assign(r, { findings: findings(), reviews: [review] })), []);
  assert.deepEqual(after((r) => Object.assign(r, { findings: [], reviews: [review] })), ['review 1 is on "foundation-values-3", which is not a check id or a finding id in this run.']);
});

test("steps must match the journey's lines, in order", () => {
  const drop = (r) => {
    r.steps.pop();
    r.verified.pop();
  };
  assert.deepEqual(after(drop, true), ["steps has 6 items, but the journey has 7 lines. Every line needs a step, in order."]);
  assert.deepEqual(after((r) => (r.journey.case = "not-now"), true), ['journey.case is "not-now", but the journey\'s lines are for case null.']);
  assert.deepEqual(after((r) => (r.steps[0].says = "Turn it on."), true), ['step 1 should be the action "Turn on link sharing and send the link to the viewer.".']);
  assert.deepEqual(after((r) => (r.steps[1].id = "still-on"), true), ['step 2 should be the check "Link sharing is still on after a reload." with id "link-on".']);
  // by is the runner's call, not read from the sentence.
  assert.deepEqual(after((r) => (r.steps[2].by = "you"), true), []);
  assert.deepEqual(after((r) => (r.steps[1].added = true), true), ['step 2 (check "link-on") must copy added: true from the journey only when the journey has it.']);
  assert.deepEqual(after((r) => (r.journey.version = "00000000"), true), [`journey.version is "00000000", but the journey file is "${plan().version}". The journey changed since this run.`]);
});

test("run files are the screenshots and media", () => {
  const run = goodRun();
  run.media = [{ file: "you.webm", kind: "video" }];
  run.steps[4].screenshots = [{ file: "step-5.png", url: "https://app.example.test/p/q3-plan" }];
  assert.deepEqual(runFiles(run), ["step-1.png", "step-3.png", "step-5.png", "you.webm"]);
});

test("a screenshot is a file name, or {file, url} with the full address of its page", () => {
  const shot = (s) => (r) => (r.steps[0].screenshots = [s]);
  assert.deepEqual(after(shot("step-1.png")), []);
  assert.deepEqual(after(shot({ file: "step-1.png", url: "https://app.example.test/p/q3-plan?tab=share" })), []);
  assert.deepEqual(after(shot({ file: "step-1.png" })), []);
  assert.deepEqual(after(shot({ file: "../step-1.png", url: "https://app.example.test/" })), ["step 1 screenshots must be a list of file names in the run folder."]);
  assert.deepEqual(after(shot({ file: "step-1.png", url: "/p/q3-plan" })), ["step 1 screenshot step-1.png needs url to be the full address of the page, like https://app.example.test/p/q3-plan."]);
  assert.deepEqual(after(shot({ file: "step-1.png", url: "about:blank" })), ["step 1 screenshot step-1.png needs url to be the full address of the page, like https://app.example.test/p/q3-plan."]);
});

test("the digest ignores key order and formatting, and changes with content", () => {
  const run = goodRun();
  const files = { "step-1.png": "aa", "step-3.png": "bb" };
  const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(run).reverse())));
  assert.equal(runDigest(reordered, { "step-3.png": "bb", "step-1.png": "aa" }), runDigest(run, files));
  assert.notEqual(runDigest({ ...run, summary: "Changed." }, files), runDigest(run, files));
  assert.notEqual(runDigest(run, { ...files, "step-3.png": "cc" }), runDigest(run, files));
});

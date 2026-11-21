import assert from "node:assert/strict";
import { test } from "node:test";
import { journeyName, journeyPlan, journeyVersion, journeyWarnings, parseJourney, validateJourney } from "../src/format/format.js";
import { CASES, DRAFT_0, JOURNEY } from "./helpers.js";

const problems = (text) => validateJourney(parseJourney(text));
/** Problems for the example journey after changing it. */
const after = (change) => {
  const journey = structuredClone(parseJourney(JOURNEY)); // a copy has no source lines
  change(journey);
  return validateJourney(journey);
};

test("the doc examples are valid", () => {
  assert.deepEqual(problems(JOURNEY), []);
  assert.deepEqual(problems(CASES), []);
});

test("format must be v1 or draft 0", () => {
  assert.deepEqual(after((j) => (j.format = "journeysfirst/v2")), ['format must be "journeysfirst/v1".']);
  assert.deepEqual(validateJourney("hello"), ["The file is not a journey. It should have format, title, promise, start and steps."]);
});

test("title, promise and start are required", () => {
  assert.deepEqual(after((j) => delete j.title), ['title is missing: add a one-line name, like "Share a presentation by link".']);
  assert.deepEqual(after((j) => (j.title = "Share\na link")), ["title must be one line."]);
  assert.deepEqual(after((j) => delete j.promise), ["promise is missing: add what the person asked for, in their own words."]);
  assert.deepEqual(after((j) => delete j.start), ["start is missing: say what is true before the first step."]);
});

test("setup and notes must be text", () => {
  assert.deepEqual(after((j) => (j.setup = 3)), ["setup must be the name of the app's setup script."]);
  assert.deepEqual(after((j) => (j.notes = { a: 1 })), ["notes must be text."]);
  assert.deepEqual(after((j) => (j.notes = ["Use the staging app.", "The viewer has no account."])), []);
});

test("users are role words for the others", () => {
  assert.deepEqual(after((j) => (j.users = "viewer")), ["users must be a list of role words, like [viewer]."]);
  assert.deepEqual(after((j) => (j.users = [])), ["users is empty. Leave it out when only you act."]);
  assert.deepEqual(after((j) => (j.users = ["viewer", "you"])), ['users: leave out "you". You are the main user and are not listed.']);
  assert.deepEqual(after((j) => (j.users = ["viewer", "The Admin"])), ['users: "The Admin" is not a role word. Use one lowercase word, like viewer.']);
  assert.deepEqual(after((j) => (j.users = ["viewer", "viewer"])), ['users: "viewer" is listed twice.']);
  assert.deepEqual(after((j) => (j.users = ["viewer", "admin"])), []);
});

test("people is refused: it is now called users", () => {
  const old = JOURNEY.replace("users: [viewer]", "people: [viewer]");
  assert.deepEqual(problems(old), ["line 4: people is now called users. Rename it."]);
});

test("steps are sentences or checks with ids", () => {
  assert.deepEqual(after((j) => (j.steps = [])), ["steps is missing: list what happens, one line per step, top to bottom."]);
  assert.deepEqual(after((j) => (j.steps[0] = " ")), ["step 1: the step is empty."]);
  assert.deepEqual(after((j) => (j.steps[0] = { do: "Turn it on.", also: 1 })), ["step 1: the step is not a sentence or a check. Write a plain sentence, or check: <sentence> with an id."]);
  assert.deepEqual(after((j) => (j.steps[0] = ["Turn it on."])), ["step 1: the step is not a sentence or a check. Write a plain sentence, or check: <sentence> with an id."]);
  assert.deepEqual(after((j) => (j.steps[1].check = "")), ["step 2: the check has no sentence. Say what must be true at this point."]);
  assert.deepEqual(after((j) => delete j.steps[1].id), ['step 2: the check "Link sharing is still on after a reload." has no id. Every check needs an id, like id: link-on.']);
  assert.deepEqual(after((j) => (j.steps[1].id = "Link_On")), ['step 2: id "Link_On" must be lowercase words joined by dashes, like link-on.']);
  assert.deepEqual(after((j) => (j.steps[3].id = "link-on")), ['step 4: id "link-on" is already used by step 2.']);
  assert.deepEqual(after((j) => (j.steps[1].added = "yes")), ["step 2: added must be true or false."]);
  assert.deepEqual(after((j) => (j.steps = ["Turn on link sharing.", "The viewer opens the link."])), ["there is no check. Add at least one check: line that must be true."]);
});

test("a step with a colon says to quote the sentence", () => {
  const text = JOURNEY.replace("  - Turn off link sharing.", "  - Tap Share: then turn it off.");
  assert.deepEqual(problems(text), ['line 13, step 5: the step has a colon, so it was read as a field. Put the sentence in quotes: - "Tap Share: then turn it off."']);
});

test("check ids and case ids must be text, not numbers or null", () => {
  assert.deepEqual(problems(JOURNEY.replace("id: link-on", "id: 12")), ['line 9, step 2: id 12 must be text. Put it in quotes, like id: "12", or use words, like link-on.']);
  assert.deepEqual(problems(JOURNEY.replace("id: link-on", "id: null")), ['line 8, step 2: the check "Link sharing is still on after a reload." has no id. Every check needs an id, like id: link-on.']);
  assert.deepEqual(problems(JOURNEY.replace("id: link-on", 'id: "12"')), []);
  assert.deepEqual(problems(CASES.replace("id: not-now", "id: 2")), ['line 14, case 2: case id 2 must be text. Put it in quotes, like id: "2", or use words, like link-on.']);
  assert.deepEqual(problems(CASES.replace("id: not-now", "id: ~")), ["line 13, case 2: the case has no id. Add one, like id: not-now."]);
});

test("a line that starts with someone not in users is a warning, not a problem", () => {
  const text = JOURNEY.replace("  - Turn off link sharing.", "  - The admin turns off link sharing.");
  assert.deepEqual(problems(text), []);
  assert.deepEqual(journeyWarnings(parseJourney(text)), [
    'line 13, step 5: this line starts with "The admin", but admin is not in users. If the admin acts or looks, add them to users.',
  ]);
  assert.deepEqual(journeyWarnings(parseJourney(JOURNEY)), []);
  assert.deepEqual(journeyWarnings(parseJourney(DRAFT_0)), []);
  const things = JOURNEY.replace("check: Link sharing is still on after a reload.", `check: 'The note "Buy milk" is in the list.'`).replace(`check: The viewer sees "Q3 plan".`, "check: The list is empty.");
  assert.deepEqual(journeyWarnings(parseJourney(things)), [], "a line about a thing, not a user, is fine");
});

test("an action that starts with a quoted name is a warning: name who acts with a role word", () => {
  const text = JOURNEY.replace("  - Turn off link sharing.", `  - '"Claude Code" turns off link sharing.'`);
  assert.deepEqual(problems(text), []);
  assert.deepEqual(journeyWarnings(parseJourney(text)), [
    'line 13, step 5: this line starts with "Claude Code", a name. If "Claude Code" acts, give it a role word in users, like agent, start the line with "The agent", and say in start who it is.',
  ]);
  const check = JOURNEY.replace(`check: The viewer sees "Q3 plan".`, `check: '"Q3 plan" is what the viewer sees.'`);
  assert.deepEqual(journeyWarnings(parseJourney(check)), [], "a check that starts with a quoted thing is not a user");
});

test("values are written as ${name}", () => {
  assert.deepEqual(after((j) => (j.steps[0] = "Enter ${Phone Number}.")), ['step 1: "${Phone" is not a value. Write values as ${name}, in lowercase with underscores.']);
  assert.deepEqual(after((j) => (j.start = "You have ${phone.")), ['"${phone." is not a value. Write values as ${name}, in lowercase with underscores.']);
});

test("cases each have a name, id, start and steps", () => {
  const cases = (change) => {
    const journey = structuredClone(parseJourney(CASES));
    change(journey);
    return validateJourney(journey);
  };
  assert.deepEqual(cases((j) => (j.steps = ["Do it."])), ["use steps or cases, not both. With cases, each case has its own start and steps."]);
  assert.deepEqual(cases((j) => (j.start = "Signed in.")), ["start goes inside each case when the journey has cases."]);
  assert.deepEqual(cases((j) => (j.cases = [])), ["cases must be a list. Each case has a name, id, start and steps."]);
  assert.deepEqual(cases((j) => delete j.cases[1].name), ['case "not-now": the case has no name. Say in a few words how this case happens.']);
  assert.deepEqual(cases((j) => delete j.cases[1].id), ["case 2: the case has no id. Add one, like id: not-now."]);
  assert.deepEqual(cases((j) => (j.cases[1].id = "Not Now")), ['case "Not Now": case id "Not Now" must be lowercase words joined by dashes, like not-now.']);
  assert.deepEqual(cases((j) => (j.cases[1].id = "number-in-card")), ['case "number-in-card": case id "number-in-card" is already used by case 1.']);
  assert.deepEqual(cases((j) => delete j.cases[1].start), ['case "not-now": the case has no start: say what is true before its first step.']);
  assert.deepEqual(cases((j) => delete j.cases[1].steps), ['case "not-now": steps is missing: list what happens, one line per step, top to bottom.']);
  assert.deepEqual(cases((j) => (j.cases[1].added = 1)), ['case "not-now": added must be true or false.']);
});

test("two cases share a check id only when the check says the same thing", () => {
  const journey = structuredClone(parseJourney(CASES));
  journey.cases[1].steps[2].id = "code-sent";
  assert.deepEqual(validateJourney(journey), [
    'case "not-now", step 3: id "code-sent" is used in case "number-in-card" for a different check. Two cases can share a check id only when the check says the same thing.',
  ]);
  journey.cases[1].steps[2].check = journey.cases[0].steps[2].check;
  assert.deepEqual(validateJourney(journey), []);
});

test("case users are role words", () => {
  const journey = structuredClone(parseJourney(CASES));
  journey.cases[1].users = ["teammate"];
  assert.deepEqual(validateJourney(journey), []);
  assert.deepEqual(journeyPlan(journey, "not-now").everyone, ["you", "teammate"]);
  journey.cases[1].users = ["Team Mate"];
  assert.deepEqual(validateJourney(journey), ['case "not-now": users: "Team Mate" is not a role word. Use one lowercase word, like viewer.']);
});

test("case people is refused: it is now called users", () => {
  const old = CASES.replace("    id: not-now\n", "    id: not-now\n    people: [teammate]\n");
  assert.deepEqual(problems(old), ['line 15, case "not-now": people is now called users. Rename it.']);
});

test("problems name the line they point at", () => {
  const text = JOURNEY.replace("    id: viewer-sees-it\n", "").replace("    id: viewer-blocked", "    id: Viewer Blocked");
  assert.deepEqual(problems(text), [
    'line 11, step 4: the check "The viewer sees "Q3 plan"." has no id. Every check needs an id, like id: link-on.',
    'line 15, step 7: id "Viewer Blocked" must be lowercase words joined by dashes, like link-on.',
  ]);
  assert.throws(() => parseJourney("title: [unclosed\n"), /^Error: line \d+: this is not valid YAML\./);
});

test("unknown fields and notes are kept and don't change the version", () => {
  const journey = parseJourney(`${JOURNEY}tags: [web]\nowner_team: growth\n`);
  assert.deepEqual(validateJourney(journey), []);
  assert.deepEqual(journey.tags, ["web"]);
  assert.equal(journeyVersion(journey), journeyVersion(parseJourney(JOURNEY)));
  journey.steps[1].priority = "high";
  journey.notes = "Use the staging app.";
  assert.equal(journeyVersion(journey), journeyVersion(parseJourney(JOURNEY)));
});

test("the version changes with the fields the format defines", () => {
  const before = journeyVersion(parseJourney(JOURNEY));
  assert.match(before, /^[0-9a-f]{8}$/);
  for (const change of [(j) => (j.promise += " Always."), (j) => (j.steps[1].id = "still-on"), (j) => (j.steps[1].added = true)]) {
    const journey = parseJourney(JOURNEY);
    change(journey);
    assert.notEqual(journeyVersion(journey), before);
  }
});

test("the plan lists every line in order, and everyone in the run", () => {
  const plan = journeyPlan(parseJourney(JOURNEY));
  assert.deepEqual(plan.everyone, ["you", "viewer"]);
  assert.deepEqual(plan.lines.map((l) => [l.n, l.kind, l.id ?? null]), [
    [1, "action", null],
    [2, "check", "link-on"],
    [3, "action", null],
    [4, "check", "viewer-sees-it"],
    [5, "action", null],
    [6, "action", null],
    [7, "check", "viewer-blocked"],
  ]);
  const cases = parseJourney(CASES);
  assert.equal(journeyPlan(cases, "not-now").lines[2].id, "nothing-sent");
  assert.throws(() => journeyPlan(cases), /Say which one runs: number-in-card, not-now/);
  assert.throws(() => journeyPlan(parseJourney(JOURNEY), "not-now"), /has no cases/);
});

test("the journey name is the file name", () => {
  assert.equal(journeyName("journeys/share-by-link.journey.yaml"), "share-by-link");
});

test("draft 0 is still read: validated, versioned and turned into lines", () => {
  const journey = parseJourney(DRAFT_0);
  assert.deepEqual(validateJourney(journey), []);
  assert.match(journeyVersion(journey), /^[0-9a-f]{16}$/);
  journey.steps[0].says = "Link sharing gets turned on.";
  assert.match(validateJourney(journey).join("\n"), /doesn't say who acts/);
  const plan = journeyPlan(parseJourney(DRAFT_0));
  assert.deepEqual(plan.everyone, ["owner", "viewer"]);
  assert.deepEqual(plan.lines.map((l) => [l.kind, l.id ?? l.says]), [
    ["action", "The owner turns on link sharing."],
    ["check", "link-on"],
    ["action", "The viewer opens the link."],
    ["check", "sees-it"],
  ]);
});

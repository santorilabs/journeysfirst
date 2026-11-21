// spec/run-results-v1.schema.json and validateRun must agree on every run file.
// The rules the schema leaves to the validator are the ones a JSON Schema
// cannot say, listed in VALIDATOR_ONLY.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { journeyPlan, parseJourney } from "../src/format/format.js";
import { validateRun } from "../src/format/runfile.js";
import { recordAllPassed, recorder, specRun } from "./helpers.js";

const REPO = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, REPO), "utf8");
const matchesSchema = new Ajv2020({ allErrors: true }).compile(JSON.parse(read("spec/run-results-v1.schema.json")));
const recorded = () => structuredClone(recordAllPassed(recorder()).result().run);

test("the spec's example run is valid, and matches the spec's example journey line by line", () => {
  const plan = journeyPlan(parseJourney(read("spec/journey-v1.example.yaml")));
  assert.deepEqual(validateRun(specRun(), plan), []);
});

const VALID = {
  "spec example": specRun(),
  "a recorded run": recorded(),
  "a run with secrets, a key and repeats": Object.assign(recorded(), {
    values: { phone: { secret: true }, link: { value: "/v/1" }, plan: { value: "Q3", secret: false } },
    repeat: { batch: "a1b2c3d4", n: 2, of: 5 },
    played_by: { viewer: "a script" },
    findings: [],
    anything_new: { kept: true },
  }),
};

/** Each one breaks a rule. Both the schema and the validator must refuse it. */
const INVALID = {
  "another format": (r) => (r.format = "journeysfirst-run/v0"),
  "no id": (r) => delete r.id,
  "an id that is not a folder name": (r) => (r.id = "a/b"),
  "no journey": (r) => delete r.journey,
  "no journey name": (r) => delete r.journey.name,
  "no journey version": (r) => delete r.journey.version,
  "no journey case": (r) => delete r.journey.case,
  "no started_at": (r) => delete r.started_at,
  "a finished_at that is not a time": (r) => (r.finished_at = "later"),
  "no steps": (r) => (r.steps = []),
  "another result": (r) => (r.result = "ok"),
  "a project": (r) => (r.project = "acme"),
  "people instead of users": (r) => (r.people = { you: "a" }),
  "draft 0 outcomes": (r) => (r.outcomes = []),
  "an action with no says": (r) => delete r.steps[0].says,
  "an action with check too": (r) => (r.steps[0].check = "x"),
  "a done action with no by": (r) => delete r.steps[0].by,
  "an action with another status": (r) => (r.steps[0].status = "ok"),
  "a check with says too": (r) => (r.steps[1].says = "x"),
  "a check with no id": (r) => delete r.steps[1].id,
  "a check with another verdict": (r) => (r.steps[1].verdict = "ok"),
  "a passed check with no proof": (r) => delete r.steps[1].proof,
  "a failed check with no cause": (r) => delete r.steps[6].cause,
  "a failed check with no reason": (r) => delete r.steps[6].reason,
  "another cause": (r) => (r.steps[6].cause = "bad luck"),
  "claimed on a passed check": (r) => (r.steps[1].claimed = "passed"),
  "added that is not true or false": (r) => (r.steps[7].added = "yes"),
  "at that is not seconds": (r) => (r.steps[0].at = -1),
  "a screenshot that is not a file name": (r) => (r.steps[0].screenshots = ["../x.png"]),
  "a screenshot url that is not full": (r) => (r.steps[0].screenshots[0].url = "/p/q3-plan"),
  "evidence from another source": (r) => (r.steps[1].evidence[0].source = "memory"),
  "evidence with no login": (r) => delete r.steps[1].evidence[0].login,
  "evidence with a login and a key": (r) => (r.steps[1].evidence[0].key = "SERVICE_ROLE_KEY"),
  "page evidence with no url": (r) => delete r.steps[3].evidence[0].url,
  "database evidence with no query": (r) => (r.steps[1].evidence[0] = { source: "database", key: "SERVICE_ROLE_KEY" }),
  "message evidence with no id": (r) => (r.steps[1].evidence[0] = { source: "message", login: "you" }),
  "a secret with its value": (r) => (r.values.link = { value: "x", secret: true }),
  "a value with no value": (r) => (r.values.link = {}),
  "a value that is plain text": (r) => (r.values.link = "x"),
  "users that are not accounts": (r) => (r.users.you = 3),
  "a repo with no name": (r) => (r.repos[0] = { commit: "abc" }),
  "media with no kind": (r) => delete r.media[0].kind,
  "media tagged person": (r) => (r.media[0].tags = { person: "you" }),
  "a summary that is blank": (r) => (r.summary = ""),
  "verified as text": (r) => (r.verified = "all"),
  "ran_by as text": (r) => (r.ran_by = "codex"),
  "a repeat with no batch": (r) => (r.repeat = { n: 1, of: 2 }),
  "a finding with no evidence": (r) => (r.findings[0].evidence = []),
  "a finding with no criterion": (r) => delete r.findings[0].criterion,
  "a finding on step 0": (r) => (r.findings[0].step = 0),
  "a review with no says": (r) => delete r.reviews[0].says,
};

/** Rules a JSON Schema cannot say. The validator refuses these; the schema accepts them. */
const VALIDATOR_ONLY = {
  "a result the steps don't give": (r) => (r.result = "passed"),
  "verified that doesn't match the checks": (r) => (r.verified = ["Something else."]),
  "a by not in users": (r) => (r.steps[0].by = "admin"),
  "an evidence login not in users": (r) => (r.steps[3].evidence[0].login = "admin"),
  "played_by naming a user not in users": (r) => (r.played_by = { admin: "a script" }),
  "a repeat whose n is past of": (r) => (r.repeat = { batch: "a", n: 3, of: 2 }),
  "a finding with a check's id": (r) => (r.findings[0].id = "link-on"),
  "a finding past the last step": (r) => (r.findings[0].step = 9),
  "a review on an id that isn't there": (r) => (r.reviews[0].on = "nope"),
};

test("the schema and the validator accept the same runs", () => {
  for (const [name, run] of Object.entries(VALID)) {
    assert.deepEqual(validateRun(run), [], `validator: ${name}`);
    assert.ok(matchesSchema(run), `schema: ${name}: ${JSON.stringify(matchesSchema.errors)}`);
  }
});

test("the schema and the validator refuse the same broken runs", () => {
  for (const [name, breakIt] of Object.entries(INVALID)) {
    const run = specRun();
    breakIt(run);
    assert.notDeepEqual(validateRun(run), [], `validator accepted: ${name}`);
    assert.ok(!matchesSchema(run), `schema accepted: ${name}`);
  }
});

test("the rules only the validator checks are the ones a schema cannot say", () => {
  for (const [name, breakIt] of Object.entries(VALIDATOR_ONLY)) {
    const run = specRun();
    breakIt(run);
    assert.notDeepEqual(validateRun(run), [], `validator accepted: ${name}`);
    assert.ok(matchesSchema(run), `schema refused: ${name}. Move it out of VALIDATOR_ONLY.`);
  }
});

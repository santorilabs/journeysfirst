// spec/journey-v1.schema.json and the validator must agree: every journey one
// accepts, the other accepts. The only rules the schema leaves to the validator
// are the ones a JSON Schema cannot say, listed in VALIDATOR_ONLY.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { parseJourney, validateJourney } from "../src/format/format.js";
import { CASES, JOURNEY } from "./helpers.js";

const REPO = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, REPO), "utf8");
const schema = JSON.parse(read("spec/journey-v1.schema.json"));
const matchesSchema = new Ajv2020({ allErrors: true }).compile(schema);
const plain = (text) => JSON.parse(JSON.stringify(parseJourney(text)));

const examples = readdirSync(new URL("examples/", REPO)).flatMap((app) =>
  readdirSync(new URL(`examples/${app}/journeys/`, REPO))
    .filter((f) => f.endsWith(".journey.yaml"))
    .map((f) => `examples/${app}/journeys/${f}`),
);

const VALID = {
  "spec example": read("spec/journey-v1.example.yaml"),
  "spec cases example": read("spec/journey-v1.cases.example.yaml"),
  "test journey": JOURNEY,
  "test cases journey": CASES,
  ...Object.fromEntries(examples.map((path) => [path, read(path)])),
};

/** Each one breaks a rule. Both the schema and the validator must refuse it. */
const INVALID = {
  "no format": (j) => delete j.format,
  "another format": (j) => (j.format = "journeysfirst/v2"),
  "no title": (j) => delete j.title,
  "a blank title": (j) => (j.title = "  "),
  "a title on 2 lines": (j) => (j.title = "Share\nby link"),
  "no promise": (j) => delete j.promise,
  "no start": (j) => delete j.start,
  "no steps": (j) => delete j.steps,
  "empty steps": (j) => (j.steps = []),
  "steps with no check": (j) => (j.steps = ["Open the app."]),
  "an empty step": (j) => (j.steps[0] = ""),
  "a step read as a field": (j) => (j.steps[0] = { "Tap Next": "then wait" }),
  "a check with no id": (j) => delete j.steps[1].id,
  "a check id that is not dashed words": (j) => (j.steps[1].id = "Link On"),
  "a check id that is a number": (j) => (j.steps[1].id = 2),
  "added that is not true or false": (j) => (j.steps[1].added = "yes"),
  "a value not written as ${name}": (j) => (j.start = "You have ${Phone}."),
  "users as text": (j) => (j.users = "viewer"),
  "empty users": (j) => (j.users = []),
  "you in users": (j) => (j.users = ["you"]),
  "a user listed twice": (j) => (j.users = ["viewer", "viewer"]),
  "a user that is not a role word": (j) => (j.users = ["Team Lead"]),
  "people instead of users": (j) => (j.people = ["viewer"]),
  "notes that are not text": (j) => (j.notes = 3),
  "a setup that is not text": (j) => (j.setup = 3),
  "steps and cases both": (j) => (j.cases = [{ name: "A", id: "a", start: "x", steps: [{ check: "y", id: "y" }] }]),
};

const INVALID_CASES = {
  "cases and a top-level start": (j) => (j.start = "You're signed in."),
  "empty cases": (j) => (j.cases = []),
  "a case with no name": (j) => delete j.cases[0].name,
  "a case with no id": (j) => delete j.cases[0].id,
  "a case with no start": (j) => delete j.cases[0].start,
  "a case with no steps": (j) => delete j.cases[0].steps,
  "a case added that is not true or false": (j) => (j.cases[0].added = "yes"),
};

/** Rules a JSON Schema cannot say. The validator refuses these; the schema accepts them. */
const VALIDATOR_ONLY = {
  "a check id used twice in one list": (j) => (j.steps[3].id = "link-on"),
  "a case id used twice": (j) => (j.cases[1].id = j.cases[0].id),
  "2 cases sharing a check id for different checks": (j) => (j.cases[1].steps[2].id = "code-sent"),
};

test("the schema and the validator accept every example journey", () => {
  for (const [name, text] of Object.entries(VALID)) {
    const journey = plain(text);
    assert.deepEqual(validateJourney(journey), [], `validator: ${name}`);
    assert.ok(matchesSchema(journey), `schema: ${name}: ${JSON.stringify(matchesSchema.errors)}`);
  }
});

test("the schema and the validator refuse the same broken journeys", () => {
  const broken = [...Object.entries(INVALID).map(([n, f]) => [n, JOURNEY, f]), ...Object.entries(INVALID_CASES).map(([n, f]) => [n, CASES, f])];
  for (const [name, text, breakIt] of broken) {
    const journey = plain(text);
    breakIt(journey);
    assert.notDeepEqual(validateJourney(journey), [], `validator accepted: ${name}`);
    assert.ok(!matchesSchema(journey), `schema accepted: ${name}`);
  }
});

test("the rules only the validator checks are the ones a schema cannot say", () => {
  for (const [name, breakIt] of Object.entries(VALIDATOR_ONLY)) {
    const journey = plain(name.includes("case") ? CASES : JOURNEY);
    breakIt(journey);
    assert.notDeepEqual(validateJourney(journey), [], `validator accepted: ${name}`);
    assert.ok(matchesSchema(journey), `schema refused: ${name}. Move it out of VALIDATOR_ONLY.`);
  }
});

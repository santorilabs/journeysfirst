import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { affectedJourneys, affectedLines, pathCovers } from "../src/format/affected.js";
import { journeyPlan, loadJourney, validateJourney } from "../src/format/format.js";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));

const JOURNEYS = [
  "start-from-an-empty-project",
  "let-an-agent-write-a-journey",
  "hand-a-project-to-a-new-agent",
  "run-the-journeys-a-change-covers",
  "see-why-a-run-failed",
  "watch-a-fast-run-line-by-line",
  "let-an-agent-run-a-journey",
  "keep-an-aborted-agent-rerun",
  "run-a-custom-agent-command",
];
const TERMINAL_JOURNEYS = JOURNEYS.slice(-3);

test("a path selects the journeys that list it, and leaves the others", () => {
  assert.equal(pathCovers("skills/**", "skills/journey-write/SKILL.md"), true);
  assert.equal(pathCovers("skills/**", "docs/how-it-fits.md"), false);
  assert.equal(pathCovers("packages/core/src/doctor.js", "packages/core/src/doctor.js"), true);
  const doctor = affectedJourneys(REPO, ["packages/core/src/doctor.js"]);
  assert.deepEqual(doctor.selected, ["journeys/start-from-an-empty-project.journey.yaml"]);
  assert.ok(doctor.skipped.includes("journeys/run-the-journeys-a-change-covers.journey.yaml"));
  const setup = affectedJourneys(REPO, ["packages/core/src/setup.js"]);
  assert.equal(setup.selected.length, 4);
  assert.ok(setup.selected.includes("journeys/run-a-custom-agent-command.journey.yaml"));
  assert.deepEqual(setup.skipped, [
    "journeys/keep-an-aborted-agent-rerun.journey.yaml", "journeys/let-an-agent-run-a-journey.journey.yaml",
    "journeys/run-the-journeys-a-change-covers.journey.yaml", "journeys/see-why-a-run-failed.journey.yaml",
    "journeys/watch-a-fast-run-line-by-line.journey.yaml",
  ]);
  const readme = affectedLines(REPO, ["README.md"]);
  assert.deepEqual(readme.filter((line) => line.startsWith("run ")), ["run journeys/start-from-an-empty-project.journey.yaml"]);
  assert.equal(readme.filter((line) => line.startsWith("skip ")).length, JOURNEYS.length - 1);
  const merge = affectedJourneys(REPO, ["packages/core/src/format/merge-check.js"]);
  assert.deepEqual(merge.selected, ["journeys/keep-an-aborted-agent-rerun.journey.yaml"]);
  const review = affectedJourneys(REPO, ["packages/core/src/review/review.js"]);
  assert.ok(review.selected.includes("journeys/run-a-custom-agent-command.journey.yaml"));
});

test("the self journeys are valid and each one is in the path map", () => {
  for (const name of JOURNEYS) {
    const journey = loadJourney(join(REPO, "journeys", `${name}.journey.yaml`));
    assert.deepEqual(validateJourney(journey), [], name);
    assert.equal(journey.format, "journeysfirst/v1");
    if (TERMINAL_JOURNEYS.includes(name)) assert.deepEqual(journeyPlan(journey).everyone, ["you"]);
    else assert.ok(journey.users?.length, name);
  }
  const lines = affectedLines(REPO, ["packages/core/src/format/affected.js"]);
  assert.deepEqual(
    lines.filter((line) => line.startsWith("run ")),
    ["run journeys/run-the-journeys-a-change-covers.journey.yaml"],
  );
});

test("a journey with no entry is not selected", () => {
  const root = mkdtempSync(join(tmpdir(), "jf-affected-"));
  mkdirSync(join(root, "journeys"));
  writeFileSync(join(root, "journeys/covered-by.yaml"), "open-the-page:\n  - demo/**\n");
  writeFileSync(join(root, "journeys/open-the-page.journey.yaml"), "format: journeysfirst/v1\n");
  writeFileSync(join(root, "journeys/read-the-notes.journey.yaml"), "format: journeysfirst/v1\n");
  const { selected, skipped } = affectedJourneys(root, ["demo/index.html"]);
  assert.deepEqual(selected, ["journeys/open-the-page.journey.yaml"]);
  assert.deepEqual(skipped, ["journeys/read-the-notes.journey.yaml"]);
  const bare = mkdtempSync(join(tmpdir(), "jf-affected-"));
  mkdirSync(join(bare, "journeys"));
  assert.throws(() => affectedJourneys(bare, ["demo/index.html"]), /covered-by.yaml is missing/);
});

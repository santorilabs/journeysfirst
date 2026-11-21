// Shared fixtures for the tests. Not a test file itself.
import { readFileSync } from "node:fs";
import { parseJourney } from "../src/format/format.js";
import { RunRecorder } from "../src/runner/recorder.js";

// A journey like spec/journey-v1.example.yaml.
export const JOURNEY = `format: journeysfirst/v1
title: Share a presentation by link
promise: You can share a presentation by link, and turn the link off again.
users: [viewer]
start: You have a presentation called "Q3 plan". Link sharing is off.
steps:
  - Turn on link sharing and send the link to the viewer.
  - check: Link sharing is still on after a reload.
    id: link-on
  - The viewer opens the link.
  - check: The viewer sees "Q3 plan".
    id: viewer-sees-it
  - Turn off link sharing.
  - The viewer opens the link again.
  - check: The viewer can no longer see "Q3 plan".
    id: viewer-blocked
`;

// The journey in spec/journey-v1.cases.example.yaml.
export const CASES = `format: journeysfirst/v1
title: Turn on two-step sign-in
promise: You can turn on two-step sign-in with your phone number, and it stays on.
cases:
  - name: Enter the number in the form
    id: number-in-card
    start: You're signed in. Two-step sign-in is off.
    steps:
      - In Security, choose "Turn on two-step sign-in".
      - Enter \${phone} in the form.
      - check: One text with a code is sent to \${phone}.
        id: code-sent
  - name: Tap "Not now"
    id: not-now
    start: You're signed in. Two-step sign-in is off.
    steps:
      - In Security, choose "Turn on two-step sign-in".
      - Tap "Not now".
      - check: No text is sent.
        id: nothing-sent
`;

export const DRAFT_0 = `format: journeysfirst/v0
id: share-by-link
title: Share my work by link
people:
  owner: Owns a presentation.
  viewer: Someone else, with no access yet.
start: The owner's presentation exists. Link sharing is off.
steps:
  - id: turn-on
    says: The owner turns on link sharing.
  - id: open
    says: The viewer opens the link.
outcomes:
  - id: link-on
    after: turn-on
    says: Link sharing is on.
  - id: sees-it
    after: open
    says: The viewer sees the presentation.
    needs: [second_person]
`;

export const PNG = Buffer.from("89504e470d0a1a0a", "hex");
export const ON = { source: "api", login: "you", url: "/api/share", got: { linkSharing: true } };
export const VIEWER_SAW = { source: "page", login: "viewer", url: "/view/q3-plan", saw: "the presentation" };

/** A recorder for the share-by-link journey, with a fixed clock and repo. */
export function recorder(options = {}) {
  let ms = Date.parse("2026-11-08T18:02:11Z");
  return RunRecorder.start({
    journey: parseJourney(JOURNEY),
    name: "share-by-link",
    ranBy: { agent: "test" },
    repos: [{ repo: "acme/web", commit: "abc123", branch: "main" }],
    now: () => (ms += 500),
    ...options,
  });
}

/** Record every line of the share-by-link journey as passed. */
export function recordAllPassed(run) {
  run.step(1, { by: "you", screenshots: PNG });
  run.check("link-on", { by: "you", verdict: "passed", proof: "Reloaded and read the saved setting.", evidence: [ON] });
  run.step("The viewer opens the link.", { by: "viewer", screenshots: PNG });
  run.check("viewer-sees-it", { by: "viewer", verdict: "passed", proof: "Opened the link in the viewer's login.", evidence: [VIEWER_SAW] });
  run.step("Turn off link sharing.", { by: "you" });
  run.step("The viewer opens the link again.", { by: "viewer" });
  run.check("viewer-blocked", { by: "viewer", verdict: "passed", proof: "Opened the link again.", evidence: [{ ...VIEWER_SAW, saw: "an access error" }] });
  return run;
}

/** The example run in spec/: a full run of spec/journey-v1.example.yaml. */
export const specRun = () => JSON.parse(readFileSync(new URL("../../../spec/run-results-v1.example.json", import.meta.url), "utf8"));

/** The findings from the spec's example: one finding on step 1, and one question on step 3. */
export const findings = () => specRun().findings;

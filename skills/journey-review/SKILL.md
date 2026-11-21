---
name: journey-review
description: Review a journey file, or a walked run of one, against 16 fixed criteria. Use after writing a journey, after a run passes and before you say the change is done, or when someone asks "is this any good?" or "check the UX".
---

# Review a journey

An existing product: judge it against its Foundation in `journeys/README.md` and its earlier runs (no Foundation: follow `journey-onboard`). A new build: judge it against the request's own words, with "New build" triage below.

The first thing you do is read what good means for this product. Then you judge each step of the journey and its run against that, as its user. You write findings with evidence, show them to the person, and stop.

A passed run proves the checks. It does not say the walk was good for this product's users. Read the "What good means" lines, the UX principles and "Decided". A line marked "(guess)" waits for a person. No finding rests on one.

A repo with no UI (a backend, an API, a worker) skips `foundation-values`, `foundation-loading` and `foundation-phone`, and says so in one line of the report. That is not a finding.

## Run it

1. Read the Foundation, the journey file, `run.json` and each step's screenshot.
2. Triage. Say which you picked.
3. Get the measured facts.
4. Run the four passes in order. Finish one pass across every step before you start the next.
5. Drop what is settled. Each line under "Decided" starts with a criterion id. Do not raise that criterion about the same thing again.
6. Write the findings into the run.
7. **Show them.** Give the findings in pass order, then the questions, and change nothing until the person answers. With nobody to answer, go straight to `journey-fix`.

## Triage

- **File only.** No run and no saved script (you came from `journey-write`). Do pass 1, list what you found in your reply, and stop.
- **New build.** Nothing was built before this task. Read the request itself, not the README you wrote from it. Do pass 1. Once per build, not per journey, list each thing the request asks for, in its words, beside the screenshot that shows it done the way a user would expect. A part that is missing, or done with less, is a `file-request` finding, even when every check passed. Judge every screen against the bar in `journey-build`. Run `measured` for its `fact` lines. Skip the comparisons, the slow replay and the measured line.
- **Full.** The first review of this journey, or the journey changed. Every pass on every step. With a saved script and no run, replay it first (`journey-run`).
- **Light.** `measured` compared with an earlier reviewed run, and `journey.version` is the same in both. Read only the screens it lists under "Screens that differ". For other steps, carry over the earlier run's findings with the same ids.

## Measured facts

A run from a saved Playwright script has a `measure-<step>.txt` per step: that user's screen at the run's width and at 375 px, and each click with the ms until the page changed.

```bash
npx journeysfirst measured <run folder>
```

```text
fact  intuitive-feedback  step 1  Nothing on the screen changes after "Copy link".  (measure-1.txt)
ask   foundation-values  step 3  Not in the measured line: radius 4 px on button "Download".  (measure-3.txt)
```

- A `fact` line is a finding. Write it as printed. An `ask` line is a question.
- **No measured line yet.** Write the line `measured` prints under Design system in `journeys/README.md`, and tell the person. What the product already uses is not a finding. A new build skips this.
- **No measure files** (a run driven by hand): every criterion that reads `measured` is "not measured". Never guess a pixel value from a screenshot.

`foundation-loading` needs a slow replay, which holds each data request for 2 seconds and prints each click's time. With no saved script or a new build, it is "not measured".

```bash
JOURNEYS_DELAY_MS=2000 npx playwright test --grep "<journey title>"
```

## The four passes

"`measured` is quiet" means it printed no line for that criterion.

| Pass | Criterion | Passes when |
|---|---|---|
| 1. The journey file | `file-outcome` | The last check of each goal names a user and a state that holds after the action. |
| | `file-one-promise` | The file has one goal, or a goal and its undo, and every check serves it. |
| | `file-good` | Each "What good means" line and each "Would notice first" this promise can break has a check, or `notes` says why not. No "What good means" lines: "not measured". |
| | `file-request` | Each thing the request or `promise` names is done in a step the way a user would do it. No step does less than the words. |
| 2. Intuitive | `intuitive-words` | No control the journey uses names a result other than the one the next check proved. Each thing has one name on every walked screen. If Brand points to a file for the name, the name is written that way. |
| | `intuitive-feedback` | The page changes after every click. `measured` is quiet. |
| | `intuitive-refusal` | Each refusal, empty or error screen the journey reaches says what happened and names a next step. |
| 3. Simple | `simple-no-longer` | No more clicks or fields than the earlier reviewed run, or than a Product principle allows. `measured` is quiet. |
| | `simple-confirm` | Each "are you sure" comes before a delete, a send, a payment or another action with no undo. |
| | `simple-one-action` | No dialog or form has two buttons that stand out equally. `measured` is quiet. |
| | `simple-fast` | Every click shows something within 1 second. `measured` is quiet. |
| 4. Right foundation | `foundation-stated` | Each Product or UX principle line that names something on a walked screen agrees with the screen. If you cannot read or measure what it names, it is a question. |
| | `foundation-values` | No spacing, type size, font or radius that is new since the earlier run or outside the measured line. `measured` is quiet. |
| | `foundation-loading` | The slow replay prints no time of 1000 ms or more. |
| | `foundation-phone` | At 375 px: no sideways scroll, nothing cut off, every control used is at least 24 px. `measured` is quiet. |
| | `foundation-not-generic` | A top designer would ship each screen as it is. |

```text
file-good          Fail: "The viewer never has to sign in." (Ana) has no check that says "without signing in".
intuitive-words    Fail: the button says "Share" and the dialog it opens is titled "Publish".
simple-confirm     Fail: turning the link off asks "Are you sure?". It can be turned on again.
foundation-stated  Fail: "Done" has a 4 px corner. "Corners are 10 px on buttons." (`docs/design.md`)
```

- Whether a first-time user would find a control is a question, never a finding. You read the whole page. A person scans it.
- Put the "Counts" line in your report every time.
- On an existing product, judge its values against the product itself, never a general scale. Its own 10 px spacing is not wrong.
- When the Design system names a part a fix should use, like its button, say which in the finding.

## Findings

Save `{"findings": [...]}` as `findings.json` in the run folder:

```json
{
  "findings": [
    {
      "id": "intuitive-refusal-6",
      "criterion": "intuitive-refusal",
      "step": 6,
      "says": "The refused viewer sees \"You don't have access\" and no next step.",
      "evidence": [{ "source": "page", "login": "viewer", "url": "https://preview-12.example.test/view/q3-plan", "saw": "one heading, \"You don't have access\", and nothing else" }]
    }
  ]
}
```

- `id`: the criterion and the step, never a check's id.
- `step`: the journey line, counting actions and checks from 1. Leave it out for the whole journey.
- `says`: one plain sentence a person can paste into a PR. Quote a broken Foundation line.
- `evidence`: at least one item. For a screen: `source: "page"`, the `login` whose screen it was, the `url`, and `measured` with its `file`, or `saw` with the words quoted. For the journey file: `source: "log"`, `login: "you"`, and the command in `query`, like `cat journeys/share-by-link.journey.yaml`.
- `ask`: only on a question. A question is what a count, a time, the words or a measurement cannot settle. `ask` holds the one thing to decide, `says` what you saw. At most three. A `fact` from `measured` is never a question. "The page feels cluttered" is neither.

Then, before the run is published (a published run is sealed):

```bash
npx journeysfirst add-findings <run folder> <run folder>/findings.json
npx journeysfirst validate-run <run folder>
```

`validate-run` prints `Review: 2 findings, 1 question.` or `Review: nothing found.` The run's result does not change.

When nothing fails, write an empty list, say "The review found nothing." and stop. Add no suggestions.

## When the person decides

Record their call in the run and under "Decided", as `journey-fix` says. Fixing a finding is `journey-fix` too.

## Do not

- Change any file except `findings.json`, the run's `findings` and `reviews`, the measured line when there was none, and "Decided". A finding never turns a pass into a fail.
- Write a finding from how a screen feels. With no measured fact, quoted words or broken rule, it is a question or nothing.
- Soften a fact `measured` printed, or add one it did not print. Leave out a `fact` or `ask` line only when "Decided" settles it.
- Give a score, or a pass for a criterion you could not measure.

## Report

These lines first. On a new build, the request list from triage comes next. Then each finding (the step, the sentence, the evidence), then each question.

```text
Review: full. 2 findings, 1 question.
Counts: step 1: 2 clicks, 1 field; step 5: 0 clicks, 1 field.
Not measured: foundation-loading (no saved script).
Not read again: steps 3 to 7, the same screens as in run 2026-11-17-0912-41c07be2.
```

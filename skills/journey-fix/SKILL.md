---
name: journey-fix
description: Fix a journey run that failed, a saved Playwright script that broke, or a finding from a review. Use when a replay errors, a check fails, or a reviewer says a check was wrong.
---

# Fix a journey run

First decide what is wrong: the code or the journey. Ask what the user would expect at that step. If the product falls short of that, fix the code. If the journey asks for something the user would not expect, fix the journey and say why. Either way, the user's experience is the line you hold. Never lower it to make a run pass.

An existing product: read Foundation in `journeys/README.md` first (none yet: follow `journey-onboard`). A new build: a check that fails because a part is not built yet is cause `product`. Build it; never shrink the journey.

The first thing you do is find out what went wrong. What does the run say? At which step was the state first wrong? Is the cause the product, the script or the environment? Then you fix that one thing and run the whole journey again.

A fix moves the product toward its "What good means" lines, never away. It uses the patterns the product already has: the components, values, words and flows that Brand and Design system point to.

## A failed run

1. **Read the run.** `failure.md` first, if the run has one: what the app reported to each user at the first failed line. Then `not_verified`, then each failed step's `reason`, `proof`, evidence and screenshots. Open the user's video at that step's time.
2. **Open the trace,** if the run kept one: `npx playwright show-trace <run folder>/trace.zip`. It can hold tokens and personal data, so never paste it into a PR or a chat.
3. **Find the earliest step where the state was already wrong.** Walk back from the failure. Name that step, with the evidence that shows it.
4. **Drive that step live** on a safe environment (see `journey-run`), as the user the line starts with, in their own login.
5. **Decide the cause.** Every failed or blocked step has a `cause`:

   | Cause | What it looks like | Fix |
   |---|---|---|
   | `product` | The user can no longer do what the journey says | Fix the product, not the test |
   | `test` | The promise holds, but the script or journey is wrong (a locator, a wait, a query) | Fix the script. Leave the journey alone |
   | `environment` | Setup broke: no account, the app didn't start, a login expired | Mark it `blocked`. Fix the setup |

   A promise the team changed on purpose is a journey edit. Propose the new check with a new id, say what changed and why, and wait for a person.
6. **Fix where the cause is.** The promise is as strong after the fix as before it.
7. **Run the whole journey again,** not just the broken line. That rerun is what you report.

**Product bug.** `link-on` fails: after a reload, link sharing is off. Live, the same happens. Walking back, the save at line 1 returns 500.
- Cause `product`. Reason: "The save at line 1 returns 500, so the setting is lost on reload."
- Bad fix: add a retry, or prove the check from the checkbox instead of the saved setting.

## A finding from a review

A finding comes from `journey-review`. It is not a failure: it has no `cause`, and it never changes a verdict. Every finding gets an answer: you fix it in the product, or a person sees it. Never delete one.

Read "Decided" first. A call a person already made is not reopened.

Fix what your change caused (on a new build, that is every finding), then run the journey and `journey-review` again. What was there before your change goes in your report, and you fix it only if the person asks. A criterion that does not fit this product, and an `ask`, are the person's call: say why, with evidence.

When a person makes a call, record it in two places, so the next review does not raise it again:

- In the run, before it is published: `npx journeysfirst add-review <run folder> --on <finding id> --by <person> --says "<their words>"`.
- One line under "Decided" in `journeys/README.md`, starting with the criterion id, with the person's name and the date.

## Never

- Never weaken a check to make a run pass: dropping it, "one" to "at least one", or proving it from a different user's login.
- Never mark a product bug as `test` because the fix is easier.
- Never change a check's id to dodge its history.
- Never edit a run's verdict after the fact. A person's call goes in `reviews`, written by `add-review`.

## Report

- The cause, the earliest wrong step and the evidence.
- What you changed, and the rerun's `result` and `not_verified`.
- A promise change: the proposed journey diff, waiting for a person.
- Each finding: fixed, with the new review line, or waiting for a person. Each `add-review` call and each "Decided" line you added.

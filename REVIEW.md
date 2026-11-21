# Code review

Code review agents read this file. Report the most severe risks in this PR. Most PRs should get no comments.

## Report only severe risks

Post a finding only when it is likely in normal use and would cause one of:

- A break in the v1 formats: a journey or run file that was valid stops validating, a field changes meaning, or `run.json` is written in a shape `spec/journey-format-v1.md` or `spec/run-results-v1.md` doesn't describe
- A check reported `passed` without its evidence, or a failed or blocked run read as `passed`: the runner, recorder, validator or Playwright reporter calling a run better than it was
- A crash or a core flow that stops working: `journeysfirst validate`, `validate-run`, `review`, a Playwright journey run, or publishing a run
- A leaked secret: a `${name}` value marked secret written to a run file, screenshot or log, or a publish token printed or committed
- The core importing something outside `scripts/check-names.mjs`'s allowlist

Each finding must name the concrete trigger: the normal input or sequence that causes it. If you cannot name one, drop the finding.

Post at most 3 findings, most severe first. One short paragraph each. If nothing clears this bar, post nothing.

## UX and consistency

In changes to the review UI or the skills, also report:

- A layout that doesn't work at 375px: content cut off, overflowing, or out of reach.
- Skill or doc text an agent reads that contradicts the v1 spec docs.

These don't count toward the 3 findings.

## Tier

Before the verdict, write one line for the commit you reviewed:

- `Tier: low|medium|high, <why>`. The tier is how easily the change can be shown to work, and how safely it can be undone:
  - **low:** nothing a person or agent sees changes (docs, tests that add coverage, dev tooling). CI is enough.
  - **medium:** `npm test` (including the example run end to end) or screenshots can show it works, and a revert undoes it. Most code changes, including version bumps and removing unused code.
  - **high:** the checks can't show it works (whether an agent can follow a skill or doc, whether the review UI reads well), or a revert can't undo what it did (a format change other repos already wrote files in, a secret leaked). Any change to the v1 formats or to how a verdict is decided is high, even when tests cover it.
  These are guidelines. Judge the whole PR (its description and full diff against main), even when the findings cover only what changed since your last review. When unsure between two tiers, pick the higher one.

Always end with one line for the commit you reviewed: `Verdict: pass` when nothing clears this bar, or `Verdict: block` with the findings above it. A review with no verdict reads as not reviewed. If the author says in the title, description or comments that the PR is a demo, WIP or not meant to merge yet, end with `Verdict: block` and quote where they said it, until they say it's ready.

On a later commit, review only what changed since your last review. Don't raise a finding again that the author fixed or answered.

## Do not report

- Edge cases that need unusual timing, races, clock skew, retries or malformed client input
- Hardening suggestions, defensive checks, or "could break later" concerns
- Code style, naming, imports, file size, or dead code
- Performance that is not an outage
- PR description, missing tests, or verification evidence
- Anything already working

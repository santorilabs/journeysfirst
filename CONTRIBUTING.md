# Contributing

This page says how to set up the repo, run the checks, and open a pull request.

## Set up

You need Node 20 or newer. CI uses Node 22.

```bash
npm install
npx playwright install --only-shell chromium
```

The code is plain JavaScript (ES modules) with JSDoc types. [docs/how-it-fits.md](docs/how-it-fits.md) explains which file does what.

## Run the checks

Run all of these before you open a pull request. CI runs the same ones.

```bash
npm test                    # unit tests, plus the example run end to end
npm run check:names         # the core imports only Node built-ins, yaml and @playwright/test
npm run types -w packages/core && git diff --exit-code packages/core/types
```

- `npm run types -w packages/core` rebuilds `packages/core/types/` from the JSDoc. Commit the result. A test fails when the committed types are out of date.
- CI also fails when a file in `packages/core/src` or `packages/core/bin` is over 600 lines.
- To run the example on its own: `cd examples/share-by-link && npm test`.

## Rules for changes

- A change to the formats must keep every existing v1 journey and run valid, unless the pull request says why not. Change the spec docs, the validator and the tests together.
- A rule is checked in one place: `format.js` for journeys, `runfile.js` and `run-check.js` for runs. Do not check it a second time somewhere else.
- A behavior change comes with a test for the new behavior. Extend the existing test file in `packages/core/test/`.
- Fix the cause of a bug, not where it shows up.
- Never skip or delete a failing test to make CI pass.
- No private names, URLs or keys in code, docs or examples.

## Pull requests

The description must not be empty. CI checks this. The template starts with two lines:

- `Tier:` low, medium or high: how easily the checks show the change works, and whether a revert undoes it. [REVIEW.md](REVIEW.md) says what each tier means.
- `Journeys:` the journeys you ran to check the change, or `none` and why.

Then use these three headings:

- `## Problem`: what is wrong or missing, and who it affects. For a fix, say what caused it.
- `## How`: what you changed, and what you chose not to do.
- `## Verification`: the checks you ran and their results. Say what you could not check, and why.

A change to the review page or the dev server needs screenshots at desktop width and at 375px. If nothing a person sees changes, say so.

Keep the description short. Write in plain words.

## Agents

Agents working on this repo read [AGENTS.md](AGENTS.md). It holds the full rules, including the writing rules for docs and errors.

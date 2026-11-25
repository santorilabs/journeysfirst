# Rules for agents working on Journeys First

This repo holds the journey and run formats, the rules a run must pass, the runner and recorder, the review page, the publish client and protocol, and the skills. MIT.

Read first: [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md), [spec/journey-format-v1.md](spec/journey-format-v1.md), [spec/run-results-v1.md](spec/run-results-v1.md), [docs/how-it-fits.md](docs/how-it-fits.md).

## Checks before a pull request

```bash
npm install
npm test                    # unit tests, plus the example run end to end
npm run check:names
npm run types -w packages/core && git diff --exit-code packages/core/types
```

Run them on the final change and read the results. Fix failures your change caused. Say in the pull request which checks you could not run, and why.

## Where things live

- `src/format/format.js` and `src/format/runfile.js` own what a journey and a run are. The runner, recorder, review page, dev server and publish client all call them. Never check a rule a second time somewhere else.
  - Reading and checking files: `src/format/` (`format.js`, `runfile.js`, `run-check.js`).
  - Writing runs: `src/runner/` (`recorder.js`, `playwright.js`).
  - Showing runs: `src/review/review.js`, and `src/shared/display.js` (browser-safe).
  - Sending runs: `src/publish/` (`publish.js`, `publish-handler.js`).
- Skills are in `skills/` at the repo root. The format specs are in `spec/`. The docs are in `docs/`. `prepack` copies `skills/`, `spec/` and `docs/` into the package, so `npx journeysfirst init` can copy the skills from `node_modules`, and an agent can read `node_modules/journeysfirst/spec` and `node_modules/journeysfirst/docs`.
- Which folder may import which: the table in [docs/how-it-fits.md](docs/how-it-fits.md). `test/layers.test.js` enforces it.

## Rules for changes

- A change to the formats keeps every existing v1 journey and run valid, unless the pull request says why not. Change the spec, the validator and the tests together.
- A behavior change comes with a test for the new behavior. Extend the existing file in `packages/core/test/`.
- Never skip or delete a failing test to make CI pass. If a test fails, say whether the change meant to change that behavior or broke it.
- Fix the cause of a bug, not where it shows up. Before adding an `if`, a default or a `try`/`catch` to hide a failure, find what produced the bad state and fix it there.
- Keep it simple. If two pieces of code do the same job, delete one.
- The core imports only Node built-ins, `yaml` and `@playwright/test`. `npm run check:names` checks this.

## Code

- Plain JavaScript (ES modules) with JSDoc types. `checkJs` is on, so `npm run types -w packages/core` must pass and the committed `types/` must match it.
- JSDoc types on every exported function.
- Imports at the top of the file.
- `camelCase` functions, `PascalCase` classes and types.
- Files under 600 lines. CI checks this.
- Functions over classes. Classes only for stateful services (`RunRecorder`) and APIs that need one (the Playwright reporter).
- Comments say why, not what the code already says.

## Writing

Docs, skills, errors and CLI output use plain, simple words.

- Start with what a thing is or does.
- One fact per sentence. No clever phrasing.
- No em dashes. Use a period, colon, comma or parentheses.
- An error says what to do next.

## Pull requests

Use the three headings in [CONTRIBUTING.md](CONTRIBUTING.md): Problem, How, Verification. A change to the review page or the dev server needs screenshots at desktop width and at 375px.

# Changelog

Each released version is on npm (`journeysfirst`). Newest first.

## 0.0.5

- The journey format has a JSON Schema, `spec/journey-v1.schema.json`, and 2 example files. Put `# yaml-language-server: $schema=https://raw.githubusercontent.com/santorilabs/journeysfirst/main/spec/journey-v1.schema.json` at the top of a journey to get checks and hover help in your editor. A test keeps the schema and `validate` in agreement.
- `spec/journey-format-v1.md` is now short: links to the schema and examples, and the rules for writing steps.
- `journey-write` lists the cases to think through, which used to be in the spec.
- Run files have a JSON Schema too, `spec/run-results-v1.schema.json`, and a full example run, `spec/run-results-v1.example.json`. `spec/run-results-v1.md` is now short. A test keeps the schema and `validate-run` in agreement.

## 0.0.4

- `journey-build` runs `npx journeysfirst init` after installing, so the reporter and the Journeys section in `AGENTS.md` are set up before the first run.
- `journey-run` and `journey-fix` agree on what to fix with nobody to ask: what your change caused. The rest goes in your report.
- `journey-onboard` writes the first journeys from what it reads, and does not explore the product.
- The skills link to the specs on GitHub, since the specs are not installed with them.
- The specs match the code: a case has an `id`, ids are written once by whoever writes the journey, videos are `.webm`, and a run id ends in 8 hex characters.

## 0.0.3

- `npx journeysfirst --help` lists everything `init` does. It also writes a Journeys section in `AGENTS.md` and adds the upgrade workflow.
- `journey-onboard` offers its questions about what good means as help, not as a fixed list. It adds one: when one user does something, what changes for the others?
- The repo has two new examples on real open source apps, Immich and Docmost, and a results page, `docs/results.md`. The README is rewritten. These are not in the npm package.

## 0.0.2

- A new skill, `journey-build`, builds a new product journeys first, from a request. It writes who the product is for and what good means, then the journeys, before any code; builds to them; and uses the product as each user before saying done. `journey-onboard` is now only for a product that exists. The Journeys section in `AGENTS.md` points a repo with only a request to `journey-build`.
- A new skill, `journey-review`, reviews a journey file or a walked run against 16 fixed criteria in four passes: the journey file, intuitive, simple, right foundation. Each criterion has a line that says when it passes, from a count, a time, the words on screen or a measurement. It writes findings with evidence and changes nothing else. `journey-write` and `journey-run` end by following it, and `journey-fix` says what to do with a finding.
- `journey-review` judges a new build against the request (`file-request`), not only against itself.
- Every skill starts by telling an existing product from a new build. On an existing product it reads the Foundation in `journeys/README.md`: Product principles, UX principles, Brand and Design system. `journey-onboard` writes it. It points to the files where the product already states a part, quotes a rule of one or two lines, measures the wording no file states, and asks the person who the users are and what good means to them. A principle nobody stated is never made up.
- The Playwright plugin measures each user's screen after every line and saves `measure-<line>.txt` in the run folder: the spacing, type sizes, fonts and corner radii in use, each control's box at the run's width and at 375 px, and each click with the ms until the page first changed. A line's `took` does not include it. `test.journey(file, { measure: "wide" }, body)` skips the 375 px half, and `measure: false` turns it off.
- `npx journeysfirst measured <run folder>` prints what the measure files show, one line for each fact a review criterion names: a click that changed nothing, a click that showed nothing for a second, two buttons that stand out in one dialog or form, a step that takes more clicks or fields than in the earlier reviewed run, a value the product did not use before, and a page, dialog or control that does not fit 375 px.
- `JOURNEYS_DELAY_MS=2000 npx playwright test` is a slow replay: each data request is held that long, each click's time to the first change is printed, and no run is written. A review uses it to see whether a screen shows that it is loading.
- `npx journeysfirst add-review <run folder> --on <id> --by <person> --says "<words>"` records a person's call on a check or a finding in the run's `reviews`.
- `upgrade` says to add the Foundation section when `journeys/README.md` has none, before the journeys run again.
- The example app shows "Opening…" while Share waits for the saved setting, its checkbox row is 32 px tall, and its dialog fits a 375 px screen. Its own review found all three.
- The Journeys section in `AGENTS.md` says to review each run, and that a change is done when the run passed and the review found nothing, or a person has seen the findings.
- A run can carry `findings`, a list beside the verdicts, for what a review against fixed criteria found. A finding never changes a verdict or the result. `npx journeysfirst add-findings <run folder> <file>` writes them, `validate-run` prints how many, and the review page shows them under the verdict. Runs without the field stay valid.
- A review's `on` can name a finding as well as a check.
- `init` and `upgrade` on a first install (no journeys, no scripts in `e2e/`) no longer say to re-check saved scripts and re-run the journeys. They print how to install `@playwright/test` when it is missing, and the browser: `npx playwright install --only-shell chromium`.
- The new `playwright.config.js` starts the app with the `dev` script, else the `start` script. With neither, its command fails and says what to set. Before, it always ran `npm run dev`, so the first run failed with `Missing script: "dev"` in an app without one.
- The review page shows the journey's title in the run list and the page title when `journeys/<name>.journey.yaml` is there, not the file name.
- `validate` no longer warns on a line about a thing, like `The note "Buy milk" is in the list.` or `The list is empty.` It still warns on `The admin turns off link sharing.` when admin is not in `users`.
- The install command for the skills is `npx skills add santorilabs/journeysfirst --skill '*' --agent claude-code codex -y`. It asks no questions and installs for the agents named.
- The upgrade workflow installs with the repo's own package manager, from its lockfile: pnpm, yarn, bun, else npm. Before, it always ran `npm install`, so in a pnpm or yarn repo its pull request added a second lockfile.

## 0.0.1

The first public release.

- Journey format v1 and run results v1, in `spec/`.
- Four skills: `journey-onboard`, `journey-write`, `journey-run` and `journey-fix`. Install with `npx skills add santorilabs/journeysfirst --skill '*'`.
- The CLI: `init`, `upgrade`, `validate`, `validate-run`, `merge-check`, `review`, `publish` and `dev-server`.
- A Playwright fixture and reporter, a recorder for runs written without Playwright, a local review page and a publish client.

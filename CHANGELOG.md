# Changelog

Each released version is on npm (`journeysfirst`). Newest first.

## Unreleased

Upgrade steps: none for most projects. If a test sets `pause` without `video: "paced"`, remove `pause`: the run would still wait, and the review page holds on each line as well. If you share a run's video as a raw file, pass `video: "paced"` (or set `journeyVideo: "paced"`) to get the captions and pauses in the video as before.

- A replay no longer waits so its video can be watched. It still records a video for every user. The review page shows the line in progress under the video and holds on each line: half a second after an action, 2.5 seconds after a check. A video from an earlier version plays as before.
- `video: "paced"` on `test.journey`, or `journeyVideo: "paced"` in the config's `use`, records the video as before: the run waits after each line, and the video shows the caption bar and click marks. `captions` and a step's `caption` apply to a paced video. `pause` defaults to 500 for a paced video and 0 for any other run.
- A step's `at` and `took` are written to the millisecond.

## 0.0.7

Upgrade steps: if you import `journeysfirst/runfile` or `journeysfirst/run-folder`, change the import (see the last line). Nothing else needs a change. Every v1 journey and run stays valid.

Run a journey with an agent:

- `journeysfirst run <journey.yaml>` runs a journey with an agent CLI you are signed in to, in a scratch copy of the project, and saves a run. It picks a supported, signed-in agent. `--agent codex` names one, and `--agent "<command>"` runs any agent command. A run from a custom command is marked `sandbox: unverified`.
- The Codex adapter reuses your Codex login. Before it copies the login, it proves that the agent's commands cannot read your home folder or the login file. `--container <image>` runs it in Docker.
- A journey with `users: [agent]` records the agent as the user who did each line. The launcher refuses a journey with a line for a user it does not play.
- The run keeps the agent's session log, its model and CLI version, and its last message as `handoff.txt`. After a run, the launcher names each check that was not checked.
- `npx journeysfirst run` with Codex works on macOS with the default host read protections. Before, Node could not start inside the sandbox, and the run stopped with "the sandbox did not return a result". The sandbox can now read what Node needs to start: for a Homebrew Node, Homebrew's `opt` and `Cellar` folders and its OpenSSL config and certificates, and for any other Node, `/System/Library/OpenSSL`. Your home folder and your login stay closed.
- When Node cannot start inside the sandbox, the error says so.

Record a terminal or an MCP server:

- `journeysfirst capture -- <command>` saves a command's output, bounded and redacted. `journeysfirst mcp-proxy -- <server>` relays an MCP server's stdio and saves each request name and reply text. Request arguments are not saved.
- `journeysfirst run` starts the stdio servers in the project's `.mcp.json` through the proxy. `--mcp <file.json>` uses only the servers in that file.
- `mcp-proxy` saves times with each MCP exchange. A request row has `at`, the ms since the proxy started. A reply row has `ms`, how long its request waited, and `error: true` when the server answered with an error. Transcripts saved before this have none of these and still attach to a run.
- `journeysfirst/recorder` exports `recording`, which writes steps and checks from captures. A passed check must cite an output or reply line from that user's own capture.

The run format:

- A run can have `attempt: {status: "complete" | "aborted", reason}`. An aborted attempt cannot pass, and it keeps the evidence it recorded. `merge-check` stops the merge when the newest attempt was aborted. It does not fall back to an older pass.

New commands:

- `journeysfirst doctor` checks Node, Playwright, Chromium, the Playwright config, whether `baseURL` answers, and each journey file. A failed check says what to run next.
- `journeysfirst report <run folder>` writes `report.html` for one run. `journeysfirst summary <run folder>` prints markdown for a pull request.
- `journeysfirst affected <path...>` prints which journeys to run again after a change, from `journeys/covered-by.yaml`.
- `journeysfirst init --terminal` sets up terminal and MCP journeys with no browser setup. `init` creates `journeys/`.

The review page:

- `journeysfirst review <runs> --out <folder>` exports the review as a static site, which works from any static host or from disk. Transcripts are left out unless you pass `--include-transcripts`.
- A run page starts with the check counts. A failed run shows what the app reported around the failed line: each response with status 400 or more, and each console and page error.
- A run page shows each attached transcript, collapsed, at its step.

Other changes:

- A declared secret is also hidden when it is used as a key in a recorder error.
- `journey-onboard` also lists the ways a user says no or backs out, like cancel, turn off, decline and delete, when it lists the journeys that matter most.
- The skills link to the file where a fact lives, and copy nothing into `journeys/README.md`. `measured` reads no list from the README.
- The Node requirement now matches the ZIP support the package uses: Node 20.15 or newer on the 20 line, or Node 22.2 or newer.
- The package includes the journey and run specs, schemas, and usage docs. The published 0.0.6 package did not include `spec/` or `docs/`. Releases check that these files are in the exact tarball sent to npm.
- Removed two internal import paths. Import format helpers from `journeysfirst` instead of `journeysfirst/runfile`. To send or check a run folder, use `journeysfirst/publish` or `journeysfirst validate-run` instead of `journeysfirst/run-folder`. The v1 data formats are unchanged.

## 0.0.6

- `journeyVideo: false` in the Playwright config's `use` turns video off for every test, so a run that only needs pass or fail records no video and does not pause. A test's own `video` option wins.

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

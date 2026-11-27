# How the code fits together

This page is for a person who wants to read or change the code in `packages/core`. It says which file does what, which files may import which, and what happens to one run from the first step to a sealed run on a service. The last section says which entry points you can build on.

## Four layers

The source is in `packages/core/src`, one folder per layer. There are no import loops.

```
packages/core/
  bin/journeysfirst.js     the CLI
  src/
    index.js               the main entry: re-exports the format layer
    setup.js               init and upgrade, for the CLI
    format/                read and check journeys and runs
      draft0/              draft 0 journeys, still read so old files keep working
    runner/                make a run
    publish/               send a run
    review/                show a run
    shared/                small files the layers share: display.js, local-host.js, version.js
  types/                   the same folders, as .d.ts files built from the JSDoc
```

```
 bin/journeysfirst.js (the CLI), src/setup.js
        │
        │ the CLI imports format, publish, review, shared and setup.js
        ▼
 runner/               publish/                      review/
 playwright.js         publish.js                    review.js
 reporter.js           dev-server.js                 run-answer.js
 recorder.js           publish-handler.js ─────────▶ run-answer.js
 captions.js                                         player.js
 measure.js                                          run-player.js
                                                     measured.js
                                                     compare.js
                                                     compare-page.js
                                                     tool-calls.js
                                                     video-lines.js
        │                       │                          │
        └───────────────────────┼──────────────────────────┘
                                ▼
 format/: format.js, validate-journey.js, stable-json.js,
          runfile.js, run-check.js, run-folder.js, merge-check.js,
          draft0/format-v0.js
                                │
                                ▼
 shared/: display.js, local-host.js, version.js (they import no other source file)
```

### What each folder may import

A file may always import a file in its own folder. Past that, it may import only from the folders in its row. Only `import` and `export` statements count. A type named in a doc comment, like `import("../format/runfile.js").Run`, does not. `packages/core/test/layers.test.js` holds the same table and fails when a file breaks it, when a folder is missing from it, or when there is an import loop. Change both together.

| Folder | May import |
|---|---|
| `src/shared` | nothing |
| `src/format` | `src/format/draft0`, `src/shared` |
| `src/format/draft0` | `src/format` |
| `src/runner` | `src/format`, `src/shared` |
| `src/runner/agents` | `src/runner` |
| `src/review` | `src/format`, `src/shared` |
| `src/publish` | `src/format`, `src/review`, `src/shared` |
| `src` | `src/format`, `src/shared` |
| `bin` | `src`, `src/format`, `src/publish`, `src/review`, `src/shared`, `src/runner`, `src/runner/agents` |

Any folder may also import Node built-ins. The only packages the source may import are `yaml` and `@playwright/test`. `npm run check:names` checks that.

### Format: read and check the files

What it does: reads a journey file, checks it, and turns it into a numbered list of lines. Checks a run file, settles it, and works out its result. Reads and writes a run folder on disk. Every other layer calls these files. A rule is checked here and nowhere else.

Files, in `src/format/`:

- `format.js`: the journey. `validate-journey.js` holds the v1 journey rules.
- `runfile.js`: the run file. Its rules, `settle`, the result, and the digest.
- `run-check.js`: `checkRun`, the one way every reader takes in a run file.
- `run-folder.js`: a run folder on disk. `addFindings` writes a review's findings into it, and `addReview` a person's call. Neither changes anything else in `run.json`.
- `merge-check.js`: whether a change may merge, from the runs of every journey in the repo. Each journey needs a valid run where every check passed. A check may stay blocked only if it was blocked in main's latest run too.
- `affected.js`: which journeys to run again after a change. It reads `journeys/covered-by.yaml`, a list of paths each journey covers. `journeysfirst affected <path...>` prints `run` or `skip` for each journey. A journey with no entry is not selected. The paths are not part of the journey file, so the sentences stay plain.
- `stable-json.js`: JSON with sorted keys, for the journey version and the digest.
- `draft0/format-v0.js`: reads draft 0 journeys (`journeysfirst/v0`). Only `format.js` imports it.

May import: Node built-ins, `yaml`, and `src/shared`. Nothing from the other layers.

Read first: `journeyPlan` in `format.js` (a journey as numbered lines), then `checkRun` in `run-check.js` and `settle` in `runfile.js` (a claimed pass with no evidence from the right login becomes `not_checked`).

Draft 0 lives in `draft0/` so it can be removed in one go. Outside that folder, these lines are only for draft 0: the `FORMAT_V0` branches in `format.js`, the draft 0 run message in `runfile.js`, `fromLegacy` in `src/review/review.js`, and the draft 0 note in the CLI's `validate`.

### Runner: make a run

What it does: records each line of a journey as it is done, then writes the run folder.

Files, in `src/runner/`:

- `recorder.js`: `RunRecorder`. Any script or agent can use it, with or without Playwright.
- `capture.js`: selected terminal output, MCP request names, and reply text. Each MCP request has when it was seen, and each reply has how long it waited and whether it was an error. The wrapper passes the child's stdio through without changing it.
- `recording.js`: attaches a capture and resolves check evidence from its saved lines, for one seat at a time.
- `agent.js`: prepares the scratch project, gives an agent the journey, and saves evidence and the handoff. It also runs custom agent commands.
- `agents/`: known adapters implement `detect`, `authProbe`, `sandboxArgs`, `mcpConfig`, and `start`. The registry picks the first installed, signed-in adapter.
- `playwright.js`: `test.journey` and the `journey` fixture (`page`, `step`, `check`, `value`). It uses `RunRecorder`.
- `captions.js`: the caption bar each user's paced video shows for the line in progress, and screenshots taken without it. Only `playwright.js` uses it.
- `measure.js`: what the runner reads from a user's screen after each line, for a review: the values in use, each control's box, and each click with the ms until the page first changed. It also holds the slow replay (`JOURNEYS_DELAY_MS`). Only `playwright.js` uses it.
- `mask.js`: covers password fields and secret values in a screenshot, and redacts them in a trace zip and in the run file. `playwright.js`, `recorder.js` and `reporter.js` use it.
- `reporter.js`: the Playwright reporter that writes each run to a folder.

May import: the format layer, `src/shared`, and `@playwright/test` (only `playwright.js`). `reporter.js` imports the attachment names from `playwright.js`.

Read first: `RunRecorder.result` in `recorder.js`, then `declareJourney` in `playwright.js` (it is `test.journey`).

### Publish: send a run

What it does: sends a run folder to a service, and answers that protocol on the service side.

Files, in `src/publish/`:

- `publish.js`: the client. `publishRun` opens the run, uploads the missing files, then finalizes.
- `publish-handler.js`: the protocol, written once over a store. `publishHandler(store, options)` returns `handle`, which answers every route. A service gives it its own database and file storage.
- `dev-server.js`: the same protocol on a memory store, for trying publish locally.

May import: the format layer and `src/shared`. `publish-handler.js` also imports `src/review/run-answer.js` to answer `GET /runs/<id>`. `dev-server.js` imports only `publish-handler.js` and `src/shared/local-host.js`.

Read first: `publishRun` in `publish.js`, then `open` inside `publishHandler` in `publish-handler.js`.

### Review: show a run

What it does: shows a run to a person or an agent.

Files, in `src/review/`:

- `run-answer.js`: `runAnswer`, the short answer about one run: the result first, then what failed and what was not checked, then the link. It imports only `src/shared/display.js`.
- `review.js`: `serveReview`, the local review page for a folder of runs.
- `transcripts.js`: the review folds text attachments with `kind: "transcript"` into a transcript panel. Set `tags.step` to the step number, starting at 1, to put it on that step. With no step number, it goes below the steps. Attach only text already checked for secrets.
- `export.js`: `journeysfirst review <runs folder> --out <new folder>` writes the same index and run pages with relative links. Open `index.html` or host the folder on GitHub Pages or another static host. The export includes the screenshots, videos, and captions the pages use. It leaves out raw run files, traces, and other attachments. Add `--include-transcripts` to include the transcript text in the pages after checking it for private data. Check the exported pages and recordings before posting them.
- `report.js`: `writeReport` writes `report.html` into a run folder, and `summaryMarkdown` is the pull request summary. Neither copies a video or a trace.
- `measured.js`: `measuredReport`, what a run's `measure-<step>.txt` files show against the earlier reviewed run. The `journey-review` skill has the criteria. This file settles only the ones a number can.
- `compare.js`: a run of a change against main's run of the same journey, case and journey version. `compareRuns` gives each user one outcome: broke, got worse, not verified, not compared, changed or same. Only what both runs measured decides it. Got worse is a control gone from a screen or further away, more clicks or fields, a click or tool call that crosses 1 second, or a new tool error. Each item has the shape of a finding, so it never changes a verdict. `journeysfirst compare` prints it, and `--add-findings` writes the items into the run, where a person answers each with `add-review`. A run where a person's call on every question among them starts with "Accepted" is what later runs of the change are compared with.
- `compare-page.js`: the compare pages, with main's runs given (`review --main <runs folder>`). `/compare` is the change: each journey, with one sentence for each user. `/compare/<journey>/<run>` is one journey: only the lines that differ, each with main beside the change, the clicks each took and the screen they end on. `review --out` writes them as `compare.html`.
- `layout.js`: the frame every review page sits in.
- `tool-calls.js`: the tool calls an agent made through an MCP proxy, read from a run's transcripts. Each call's start and wait, the errors and whether the agent recovered, and the average of earlier passed runs. `measured.js` prints them.
- `session.js`: an agent's saved session as rows on the run page, where the video would be: what it said, each command and each tool call, under the step each was done for. The files the run kept are tabs beside it.
- `run-player.js`: the run player on the review page: one user's video at a time, a switch between users, and each step as a mark on the timeline.
- `player.js`: the review page's video player. Its controls sit under the video, so they never cover the captions. It holds on each line of a video that recorded with no waiting.
- `video-lines.js`: where each line is in a video: the captions track, and where the player holds.

May import: the format layer and `src/shared`. `run-answer.js` imports no Node modules (a test checks this).

Read first: `runAnswer` in `run-answer.js`, then `runPage` in `review.js`.

### Shared: small files every layer may use

Files, in `src/shared/`. None of them imports another source file.

- `display.js`: small helpers a page needs to show a run (`isCheck`, `stepState`, `runTitle`, the verdict labels, and `reviewCounts` and `reviewLine` for a run's findings). It imports nothing, so a browser can load it (a test checks this). `runfile.js` uses it too, which is why it sits here and not in `review/`.
- `local-host.js`: what counts as this machine (`localhost`, `127.0.0.1`, `::1`). The review page and the dev server use `hostAllowed` to answer only requests addressed to this machine when they listen on it. `publish.js` uses `isLoopback` to allow plain `http://` only to this machine.
- `version.js`: the package version, read from `package.json`.
- `target.js`: the message when a run has no `baseURL` and no `webServer`. `init` prints it, and the Playwright fixture throws it.

### The rest

- `bin/journeysfirst.js`: the CLI (`validate`, `validate-run`, `merge-check`, `measured`, `compare`, `add-findings`, `add-review`, `review`, `capture`, `mcp-proxy`, `report`, `summary`, `publish`, `dev-server`, `doctor`, `init`, `upgrade`, `--version`). It uses the runner for terminal and MCP capture. Playwright uses the runner for browser journeys.
- `prepack` copies `skills/`, `spec/` and `docs/` from the repo root into this package, and `postpack` removes the copies. An install then has them at `node_modules/journeysfirst/spec` and `node_modules/journeysfirst/docs`.
- `src/doctor.js`: `doctor`. Checks Node, Playwright, Chromium, the Playwright config, whether `baseURL` answers, and each journey file. The CLI is the only caller.
- `src/setup.js`: `init` and `upgrade`. They copy the skills, add `playwright.config.js` when there is none, ignore `journey-runs/`, and add the upgrade workflow. Only `init --agent-instructions` adds the proposed Journeys section. `upgrade` refreshes existing managed sections. With no app to start, `init` also adds an example page, journey and script that pass.
- `src/index.js`: the main entry. It re-exports `format.js`, `runfile.js`, `checkRun` and `stableJson`.

## One run, from recorder to a sealed run on a service

1. `test.journey(file, body)` loads the journey with `loadJourney` and starts a `JourneyRun`, which holds a `RunRecorder`.
2. Each `journey.step` and `journey.check` calls `RunRecorder.step` or `RunRecorder.check`. The recorder checks each step with `stepProblems` right away, so an error points at the call that caused it.
3. After the test ends, even when it threw or timed out, the fixture calls `JourneyRun.finish`. It closes each user's browser, keeps their video, and calls `RunRecorder.result`. That fills in the lines nobody recorded, then `settle` works out each verdict and the run's `result`. It throws if a value marked secret appears anywhere in the run. The fixture records page addresses without their query string or fragment. The run and its files go to Playwright as attachments.
4. `JourneyReporter.onTestEnd` calls `writeRunFolder`. It checks the run with `checkRun` and writes `run.json`, the screenshots and the videos to `journey-runs/<journey name>/<run id>/`. Without Playwright, `RunRecorder.finish` calls `writeRunFolder` itself.
5. `journeysfirst publish <run folder>` calls `publishRun`. It refuses a plain `http://` address that is not this machine. Then it calls `readRunFolder`, which reads `run.json` as written, refuses it if `checkRun` finds problems or a file is missing, hashes each file with `sha256`, and works out the digest with `runDigest`. The digest covers `run.json` as written, not the run as these rules settle it.
6. The client sends `PUT /runs/<id>` with `{digest, run, files, journey}`. On the service, `handle` calls `open`. It checks the journey, runs `checkRun` on the run as sent, checks that the file list matches `runFiles`, and checks the digest against the run as sent. The run is stored only when all of that passes. `store.createRun` keeps both the run as sent and the run as the service's rules settle it. The same id with the same digest returns the stored run. A different digest replaces a run that is still open, and is a conflict once the run is sealed.
7. The reply lists the missing files, each with an upload target. A store with `uploadTarget` hands out its own storage address, so the bytes never pass through the service. Otherwise the target is `PUT /runs/<id>/files/<name>`: `file` streams the bytes, hashes them as they arrive, and calls `store.putFile`.
8. `POST /runs/<id>/finalize` first reads back each file sent straight to storage (`store.readUpload`), hashes it, checks its type and calls `store.keepUpload`. A bad file is removed and returned with a fresh target. Then it calls `store.seal`, which seals the run once every file is stored. From then on `GET /runs/<id>` answers with `runAnswer` on the stored, settled run. Reads never settle a run again, so a later rule change does not change how a stored run reads.

The publishing rules are also in [Run results v1](../spec/run-results-v1.md#publishing).

## Stability

`packages/core/package.json` has 11 entry points. They fall into three groups.

**Stable.** Build on these. The examples, the skills and the docs tell people to import them.

| Entry | What it is |
|---|---|
| `journeysfirst` | The two file formats, v1: read and check journeys and runs (`parseJourney`, `validateJourney`, `journeyPlan`, `checkRun`, `validateRun`, `settle`, `runDigest`) |
| `journeysfirst/playwright` | `test.journey` and `expect` |
| `journeysfirst/reporter` | The Playwright reporter that writes run folders |
| `journeysfirst/recorder` | `RunRecorder` and `recording(run, by)`, to write a run without Playwright |
| `journeysfirst/publish` | `publishRun`, the publish client |
| The CLI | `npx journeysfirst` and its commands |

The two formats themselves are stable too: [Journey format v1](../spec/journey-format-v1.md) and [Run results v1](../spec/run-results-v1.md).

**For service builders.** Use these to build a service that takes in runs, or a page that shows them.

| Entry | What it is |
|---|---|
| `journeysfirst/publish-handler` | `publishHandler(store, options)`, the publish protocol over your own store |
| `journeysfirst/run-answer` | `runAnswer`, the answer for one run |
| `journeysfirst/display` | Helpers a browser page needs to show a run |
| `journeysfirst/dev-server` | `startDevServer`, the protocol on a memory store, for tests |

The package uses ESM and ships TypeScript declarations for every entry above. Files under `src/` and `types/` are not import paths. Import format helpers from `journeysfirst`, not the old `journeysfirst/runfile` path. Use `journeysfirst/publish` to send a run folder or `validate-run` to check one, not the old `journeysfirst/run-folder` path.

The npm package follows [SemVer](https://semver.org/) and is still pre-1.0. Check [CHANGELOG.md](../CHANGELOG.md) before upgrading. The package interface may change, but changes to format v1 keep existing v1 journeys and runs valid unless the pull request says why not.

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
| `src/review` | `src/format`, `src/shared` |
| `src/publish` | `src/format`, `src/review`, `src/shared` |
| `src` | `src/format`, `src/shared` |
| `bin` | `src`, `src/format`, `src/publish`, `src/review`, `src/shared` |

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
- `playwright.js`: `test.journey` and the `journey` fixture (`page`, `step`, `check`, `value`). It uses `RunRecorder`.
- `captions.js`: the caption bar each user's video shows for the line in progress, and screenshots taken without it. Only `playwright.js` uses it.
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
- `export.js`: `journeysfirst review <runs folder> --out <new folder>` writes the same index and run pages with relative links. Open `index.html` or host the folder on GitHub Pages or another static host. The export includes the screenshots, videos, and captions the pages use. It leaves out raw run files, traces, and other attachments. Check the exported pages and recordings for private data before posting them.
- `report.js`: `writeReport` writes `report.html` into a run folder, and `summaryMarkdown` is the pull request summary. Neither copies a video or a trace.
- `measured.js`: `measuredReport`, what a run's `measure-<step>.txt` files show against the earlier reviewed run and the measured line in `journeys/README.md`. The `journey-review` skill has the criteria. This file settles only the ones a number can.
- `run-player.js`: the run player on the review page: one user's video at a time, a switch between users, and each step as a mark on the timeline.
- `player.js`: the review page's video player. Its controls sit under the video, so they never cover the captions.

May import: the format layer and `src/shared`. `run-answer.js` imports no Node modules (a test checks this).

Read first: `runAnswer` in `run-answer.js`, then `runPage` in `review.js`.

### Shared: small files every layer may use

Files, in `src/shared/`. None of them imports another source file.

- `display.js`: small helpers a page needs to show a run (`isCheck`, `stepState`, `runTitle`, the verdict labels, and `reviewCounts` and `reviewLine` for a run's findings). It imports nothing, so a browser can load it (a test checks this). `runfile.js` uses it too, which is why it sits here and not in `review/`.
- `local-host.js`: what counts as this machine (`localhost`, `127.0.0.1`, `::1`). The review page and the dev server use `hostAllowed` to answer only requests addressed to this machine when they listen on it. `publish.js` uses `isLoopback` to allow plain `http://` only to this machine.
- `version.js`: the package version, read from `package.json`.
- `target.js`: the message when a run has no `baseURL` and no `webServer`. `init` prints it, and the Playwright fixture throws it.

### The rest

- `bin/journeysfirst.js`: the CLI (`validate`, `validate-run`, `merge-check`, `measured`, `add-findings`, `add-review`, `review`, `report`, `summary`, `publish`, `dev-server`, `doctor`, `init`, `upgrade`, `--version`). It does not import the runner. Playwright runs the runner.
- `prepack` copies `skills/`, `spec/` and `docs/` from the repo root into this package, and `postpack` removes the copies. An install then has them at `node_modules/journeysfirst/spec` and `node_modules/journeysfirst/docs`.
- `src/doctor.js`: `doctor`. Checks Node, Playwright, Chromium, the Playwright config, whether `baseURL` answers, and each journey file. The CLI is the only caller.
- `src/setup.js`: `init` and `upgrade`. They copy the skills into `.agents/skills` and `.claude/skills` (or the folder `--skills` names), add `playwright.config.js` when there is none, ignore `journey-runs/`, write a Journeys section in `AGENTS.md`, and add the upgrade workflow, `.github/workflows/journeysfirst-upgrade.yml`. With no app to start, `init` also adds an example page, journey and script that pass. It imports Node built-ins and `src/shared/target.js`.
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
| `journeysfirst/recorder` | `RunRecorder`, to write a run without Playwright |
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

**Internal.** These may change without notice.

| Entry | Use instead |
|---|---|
| `journeysfirst/runfile` | `journeysfirst`, which re-exports all of it |
| `journeysfirst/run-folder` | `journeysfirst/publish` to send a folder, or the CLI's `validate-run` to check one |

The package is at 0.0.x. Under semver that means any release may break things, the stable entries included. A change to the formats must keep every existing v1 journey and run valid, unless the pull request says why not. [CHANGELOG.md](../CHANGELOG.md) says what changed in each release.

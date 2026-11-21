# journeysfirst

Plain-sentence user journeys that any agent can build against, run and check.

A journey is a YAML file that says what a user should be able to do in your product, in plain sentences. This package reads and checks journey files, records runs of them (with Playwright or any other tool), checks the run files, shows runs on a local review page, and publishes runs to a service.

## Install

```bash
npm install --save-dev journeysfirst @playwright/test
npx playwright install --only-shell chromium
```

It needs Node 20 or newer.

## The smallest example

`journeys/share-by-link.journey.yaml`:

```yaml
format: journeysfirst/v1
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
```

```bash
npx journeysfirst validate journeys/share-by-link.journey.yaml
```

Run it with Playwright using `test.journey` from `journeysfirst/playwright` and the `journeysfirst/reporter` reporter. Each run is written to `journey-runs/<journey name>/<run id>/`, with a video per user. The videos have captions for each line; pass `captions: false` to turn them off. Then:

```bash
npx journeysfirst validate-run journey-runs/share-by-link/<run id>
npx journeysfirst review journey-runs
```

## More

- [Repo README](https://github.com/santorilabs/journeysfirst#readme): the full walkthrough, the Playwright script and the recorder.
- [Journey format v1](https://github.com/santorilabs/journeysfirst/blob/main/spec/journey-format-v1.md)
- [Run results v1](https://github.com/santorilabs/journeysfirst/blob/main/spec/run-results-v1.md)
- [How the code fits together, and what is stable](https://github.com/santorilabs/journeysfirst/blob/main/docs/how-it-fits.md)

MIT license.

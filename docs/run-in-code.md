# Run a journey in code

Two ways to write a run folder: a saved Playwright script, or your own tools with the recorder. The [journey-run](../skills/journey-run/SKILL.md) skill picks one for your agent.

## A saved Playwright script

```js
import { test } from "journeysfirst/playwright";

test.journey("journeys/share-by-link.journey.yaml", async ({ journey }) => {
  const you = await journey.page("you", { account: "owner", login: (context, page) => page.goto("/signin/owner") });
  await journey.step("Turn on link sharing and send the link to the viewer.", { by: "you" }, async () => { /* clicks */ });
  await journey.check("link-on", { by: "you" }, async () => ({
    passed: true,
    proof: "Reloaded the page and read the saved setting.",
    evidence: [{ source: "api", login: "you", url: "https://staging.example.test/api/share", got: { linkSharing: true } }],
  }));
});
```

The run folder is written by the reporter. Add it to `playwright.config.js` (`npx journeysfirst init` adds a config with it when there is none):

```js
reporter: [["list"], ["journeysfirst/reporter", { outputDir: "journey-runs" }]],
```

- `journey.page(user, { account, login, storageState })`: each user gets their own browser context, with clipboard access and a video. No login means signed out.
- `journey.step(sentence or line number, { by }, fn)` and `journey.check(id, { by }, fn)` follow the journey's lines. The runner says who did each line in `by` (for a check, whose view it is about): `you` or a name from `users`. The code checks `by` against `users`. It never reads it from the sentence.
- `journey.value(name, value, { secret })` records a `${name}` value, such as a copied link. A secret is recorded as `{secret: true}`. Its value is never written. The run is refused if a secret's value appears anywhere else in it, like in evidence or a reason. Screenshots and video can't be checked, so keep secrets off the screen.
- Page addresses are recorded without their query string or fragment, since those can hold a sign-in token. A url you write in evidence yourself is kept as written.
- `test.journey(file, { case, repos, tags, video, captions, pause, measure }, body)`. Pass `repos` when the code under test is a deployed preview, not your checkout.
- After each line the plugin measures that user's screen for a review and saves `measure-<line>.txt` in the run folder: the spacing, type sizes, fonts and corner radii in use, each control's box at the run's width and at 375 px, and each click with the ms until the page first changed. The page goes 375 px wide for a moment, which shows in the video. `measure: "wide"` skips that half, and `measure: false` turns measuring off. `npx journeysfirst measured <run folder>` prints what the files show. With `JOURNEYS_DELAY_MS=2000` set, the test is a slow replay: each data request is held that long, each click's time is printed, and no run is written.
- Each video has captions: a bar at the top with the line in progress, then each check's verdict and why. Pass `caption` to `journey.step` and `journey.check`, and return one from a check, as one plain sentence: "You sign up with your email.", "Checking that the new room shows in Your rooms.", "the new room is not in Your rooms." (shown as "Failed: the new room is not in Your rooms."). Without one, the video shows the journey line. `captions: false` turns them off. `captions: { position: "bottom" }` moves the bar; set `journeyCaptions: { position: "bottom" }` in the config's `use` to move it for every test. With video on, the run waits `pause` ms after each action (default 500) and five times that after a check. Screenshots never show the captions. Captions need a Playwright with `page.screencast`; an older one records without them.
- `npx journeysfirst init` writes a `playwright.config.js` for `e2e/` when the repo has none. Check its `webServer` command and `env`, and keep `reuseExistingServer: false`. The app's port comes from `JOURNEYS_PORT` (4321 if unset). To run beside another run in the same repo: `JOURNEYS_PORT=4322 npx playwright test`.
- Select a journey with `npx playwright test --grep "<journey title>"`.
- A check returns `passed: false` with a `reason` for a product bug. A check that throws or returns nothing is `blocked` with cause `test`: it could not be checked. The Playwright test fails unless the run's result is `passed`. A run folder is written even when the test throws or times out.

The full example is [examples/share-by-link/tests/share-by-link.spec.js](../examples/share-by-link/tests/share-by-link.spec.js).


## Without Playwright

An agent that drives the app with its own tools writes the same run folder:

```js
import { RunRecorder } from "journeysfirst/recorder";

const run = RunRecorder.start({ journey: "journeys/share-by-link.journey.yaml", ranBy: { agent: "codex" }, tags: { environment: "staging" } });
run.user("viewer", "viewer-91fa@example.test");
run.step(1, { by: "you", screenshots: [{ image: "shots/1.png", url: "https://staging.example.test/p/q3-plan" }] });
run.check("link-on", {
  by: "you",
  verdict: "passed",
  proof: "Reloaded the page and read the saved setting.",
  evidence: [{ source: "api", login: "you", url: "/api/share", got: { linkSharing: true } }],
});
run.blocked("viewer-sees-it", { reason: "The viewer account could not be created.", cause: "environment" });
run.finish(); // journey-runs/share-by-link/<run id>/
```

Pass `at` and `took` (seconds from the run's start) on each line, and `starts_at` on each video you `attach`, so a person can jump to a step in the video.

The code enforces the rules. A `passed` check with no evidence, or none from the login of the user in `by`, becomes `not_checked` with `claimed: "passed"`. Every reader (validate-run, publish, the dev server and the review page) does the same before it trusts a run file. The result is worked out from the steps. `passed` needs every check passed and every action done. A failed check, or an action that failed because of the product, makes it `failed`. Lines you don't record are `not_run` or `not_checked`. Checks after a blocked line are blocked.

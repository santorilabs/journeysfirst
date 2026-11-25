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
- `journey.value(name, value, { secret })` records a `${name}` value, such as a copied link. A secret is recorded as `{secret: true}`. Its value is never written. The run is refused if a secret's value appears anywhere else in it, like in evidence or a reason. A screenshot covers password fields and secret values, then restores the page when something was covered. The page marker is `data-jf-mask="1"` and does not hold the value. After the run, the trace zip is rewritten so those values are gone from the text, and the original trace file is overwritten. Video is not.
- Page addresses are recorded without their query string or fragment, since those can hold a sign-in token. A url you write in evidence yourself is kept as written.
- `test.journey(file, { case, repos, tags, video, captions, pause, measure }, body)`. Pass `repos` when the code under test is a deployed preview, not your checkout.
- After each line the plugin measures that user's screen for a review and saves `measure-<line>.txt` in the run folder: the spacing, type sizes, fonts and corner radii in use, each control's box at the run's width and at 375 px, and each click with the ms until the page first changed. The page goes 375 px wide for a moment, which shows in the video. `measure: "wide"` skips that half, and `measure: false` turns measuring off. `npx journeysfirst measured <run folder>` prints what the files show. With `JOURNEYS_DELAY_MS=2000` set, the test is a slow replay: each data request is held that long, each click's time is printed, and no run is written.
- Each video has captions: a bar at the top with the line in progress, then each check's verdict and why. Pass `caption` to `journey.step` and `journey.check`, and return one from a check, as one plain sentence: "You sign up with your email.", "Checking that the new room shows in Your rooms.", "the new room is not in Your rooms." (shown as "Failed: the new room is not in Your rooms."). Without one, the video shows the journey line. `captions: false` turns them off. `captions: { position: "bottom" }` moves the bar; set `journeyCaptions: { position: "bottom" }` in the config's `use` to move it for every test. With video on, the run waits `pause` ms after each action (default 500) and five times that after a check. Set `journeyVideo: false` in the config's `use` to record no video for every test, for a run that only needs pass or fail; with no video the run does not pause either. A test's own `video` option wins. Screenshots never show the captions. Captions need a Playwright with `page.screencast`; an older one records without them.
- `npx journeysfirst init` writes a `playwright.config.js` for `e2e/` when the repo has none. Check its `webServer` command and `env`, and keep `reuseExistingServer: false`. The app's port comes from `JOURNEYS_PORT` (4321 if unset). To run beside another run in the same repo: `JOURNEYS_PORT=4322 npx playwright test`.
- Select a journey with `npx playwright test --grep "<journey title>"`.
- `npx journeysfirst report <run folder>` writes `report.html` in that folder. `npx journeysfirst summary <run folder>` prints markdown for a pull request: the result, each line, and why. Neither copies a video or a trace.
- A check returns `passed: false` with a `reason` for a product bug. A check that throws or returns nothing is `blocked` with cause `test`: it could not be checked. The Playwright test fails unless the run's result is `passed`. A run folder is written even when the test throws or times out.

The full example is [examples/share-by-link/tests/share-by-link.spec.js](../examples/share-by-link/tests/share-by-link.spec.js).


## Without Playwright

### Let Codex run a journey

```sh
npx journeysfirst run journeys/onboarding.journey.yaml --agent codex --project ./signed-out-project -- --model gpt-5.4
```

Put a recent Codex CLI on PATH and set `OPENAI_API_KEY` for its provider login. Use a trusted, signed-out project. Journeys First copies it to a scratch folder and skips dependency folders, local login files, and prior runs. Codex gets the journey's promise, start, and steps, with a clean home. This launcher only runs the `you` seat. For multi-user journeys, use the recorder directly. A run does not prove what happens with a signed-in product.

To use Docker, pass `--container <local image>`. The image needs Node and Codex, and it must support Codex's own Linux sandbox. Without an image the Codex process runs on this machine. Its default sandbox denies reads of your home directory, so Node and Codex may need to be installed outside it. Before login, the launcher probes the sandbox to make sure commands can read the project but not the login directory or your host home. It stops if a required probe fails. `--allow-host-read` explicitly permits broader host reads for trusted work; it does not relax the login probe or give the product the provider key.

For MCP, pass `--mcp <file.json>` with server names and command arrays, such as `{"example":["node","server.js"]}`. List only servers whose tools you trust Codex to call without a prompt. Journeys First approves calls only for those servers, which run through the same permission profile and the MCP proxy. Do not put admin credentials in the project or server config. If a proxied server exits with an error, the launcher reports an environment failure and exits nonzero. A tool response marked as a failure changes a check only if Codex submits it as such, with proof. A missing or invalid submission stays unverified.

`--timeout <seconds>` sets a limit for Codex. If Codex times out or exits with an error, the launcher saves partial results. If the submitted results would count as a pass, it does not save a run and exits with an error. It keeps only the last delivered agent message as `handoff.txt`, not the model's reasoning. Review the transcript for private data before sharing. The handoff is evidence of what Codex said, not what a human understood.

### Let Claude Code run a journey

```sh
claude setup-token   # once, signed in with your Claude subscription
CLAUDE_CODE_OAUTH_TOKEN=<token> npx journeysfirst run journeys/onboarding.journey.yaml --agent claude --project ./signed-out-project --allow-domains registry.npmjs.org -- --model sonnet
```

Put a recent Claude Code on PATH. On Linux, also install `bubblewrap` and `socat`, which Claude's command sandbox needs. The launcher uses only `CLAUDE_CODE_OAUTH_TOKEN`, a subscription token from `claude setup-token`. It refuses an API key, and it never passes `ANTHROPIC_API_KEY` to Claude. It hands the token to Claude Code on a pipe, so it is not in Claude's environment or in any command's environment.

The project is copied the same way as for Codex, and `.claude` is left out. Claude Code gets a clean home, no user or project settings, and only the Bash, Read, Edit, Write, Glob and Grep tools. Anything else is refused without a prompt. Commands run in Claude's sandbox, or not at all. The sandbox hides the login folder and your home directory, and lets commands write only to the project and the clean home. File tools can read only the project. Commands reach no network host unless you list it with `--allow-domains`, such as `registry.npmjs.org,*.convex.cloud`. `--allow-host-read` lets commands read your home directory.

Before the journey, the launcher runs a short setup check with Claude. It asks Claude to run a probe command and to read a file in the login folder. It stops unless Claude Code itself reports that the probe ran in the sandbox, found no login, and could not read your home directory, and that the read was refused. This check uses a little of your subscription.

`--mcp` takes the same file as for Codex. Each server runs through the MCP proxy with only `PATH` and `HOME` set. MCP servers run outside Claude's command sandbox, so list only servers you trust. `--timeout`, the saved partial results, `handoff.txt` and the rule that a run cannot pass after an unclean exit work as for Codex. `--container` is for Codex only.

### Record a terminal command or MCP exchange

```sh
npx journeysfirst capture --out terminal.txt -- npm test
npx journeysfirst mcp-proxy --out mcp.txt --secret-env CONVEX_ADMIN_KEY -- npx convex mcp start
```

For MCP, configure the client to start the proxy in place of the server. Child input and output are unchanged. The capture file saves bounded terminal output or selected MCP request names and response summaries, not MCP arguments or successful payloads. Declare extra secrets by environment variable name. The wrapper hides common key and token patterns, but redaction cannot find every private value. Check each capture before attaching or sharing it. Use a new file for each command.

In the script that owns the run, import `recording` from `journeysfirst/recorder`. Give it the run and the seat doing the work:

```js
const seat = recording(run, "you");
const file = seat.attach("terminal.txt", "terminal.txt", { login: "you" });
seat.step(actionLine);
seat.check(checkId, {
  verdict: "passed",
  proof: "The tests finished and reported success.",
  refs: [{ file, line: 1 }],
});
```

Pick a line that actually proves the check. References are one-based lines of output or responses from captures the runner attached to that seat. A request or a capture notice is not evidence. When attaching a capture, say whose session it used with `login`. For an admin or service key, use `key` with its name, never its value. If the session is unknown, attach it without an identity and do not cite it as evidence. A pass can cite only its own seat's session. The helper checks the source and line, not that the claim follows from it. Keep raw captures private and finish the run with `run.finish()`.

### Record with your own tools

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

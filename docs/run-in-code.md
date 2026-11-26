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

### Let an agent run a journey

Start with `journeysfirst run` when one agent CLI plays the whole journey. Leave out `users` to record as `you`, or write `users: [agent]` to record as `agent`. Use it even if the journey is testing the launcher itself, a custom command, or what happens after an interrupted run. Do not write the top-level run with `RunRecorder` instead: that does not exercise the launcher.

```sh
npx journeysfirst run journeys/onboarding.journey.yaml
```

Run this from the trusted test project. Journeys First chooses a supported, signed-in CLI in a fixed order and prints its choice. Pass `--agent <name>` to pick one yourself. Pass `--project <folder>` to choose which test project to copy into scratch. The run still goes under `journey-runs/` in the directory where you invoked the command, not under `--project`. Use the path printed by the launcher.

For the Codex adapter, put a recent Codex CLI on PATH and run `codex login`. Journeys First uses the existing ChatGPT or API-key login from `$CODEX_HOME/auth.json` (default `~/.codex/auth.json`). If you set `OPENAI_API_KEY`, it takes precedence. Only the login file is copied into the new Codex home for the run, after the sandbox probes pass. The launcher does not copy your Codex config or session history.

Use a trusted, signed-out project. Journeys First copies it to a scratch folder and skips hidden directories, hidden symlinks, dependency folders, common credential files, and prior runs. A root npm manifest can refer to a package archive outside the project with a relative `file:` dependency. The launcher copies that archive and updates only the scratch manifest and lockfile. The agent gets the journey's promise, start, steps, and the seat to play. The launcher marks that seat as the one played and uses it for actions, checks, and evidence from the seat's session. Use Playwright or the recorder directly for named human roles or multiple seats. A run does not prove what happens with a signed-in product.

The scratch folder must be outside the project. Leave `TMPDIR` unset to use the system temporary directory, or set it to a writable folder outside the project. If another sandbox blocks the launcher from starting its own sandbox, use a regular host terminal or a compatible container.

To use Docker, pass `--container <local image>`. For Codex, the image needs Node and Codex, and it must support Codex's Linux sandbox. Without an image the agent process runs on this machine. The launcher checks that its commands can read the scratch project but not the login or unrelated files in your home. It stops if a required probe fails. `--allow-host-read` permits broader host reads for trusted work. It does not relax the login probe or give the product the provider key.

Journeys First starts and records the stdio servers under `mcpServers` in the test project's `.mcp.json`. Each entry needs a `command` and can include `args`. The Codex adapter also reads `[mcp_servers.<name>]` entries from `$CODEX_HOME/config.toml` (default `~/.codex/config.toml`). A project entry wins when both use the same name. Pass `--mcp <file.json>` to use only that file, with server names and command arrays such as `{"example":["node","server.js"]}`. Use `{}` for no servers.

The adapter reads stdio commands and argument lists, not URL servers or the rest of the agent's config. `env_vars` in a host entry forwards only the named variables to that server. By default, replies from a server that receives forwarded variables cannot prove a pass for the user's seat. Set `journeysfirst_login = true` in that native server entry only if the server acts as the journey user's own login. Do not set it for a service or admin credential. This setting does not turn off redaction. The launcher warns and skips entries with inline `env` values or tool restrictions. If you need to choose the test servers yourself, pass an explicit test-only `--mcp` config. Only configure test servers whose tools you trust the agent to call without a prompt. If a proxied server exits with an error, the launcher saves redacted stderr when available and exits nonzero. Check the saved diagnostics and try the server command in the test project. A missing or invalid evidence submission stays unverified.

Saved output masks forwarded environment values of four or more characters. Shorter values such as `CI=1` are not used to match secrets in output. Do not use credentials shorter than four characters.

The local sandbox can run `npm` and `npx` bundled with the Node installation. Other globally installed tools may need a sandbox-readable installation or a compatible container.

The sandbox allows outbound network access. If a server needs dependencies from a registry, it can install them in the scratch project or use a sandbox-readable installation.

`--timeout <seconds>` sets a time limit. If the agent times out, is interrupted or exits with an error, the launcher saves an aborted attempt with any results already recorded. An aborted attempt cannot pass merge-check. The runner keeps the last delivered agent message as `handoff.txt`.

Codex runs also save `codex-session.jsonl`. This is the main session log from the scratch Codex home, or the Codex JSON events if no session log was written. `run.json` records the source in `tags.agent_session_source`, the CLI version in `tags.agent_cli_version`, and the observed model in `ran_by.model` when Codex reports one. A launch that stops before Codex emits any session data has no session file. The runner masks known secrets and replaces incomplete JSON lines. The session can still contain prompts, reasoning summaries, tool calls, and private project data. Check it for private data before sharing the run.

An interrupted run with no failed product checks can print:

```text
Saved not_fully_checked run to journey-runs/onboarding/2026-11-26-0126-1e30fb28.
```

`not_fully_checked` is the result, not the attempt status. Read `attempt.status` in that folder's `run.json` to confirm it is `aborted`, and `attempt.reason` to see why.

To check a rerun after an abort, run the same journey again with `journeysfirst run` and save the folder path printed by each invocation. Use `validate-run` on each folder to check the attempts separately. Use `merge-check` to check that the newer aborted attempt blocks a merge even if an older attempt passed. When testing this inside another journey, use a disposable child project and capture its launcher and merge-check output as evidence in the parent run.

Exit status `0` means the agent finished and Journeys First saved a run. It does not mean the journey passed. Read the printed run result or use `npx journeysfirst merge-check` when a journey result must stop a merge.

### Run a custom agent command

Pass `--agent "<command>"` for a CLI without a built-in adapter, or to run a fixture command:

```sh
npx journeysfirst run journeys/onboarding.journey.yaml --agent "node ./fixture-agent.mjs"
```

If the parent journey tests whether Journeys First picks a built-in adapter, launch the parent without `--agent`. Put `--agent "<command>"` on the disposable child fixture's invocation, not on the parent.

The command runs from the scratch copy of the test project and reads the journey prompt from stdin. Use a script in the test project, since paths in the command are relative to that copy. The command uses its own login and permissions. Journeys First marks the run as having an unverified sandbox. Only run trusted commands in disposable test projects. If MCP servers are configured, the runner writes a proxied `.mcp.json` in the copy. The command must read that file to use the proxies.

### Record from inside an agent run

From the scratch project, use the helper that the launcher provides:

```sh
node .journeysfirst/capture.mjs capture status.txt -- node ./check-status.mjs
```

This saves selected output to `.journeysfirst/captures/status.txt`. Choose a new `.txt` name for each capture. The launcher reserves `handoff.txt` and `launcher-preflight.txt`. If a command uses a service key, add `--key ENV_NAME` before `--`. Use the variable name, not its value. The capture helper masks that key in the output it shows the agent. Key evidence cannot prove a pass for the user's login. The MCP proxy records configured servers as `<server-name>.txt` in the same captures folder.

Append one JSON object per line to `.journeysfirst/results.jsonl` as you go. The prompt on stdin gives you the action line numbers and check IDs. For example:

```jsonl
{"line":1,"status":"done"}
{"id":"status-ready","verdict":"passed","proof":"The command reported that the service is ready.","refs":[{"file":"status.txt","line":1}]}
```

Check the actual capture before citing it. Use the capture filename and a one-based line number for an output or reply, not a request. A pass without matching evidence does not count. If you cannot prove a check, record it as `not_checked`. For a failed or blocked line, give a `reason` and a `cause` of `product`, `test`, or `environment`. A failed check also needs `proof`.

For a custom command, print the message for the person who asked for the run to stdout. The launcher saves it as `handoff.txt`. Refer to captures by filename and line because the scratch copy is deleted. The launcher imports the results and saves the run folder, even if the command aborts. Do not write `run.json` yourself.

### Record a terminal command or MCP exchange

```sh
npx journeysfirst capture --out terminal.txt -- npm test
npx journeysfirst mcp-proxy --out mcp.txt --secret-env MY_API_KEY -- node ./server.js
```

For MCP, configure the client to start the proxy in place of the server. Child input and output are unchanged. The capture saves selected request names and bounded reply text or structured results from tools, resources and prompts. It does not save request arguments. Declare extra secrets by environment variable name. Redaction cannot find every private value. Check each capture before attaching or sharing it. Use a new file for each command.

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

For a run you drive yourself, such as a multi-user journey the agent launcher cannot play, use `RunRecorder` to write the same run folder:

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

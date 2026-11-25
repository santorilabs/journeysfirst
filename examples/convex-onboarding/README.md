# Convex onboarding with JourneysFirst

We ran JourneysFirst on Convex 1.51.0 in a fresh, signed-out project. The kept agent run used Codex through `journeysfirst run --agent codex`. The other runs are scripted reproductions, not agent sessions.

## Journeys

- [Agent onboarding](journeys/agent-onboarding.journey.yaml), **real Codex run**: Anonymous local setup passed, MCP discovery failed, and the first MCP query was blocked. [Run and captured evidence](proof/runs/agent-onboarding/2026-11-25-2317-e0865210/) · [Codex handoff](proof/runs/agent-onboarding/2026-11-25-2317-e0865210/handoff.txt) · [Static review](proof/review/index.html)
- [Human onboarding](journeys/human-onboarding.journey.yaml), **scripted**: The terminal query worked, but the stdio MCP client could not find the deployment. [Run](proof/human-onboarding.run.json)
- [Dashboard hint](journeys/local-dashboard-message.journey.yaml), **scripted**: First setup printed no usable dashboard address. [Run](proof/local-dashboard-message.run.json)
- [Owner handoff](journeys/owner-handoff.journey.yaml), **scripted role-play**: The script recovered the sample result in the terminal. The role-play explained that MCP was blocked and no login was needed for the terminal result. This is not an assessment of a real agent-to-owner handoff. [Run](proof/owner-handoff.run.json) · [Transcript](proof/owner-handoff.transcript.txt)

These screenshots are from the earlier scripted reproductions, not from Codex: [local setup](proof/screens/agent-seat.png), [failing MCP step](proof/screens/mcp-failure.png), [human terminal run](proof/screens/human-terminal.png), [dashboard hint](proof/screens/dashboard-hint.png), and [owner handoff role-play](proof/screens/human-behind-agent.png).

## Findings

### Local development works without an account, but MCP requires login

Codex [started the local backend in anonymous mode](proof/runs/agent-onboarding/2026-11-25-2317-e0865210/local-ready.txt). Convex reported “No Convex account” and “Convex functions ready!” The [proxied MCP `status` call](proof/runs/agent-onboarding/2026-11-25-2317-e0865210/convex.txt) then returned:

> Not Authorized: Run `npx convex dev` to login to your Convex project.

The suggested command was already running. Without a cloud login, MCP returned no deployment selector, even when Codex retried in anonymous mode. The first MCP query was blocked and did not run. We did not test whether signing in fixes discovery for that local deployment.

The terminal query did work in the earlier [scripted human reproduction](proof/human-onboarding.transcript.txt):

```text
$ npx --no-install convex run hello:first
"hello from Convex"
```

**Why:** [MCP checks management authorization before dispatching the tool](https://github.com/convex/convex-js/blob/1228536614f874e0847a0ac33a91c43cf8694a2d/src/cli/mcp.ts#L165-L196). [No management auth header means the check fails](https://github.com/convex/convex-js/blob/1228536614f874e0847a0ac33a91c43cf8694a2d/src/cli/lib/login.ts#L81-L91), so the tool never reaches local deployment discovery.

**Suggested fix:** Let MCP use the project's local deployment credentials for account-free local setup. Keep the management login requirement for cloud operations.

### Setup shows a dashboard address of `null`

> View the Convex dashboard at null

The [first-run transcript](proof/local-dashboard-message.transcript.txt) shows this before the dashboard download finishes. A newcomer has no address to open, and an agent has no working link to give the owner. We did not test the dashboard UI.

**Why:** [Setup prints the address unconditionally](https://github.com/convex/convex-js/blob/1228536614f874e0847a0ac33a91c43cf8694a2d/src/cli/lib/init.ts#L61-L69), but [the lookup can return `null` before the local dashboard has a config](https://github.com/convex/convex-js/blob/1228536614f874e0847a0ac33a91c43cf8694a2d/src/cli/lib/localDeployment/dashboard.ts#L149-L155).

**Suggested fix:** Print the link only when an address is available.

### JourneysFirst setup had extra browser steps

JourneysFirst 0.0.6 asked us to install Chromium again after it was installed and generated a Playwright web server config this terminal-only app did not need. A terminal-only setup could skip those steps. `RunRecorder` kept the logs without a browser; use the transcripts for the full exchange and the review UI for step-by-step evidence.

## Reproduce

For the real agent path, use a JourneysFirst checkout that includes [the Codex launcher and its DNS fix](https://github.com/santorilabs/journeysfirst/tree/90954da82243ea892bbd08d41db23dfb1ba5d2e4), and follow its [Codex setup instructions](https://github.com/santorilabs/journeysfirst/blob/90954da82243ea892bbd08d41db23dfb1ba5d2e4/docs/run-in-code.md#let-codex-run-a-journey). Save this as `convex-mcp.json` outside the project:

```json
{"convex":["npx","--yes","convex@1.51.0","mcp","start"]}
```

From this example directory, set `JF_CHECKOUT` to the absolute path to that checkout and run:

```sh
node "$JF_CHECKOUT/packages/core/bin/journeysfirst.js" run journeys/agent-onboarding.journey.yaml --agent codex --project . --mcp /path/to/convex-mcp.json
```

Open `proof/review/index.html` in a browser. To regenerate the export from the checked-in run, run `node "$JF_CHECKOUT/packages/core/bin/journeysfirst.js" review proof/runs --out ./new-review --include-transcripts`.

For the older scripted reproduction, run these three commands on Linux with Node.js 20 or newer. They use a fresh project and home directory, so an existing login does not affect the result.

```sh
sandbox="$(mktemp -d)" && mkdir "$sandbox/app" "$sandbox/home" && \
  cp -R convex journeys capture.mjs owner-assessment.mjs "$sandbox/app/"
(cd "$sandbox/app" && export HOME="$sandbox/home" && \
  npm init -y && npm install convex@1.51.0 journeysfirst@0.0.6)
(cd "$sandbox/app" && ORIGINAL_HOME="$HOME" HOME="$sandbox/home" node capture.mjs agent)
```

The script keeps local development running, calls MCP `status`, and saves a transcript under the printed `RUN` path. To see the run in the review UI, run `npx journeysfirst review journey-runs` from the scratch app. [Run all four journeys and see release source notes](journeys/README.md).

# Convex onboarding with JourneysFirst

We ran JourneysFirst on Convex 1.51.0 as a new agent and a new human, without a Convex account.

## Journeys

- [Agent onboarding](journeys/agent-onboarding.journey.yaml): Local setup passed, MCP discovery failed, and the first MCP query was blocked. [Run](proof/agent-onboarding.run.json)
- [Human onboarding](journeys/human-onboarding.journey.yaml): The terminal query worked, but the editor's MCP client could not find the deployment. [Run](proof/human-onboarding.run.json)
- [Dashboard hint](journeys/local-dashboard-message.journey.yaml): First setup did not give the human a usable dashboard address. [Run](proof/local-dashboard-message.run.json)
- [Owner handoff](journeys/owner-handoff.journey.yaml): The agent got a result in the terminal. The owner understood that MCP was still blocked and no login was needed for the terminal result. No dashboard address was handed over. [Run](proof/owner-handoff.run.json) · [Transcript](proof/owner-handoff.transcript.txt)

JourneysFirst kept what worked, what failed, and what could not be tried. Open the review screenshots: [agent setup](proof/screens/agent-seat.png), [failing MCP step](proof/screens/mcp-failure.png), [human terminal run](proof/screens/human-terminal.png), [dashboard hint](proof/screens/dashboard-hint.png), and [owner handoff](proof/screens/human-behind-agent.png).

## Findings

### MCP cannot find the local deployment that just started

The terminal query worked, but MCP `status` returned an error. From the [human onboarding transcript](proof/human-onboarding.transcript.txt):

```text
$ npx --no-install convex run hello:first
"hello from Convex"
```

> Not Authorized: Run `npx convex dev` to login to your Convex project.

The [agent run](proof/agent-onboarding.transcript.txt) hit the same error. The command it suggests was already running. Without a deployment selector, neither client could try an MCP query.

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

Run these three commands from this example directory on Linux with Node.js 20 or newer. They use a fresh project and home directory, so an existing login does not affect the result.

```sh
sandbox="$(mktemp -d)" && mkdir "$sandbox/app" "$sandbox/home" && \
  cp -R convex journeys capture.mjs owner-assessment.mjs "$sandbox/app/"
(cd "$sandbox/app" && export HOME="$sandbox/home" && \
  npm init -y && npm install convex@1.51.0 journeysfirst@0.0.6)
(cd "$sandbox/app" && ORIGINAL_HOME="$HOME" HOME="$sandbox/home" node capture.mjs agent)
```

The script keeps local development running, calls MCP `status`, and saves a transcript under the printed `RUN` path. To see the run in the review UI, run `npx journeysfirst review journey-runs` from the scratch app. [Run all four journeys and see release source notes](journeys/README.md).

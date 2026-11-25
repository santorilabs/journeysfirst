# Convex onboarding

## Foundation

- The CLI offers new users an account-free local option and lets agents select it without a prompt. Source: Convex 1.51.0, `src/cli/configure.ts:239–301`.
- The MCP status tool gives clients a deployment selector to use in later calls. Source: `src/cli/lib/mcp/tools/status.ts:38–55`.
- A dashboard hint should give a newcomer something usable. Source: the onboarding request and the CLI hint in `src/cli/lib/init.ts:61–69`.

## Journeys

- Agent: start local development and run a first MCP query.
- Human: start local development, run a CLI query, and then query from an editor's MCP client.
- Human: read the first-run dashboard hint.
- Owner and agent: delegate setup, recover a first result, and explain what remains blocked.

| Run | Agent's seat | Human's seat |
|---|---|---|
| Agent onboarding (real Codex run) | Anonymous local setup passed. MCP status returned `Not Authorized` without a cloud login, and the first MCP query was blocked. | No human exchanged messages. |
| Human onboarding | No conversational agent took part. The stdio client listed tools but could not find the deployment. | Local setup and the terminal query passed after two confirmations. The MCP query was blocked. |
| Dashboard hint | No agent took part. | The hint gave no usable address. This run used the same fresh startup as human onboarding. |
| Delegated setup (scripted role-play) | MCP discovery failed. The script recovered the sample result through the terminal. | The owner role restated what worked and what was blocked. This does not establish what a real owner understood. |

These were local runs, not tests of signed-in or cloud deployments. The dashboard check covered the first-run message only.

## Running safely

Run in isolated scratch projects with separate fresh home directories, no login or deploy keys, and a read-only sample query. The terminal and stdio client are the only interfaces exercised; no browser or shared deployment is needed.

## Replay the scripted journeys

For the real Codex run, follow the [example instructions](../README.md#reproduce). For these scripted replays, use Linux with Node.js 20+, npm, and util-linux `script` for the interactive terminal. This is the full JourneysFirst install we used, including Chromium and the skills. Playwright 1.65.1 is installed but doesn't drive these runs.

```sh
bundle="$PWD"
root="$(mktemp -d)"

for role in agent human owner; do
  mkdir -p "$root/$role" "$root/home-$role"
  cp -R "$bundle/convex" "$bundle/journeys" "$bundle/capture.mjs" "$bundle/owner-assessment.mjs" "$root/$role/"
  (
    cd "$root/$role" &&
    export HOME="$root/home-$role" &&
    npm init -y &&
    npm install --save-exact convex@1.51.0 &&
    npm install -D journeysfirst@0.0.6 @playwright/test@1.65.1 &&
    npx playwright install --only-shell chromium &&
    npx journeysfirst init --skills .agents/skills &&
    for journey in journeys/*.journey.yaml; do npx journeysfirst validate "$journey" || exit; done
  ) || break
done
```

After setup succeeds, run these one at a time:

1. `(cd "$root/agent" && ORIGINAL_HOME="$HOME" HOME="$root/home-agent" node capture.mjs agent)`
2. `(cd "$root/human" && ORIGINAL_HOME="$HOME" HOME="$root/home-human" node capture.mjs human)`. Press Enter for “Start without an account” and then for “Continue?” This also saves the dashboard hint run.
3. `(cd "$root/owner" && ORIGINAL_HOME="$HOME" HOME="$root/home-owner" node capture.mjs owner)`. Enter “Set up Convex for my app and connect the MCP.” Reply as the agent based on what happened, then restate the result as the human. Do not enter credentials.

The script prints each run's path. From the respective scratch app, run `npx journeysfirst validate-run <run folder>` to check the steps and evidence. The saved public runs use placeholders for local paths, email addresses, and any deployment selector. There are no browser measurements.

## How the MCP test works

The recorder keeps `convex dev` open and starts `npx convex mcp start` over stdio. In the agent and owner cases it exports `CONVEX_AGENT_MODE=anonymous` to both. The client sends `initialize`, `notifications/initialized`, and `tools/list`, then calls `status` with the project directory. If `status` doesn't return a selector, the checks that need one are blocked: the test doesn't invent a selector or count uncalled tools as failures.

## Release source

The [npm package](https://www.npmjs.com/package/convex/v/1.51.0) lists `convex/convex-backend`, directory `npm-packages/convex`, as its repository. The public CLI files at [`npm/1.51.0` in `convex/convex-js`](https://github.com/convex/convex-js/tree/npm/1.51.0) match the files cited here from the npm package.

- [The dev CLI offers account-free setup](https://github.com/convex/convex-js/blob/1228536614f874e0847a0ac33a91c43cf8694a2d/src/cli/configure.ts#L239-L301). [MCP checks authorization before calling a tool](https://github.com/convex/convex-js/blob/1228536614f874e0847a0ac33a91c43cf8694a2d/src/cli/mcp.ts#L165-L213), and [no management auth header means authorization fails](https://github.com/convex/convex-js/blob/1228536614f874e0847a0ac33a91c43cf8694a2d/src/cli/lib/login.ts#L81-L91).
- [The status handler asks for deployment credentials](https://github.com/convex/convex-js/blob/1228536614f874e0847a0ac33a91c43cf8694a2d/src/cli/lib/mcp/tools/status.ts#L63-L96). [The credential loader supports anonymous local deployments](https://github.com/convex/convex-js/blob/1228536614f874e0847a0ac33a91c43cf8694a2d/src/cli/lib/api.ts#L911-L942), but the request hasn't reached it.
- [Setup prints the dashboard hint unconditionally](https://github.com/convex/convex-js/blob/1228536614f874e0847a0ac33a91c43cf8694a2d/src/cli/lib/init.ts#L57-L70). [The local dashboard URL can be null until it has a config](https://github.com/convex/convex-js/blob/1228536614f874e0847a0ac33a91c43cf8694a2d/src/cli/lib/localDeployment/dashboard.ts#L149-L156).

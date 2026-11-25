# Convex 1.51.0: account-free onboarding and MCP

Convex creates a working account-free local deployment, but the first MCP `status` call asks the user to log in. This happened both in anonymous agent mode and after choosing “Start without an account” from a terminal. The local CLI query returned `"hello from Convex"`. The initial setup also printed `View the Convex dashboard at null`.

## Reproduce

Use Linux with Node.js 20+, npm, and util-linux `script` (needed for the human terminal). Start from the directory containing the downloaded proof files. If you downloaded the gist, its files are flat; the commands also work from the unflattened bundle. The sandbox uses a read-only sample query and no account, keys, cloud deployment, or model subscription.

```sh
set -eu
bundle="$PWD"
original_home="$HOME"
root="$(mktemp -d)"

for role in agent human owner; do
  mkdir -p "$root/$role/convex" "$root/$role/journeys" "$root/home-$role"
  if [ -f "$bundle/hello.js" ]; then
    cp "$bundle/hello.js" "$root/$role/convex/"
    cp "$bundle/"*.journey.yaml "$root/$role/journeys/"
  else
    cp "$bundle/convex/hello.js" "$root/$role/convex/"
    cp "$bundle/journeys/"*.journey.yaml "$root/$role/journeys/"
  fi
  cp "$bundle/capture.mjs" "$bundle/owner-assessment.mjs" "$root/$role/"
  (
    cd "$root/$role"
    export HOME="$root/home-$role"
    npm init -y
    npm install --save-exact convex@1.51.0
    npm install -D journeysfirst@0.0.6 @playwright/test@1.65.1
    npx playwright install --only-shell chromium
    npx journeysfirst init --skills .agents/skills
    for journey in journeys/*.journey.yaml; do npx journeysfirst validate "$journey"; done
  )
done

(cd "$root/agent" && ORIGINAL_HOME="$original_home" HOME="$root/home-agent" node capture.mjs agent)
# In the terminal, press Enter for “Start without an account” and then for “Continue?”.
(cd "$root/human" && ORIGINAL_HOME="$original_home" HOME="$root/home-human" node capture.mjs human)
(cd "$root/owner" && ORIGINAL_HOME="$original_home" HOME="$root/home-owner" node capture.mjs owner)
# Enter the human request: Set up Convex for my app and connect the MCP.
# Reply as the agent based on the actual result, then restate it as the human.
# Use only this synthetic project. Never paste credentials into the dialogue.

for role in agent human owner; do
  (cd "$root/$role" && for run in journey-runs/*/*; do npx journeysfirst validate-run "$run"; done)
done
printf 'Run folders: %s/{agent,human,owner}/journey-runs/\n' "$root"
```

The recorder holds each `convex dev` process open, then starts `npx convex mcp start` over stdio. The agent case exports `CONVEX_AGENT_MODE=anonymous` to both processes. The MCP client sends `initialize`, `notifications/initialized`, `tools/list`, then `tools/call` for `status` with the project directory. In the human case it first runs `npx convex run hello:first` from a second process. If `status` returns a deployment selector, the client uses it to call the next tools; otherwise those steps are blocked, not counted as failures of the uncalled tools.

## Two seats, two outcomes

The human in the editor journey runs the CLI directly. The human in the handoff journey delegates setup and reads what the agent tells them. Devin played both sides of that separate dialogue and entered each turn after seeing the previous one. This measures one role-play, not a human usability study or the performance of every agent.

| Journey | Agent's seat | Human's seat |
|---|---|---|
| Anonymous agent onboarding | Local setup passed; MCP discovery failed; first MCP query was blocked. | No human exchanged messages in this run. The delegated handoff below tests what the owner learns. |
| Human terminal and editor | The editor's stdio client listed the tools, but could not discover the deployment or run a query. No conversational agent participated. | Local setup and the CLI query passed after two terminal confirmations. The first editor query was blocked. |
| First dashboard hint | No agent acted in this run. | The terminal printed a null dashboard address. No dashboard data was viewed. |
| Delegated setup handoff | The agent did not get an MCP selector. It recovered the sample query via the CLI and distinguished that success from an MCP connection. | The human understood the result, the MCP block, and that the CLI fallback required no login or setup intervention. They did not get a dashboard address. |

There was no first MCP query in any run. In the handoff, the first CLI query returned 8.9 seconds after the request, with no setup or authentication intervention by the human. That time includes cold local setup and is not a benchmark. The human saw only the synthetic query value in the handoff; no real data or dashboard UI was inspected.

## Issues

| Issue | Repro | Expected | Actual |
|---|---|---|---|
| MCP cannot discover an anonymous local deployment | Start `npx convex dev` with `CONVEX_AGENT_MODE=anonymous` or choose the account-free terminal option. Keep it running and call MCP `status` for that project. | A local deployment selector usable for a first query, or a clear statement that MCP does not support account-free deployments. | MCP initializes and lists its tools, but `status` reports “Not Authorized” and tells the user to run `npx convex dev` to log in. No selector is returned. |
| First local setup prints a null dashboard address | Start `npx convex dev` in a fresh, unsigned-in app and choose “Start without an account.” | A usable dashboard hint, or no address until one exists. | `View the Convex dashboard at null`. |

From the owner's seat, these defects leave two parts of the handoff incomplete: the agent can show a CLI result but cannot say it connected MCP, and it can offer a dashboard command but cannot hand over a working dashboard address from setup. The MCP refusal tells the agent to run the command already running; following it alone does not give the owner a useful next step. This is local onboarding evidence, not a claim about signed-in or cloud deployments. The human MCP case uses the same stdio transport as an editor, not an editor UI.

## Source at the release tag

The [npm package](https://www.npmjs.com/package/convex/v/1.51.0) lists `convex/convex-backend`, directory `npm-packages/convex`, as its repository. The corresponding public CLI source is tagged [`npm/1.51.0` in `convex/convex-js`](https://github.com/convex/convex-js/tree/npm/1.51.0). The files cited here match those shipped in the npm package.

- [Local setup skips login in agent mode and offers an account-free option in a terminal](https://github.com/convex/convex-js/blob/1228536614f874e0847a0ac33a91c43cf8694a2d/src/cli/configure.ts#L239-L301).
- [MCP authenticates before dispatching the tool handler](https://github.com/convex/convex-js/blob/1228536614f874e0847a0ac33a91c43cf8694a2d/src/cli/mcp.ts#L165-L213); [a missing management auth header fails that check](https://github.com/convex/convex-js/blob/1228536614f874e0847a0ac33a91c43cf8694a2d/src/cli/lib/login.ts#L81-L91).
- [The status handler requests deployment credentials](https://github.com/convex/convex-js/blob/1228536614f874e0847a0ac33a91c43cf8694a2d/src/cli/lib/mcp/tools/status.ts#L63-L96), and [the credential loader supports anonymous local deployments](https://github.com/convex/convex-js/blob/1228536614f874e0847a0ac33a91c43cf8694a2d/src/cli/lib/api.ts#L911-L942).
- [Setup prints the dashboard hint unconditionally](https://github.com/convex/convex-js/blob/1228536614f874e0847a0ac33a91c43cf8694a2d/src/cli/lib/init.ts#L57-L70), and [the local URL can be null until the dashboard has a config](https://github.com/convex/convex-js/blob/1228536614f874e0847a0ac33a91c43cf8694a2d/src/cli/lib/localDeployment/dashboard.ts#L149-L156).

## Reading the proof

Each journey has a matching `.run.json` verdict and `.transcript.txt` recording of the terminal or MCP responses. The dashboard check and human journey observe the same fresh human startup. Project paths, email addresses, and any returned deployment selector are replaced with placeholders. Terminal control characters and download progress are omitted. No dashboard page was opened.

## JourneysFirst onboarding notes

- `init` recommended installing Chromium even after the documented install command had successfully installed it. It also generated a Playwright config that wanted a web server in this terminal-only project. The installed run skill documented `RunRecorder`, which did not need either.
- `validate-run` accepted the transcript-backed runs and matched their journey steps. `measured` reported no measure files, so browser-specific review criteria were not measured.

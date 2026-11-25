# Convex 1.51.0: agent mode starts a deployment that MCP rejects

We asked a coding agent to set up Convex in a fresh app and connect MCP so it could query Convex directly. We checked what the agent could do and what the person who asked it would learn.

The same failure happened when starting without an account from a terminal. From [that run's transcript](proof/human-onboarding.transcript.txt), with the MCP handshake omitted:

```text
$ npx --no-install convex run hello:first
"hello from Convex"
$ npx --no-install convex mcp start
> {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"status","arguments":{"projectDir":"<PROJECT>"}}}
< {"result":{"content":[{"type":"text","text":"{\"error\":\"Not Authorized: Run `npx convex dev` to login to your Convex project.\"}"}],"isError":true},"jsonrpc":"2.0","id":3}
```

## Two seats

**The agent**

- Convex started locally without a login, and MCP listed its tools.
- MCP refused to find the deployment and told the agent to run `npx convex dev`, which was already running.
- The agent got the sample result through the terminal instead. It never got an MCP query result.

**The person who asked the agent**

- The agent reported “hello from Convex” and made clear that the terminal worked but MCP was still disconnected.
- The person didn't have to sign in or change setup to get that result. It took 8.9 seconds in [this role-play](proof/owner-handoff.transcript.txt), not a benchmark.
- The agent suggested a dashboard command but couldn't give the person a working dashboard address.

## Reproduce

From this example directory on Linux with Node.js 20 or newer, run these three commands. They use a fresh local project and home directory. No Convex account or model key is needed.

```sh
sandbox="$(mktemp -d)" && mkdir "$sandbox/app" "$sandbox/home" && \
  cp -R convex journeys capture.mjs owner-assessment.mjs "$sandbox/app/"
(cd "$sandbox/app" && export HOME="$sandbox/home" && \
  npm init -y && npm install convex@1.51.0 journeysfirst@0.0.6)
(cd "$sandbox/app" && ORIGINAL_HOME="$HOME" HOME="$sandbox/home" node capture.mjs agent)
```

The script keeps `convex dev` running in anonymous agent mode and sends this call to `npx convex mcp start` after connecting. Look for the reply in `transcript.txt` under the printed `RUN` path in `$sandbox/app`. If you send the call from another connected client, replace `<PROJECT>` with the project directory:

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"status","arguments":{"projectDir":"<PROJECT>"}}}
```

**Other finding:** First local setup prints `View the Convex dashboard at null` instead of a usable address. We did not open the dashboard.

## Details

| What we tried | Journey | Kept proof |
|---|---|---|
| Agent starts Convex and tries MCP | [Journey](journeys/agent-onboarding.journey.yaml) | [Run](proof/agent-onboarding.run.json) · [Transcript](proof/agent-onboarding.transcript.txt) |
| Human starts without an account, queries in the terminal, then tries MCP | [Journey](journeys/human-onboarding.journey.yaml) | [Run](proof/human-onboarding.run.json) · [Transcript](proof/human-onboarding.transcript.txt) |
| Human reads the first dashboard hint | [Journey](journeys/local-dashboard-message.journey.yaml) | [Run](proof/local-dashboard-message.run.json) · [Transcript](proof/local-dashboard-message.transcript.txt) |
| Human delegates setup and reads the agent's reply | [Journey](journeys/owner-handoff.journey.yaml) | [Run](proof/owner-handoff.run.json) · [Transcript](proof/owner-handoff.transcript.txt) |

**Why keep it here?** It's a runnable JourneysFirst example that keeps what each role saw, not just what the tool returned. Devin played both roles in the handoff. We used a local sample query, not real user data, and tested the editor's MCP transport, not its interface.

**Why it happens:** In [Convex 1.51.0](https://github.com/convex/convex-js/tree/npm/1.51.0), [local setup allows no login](https://github.com/convex/convex-js/blob/1228536614f874e0847a0ac33a91c43cf8694a2d/src/cli/configure.ts#L239-L301), but [MCP checks login before the tool can look up the deployment](https://github.com/convex/convex-js/blob/1228536614f874e0847a0ac33a91c43cf8694a2d/src/cli/mcp.ts#L165-L213). [Setup prints the dashboard hint](https://github.com/convex/convex-js/blob/1228536614f874e0847a0ac33a91c43cf8694a2d/src/cli/lib/init.ts#L57-L70) even when [the address is null](https://github.com/convex/convex-js/blob/1228536614f874e0847a0ac33a91c43cf8694a2d/src/cli/lib/localDeployment/dashboard.ts#L149-L156).

**JourneysFirst 0.0.6:** Setup asked us to install Chromium again and generated a web server config we didn't need. `RunRecorder` kept the terminal proof without a browser. [Run every journey and see the full source notes](journeys/README.md).

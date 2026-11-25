# shadcn 4.23.1: MCP registry onboarding, with Codex as the agent

shadcn's MCP server (in the `shadcn` package, 4.23.1) says one thing about which registries a project has and does another when an agent searches. `get_project_registries` lists the built-in `@shadcn` registry. A search that names no registry leaves `@shadcn` out: in a new project it answers "No registries are configured", and with a second registry it searches only that one, without saying so.

A real agent hit it once and recovered. In 1 of 10 tries (these 3 runs and 7 others), Codex (codex-cli 0.172.0) searched with no registry named, got "No registries are configured" right after being told `@shadcn` was set up, and searched again with `registries: ["@shadcn"]`. In the other 9 it named `@shadcn` from the start. It always found the right component. So the bug is real in the server and does reach agents, but Codex was not left confused.

## What was tested

Each journey is a brand-new user in a fresh copy of a new app. The agent is Codex, run with `codex exec` and its own settings folder, with only the shadcn MCP server. Each run reviews two seats: the agent's (what the server told it) and the human's behind it (what the agent told them, and what it did in their app).

| Journey | Agent's seat | Human's seat | Run |
|---|---|---|---|
| Ask your agent what shadcn has for you | Listed `@shadcn`, then searched with no registry and got "No registries are configured". Retried with `registries: ["@shadcn"]` and found 3 date pickers. | Got the right registry and 3 date picker names, but no command to add one. | failed ([proof](proof/agent-finds-a-component/2026-11-25-2031-8c625346)) |
| Add a shadcn component when you have two registries (`@magicui` added) | Searched `@shadcn` and `@magicui` by name, added `@shadcn/accordion`. A search with no registry covered only `@magicui`. | The accordion is on the home page and opens. | failed on the added check ([proof](proof/agent-adds-from-two-registries/2026-11-25-2019-17f8afa0)) |
| Connect your agent to shadcn and add a button (plain Vite app) | The server gave an add command without saying shadcn was not set up. Before init, `get_project_registries` says "The following registries are configured" and lists nothing. | `shadcn mcp init --client codex` printed manual steps (it writes the file for the other 4 clients). Codex then set up shadcn (Radix, Nova preset, Tailwind, tsconfig) without asking, and said it "used the shadcn MCP server". A shadcn button is on the page. | failed on the added check ([proof](proof/you-connect-your-agent/2026-11-25-2017-aca75273)) |

Checks marked `added: true` call the same MCP server from the same app folder with no registry named. That is what the server's own code comment invites: "When registries are omitted, search every configured registry".

## Findings

1. **Listed but not searched.** `resolveSearchRegistries` (`packages/registry/src/registry/search.ts`) drops built-in registries when none are named, while `getRegistriesConfig` (`packages/registry/src/registry/api.ts`) adds `@shadcn` to what `get_project_registries` lists. Key screenshots: Codex hitting it, [step-2.png](proof/agent-finds-a-component/2026-11-25-2031-8c625346/step-2.png), and the same server asked directly, [step-5.png](proof/agent-finds-a-component/2026-11-25-2031-8c625346/step-5.png).
2. **Wrong next step in the refusal.** "Add registries to components.json" when `@shadcn` is already set up.
3. **Silent skip.** With `@magicui` added, a search for "accordion" returns 7 Magic UI items and never mentions `@shadcn`, which has the accordion.
4. **Empty "configured" list before init.** The "No components.json found" reply in `packages/shadcn/src/mcp/index.ts` is never reached, and tool descriptions point to `init_project`, a tool the server does not have.
5. **Codex setup is manual.** `shadcn mcp init --client codex` prints steps for `~/.codex/config.toml` and pins `shadcn@latest`.
6. **Human seat.** Asked to find a date picker, Codex named three but gave the person no command to add one (the server's reply had it). Codex also made setup choices in the person's app without asking, and credited the MCP server for work the CLI did.

Each run's `findings.json` holds these with evidence. Questions for a person are marked `ask`.

## Run it

Node 20+, Codex logged in (`codex login`), and two template apps in `~/work/templates`, where `e2e/agent.js` looks for them:

```sh
example="$PWD"
mkdir -p ~/work/templates && cd ~/work/templates
CI=1 npx -y shadcn@4.23.1 init -t vite -n shadcn-app --no-monorepo -b radix -p nova -y </dev/null
npm create vite@latest plain-vite -- --template react-ts && (cd plain-vite && npm install)
cd "$example"
npm install && npx playwright install --only-shell chromium
npx playwright test
for run in journey-runs/*/*; do npx journeysfirst validate-run "$run"; done
```

`e2e/agent.js` copies a template per run into `~/work/jf-work/`, gives Codex a fresh `CODEX_HOME` with only `auth.json`, and starts that copy's Vite server on 5301 to 5303. Codex runs with `--dangerously-bypass-approvals-and-sandbox`, so run it only in a throwaway machine.

`proof/` keeps each run folder as written (home paths shown as `~`): `run.json`, a screenshot per step, each user's video, `codex-session.jsonl` (Codex's own event log) and `findings.json`.

An earlier run of the two-registry journey (not kept) failed `searches-shadcn-too` because the check read only MCP calls, and that time Codex searched with `shadcn search @shadcn @magicui`. The check now counts both.

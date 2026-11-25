# shadcn 4.23.1: the MCP server lists @shadcn, then leaves it out of searches

We asked a coding agent (Codex) to use shadcn's new MCP server in a fresh app, as a brand-new user would. We checked what the agent was told and what the person who asked it would learn.

The server says one thing about which registries a project has and does another when an agent searches. From [this run](proof/agent-finds-a-component/2026-11-25-2031-8c625346), in a new shadcn app with no other registry, these are Codex's own first two calls:

```text
get_project_registries {}
  The following registries are configured in the current project:
  - @shadcn
search_items_in_registries {"query":"date-picker","limit":12}
  No registries are configured. Add registries to components.json (use get_project_registries to inspect) or pass them explicitly.
```

Codex then searched again with `registries: ["@shadcn"]` and found the date pickers. It hit this in 1 of 10 tries (these 3 runs and 7 others). In the other 9 it named `@shadcn` from the start. It always found the right component. So the bug is real and does reach agents, but Codex was not left stuck.

## Two seats

**The agent**

- `get_project_registries` lists `@shadcn`. A search or list that names no registry leaves it out.
- In a new app that search says "No registries are configured" and tells the agent to add registries, though `@shadcn` is already set up.
- With `@magicui` added, a search for "accordion" covers only Magic UI. It returns 7 Magic UI items and does not say it skipped `@shadcn`, which has the accordion.
- Before `shadcn init`, `get_project_registries` says "The following registries are configured" and lists nothing. The tool descriptions say to use `init_project`, a tool the server does not have.

**The person who asked the agent**

- Asked to find a date picker, Codex named three but gave no command to add one. The server's reply had the commands.
- `shadcn mcp init --client codex` printed manual steps instead of writing Codex's settings, as it does for the other 4 clients. The printed block pins `shadcn@latest`, not the version the person ran.
- In a plain Vite app, Codex set up shadcn for the person (Radix, the Nova preset, Tailwind, tsconfig) without asking. It then said it "used the shadcn MCP server", though shadcn's CLI did the setup. A working shadcn button is on the page.

## Findings, each with its run and root cause

| # | Finding | Run | Root cause in shadcn 4.23.1 |
|---|---|---|---|
| 1 | **Listed but not searched.** A search with no registry named leaves out `@shadcn`, which `get_project_registries` lists. | [Codex hits it](proof/agent-finds-a-component/2026-11-25-2031-8c625346/step-2.png), [server asked directly](proof/agent-finds-a-component/2026-11-25-2031-8c625346/step-5.png), [run](proof/agent-finds-a-component/2026-11-25-2031-8c625346/run.json) | [`getRegistriesConfig` adds `BUILTIN_REGISTRIES`](https://github.com/shadcn-ui/ui/blob/d24297f0208925d2a5efafbb29c3f293a9eb368f/packages/registry/src/registry/api.ts#L232-L238) to what the tool lists. [`resolveSearchRegistries` drops them](https://github.com/shadcn-ui/ui/blob/d24297f0208925d2a5efafbb29c3f293a9eb368f/packages/registry/src/registry/search.ts#L19-L35) when no registry is named. The [MCP search](https://github.com/shadcn-ui/ui/blob/d24297f0208925d2a5efafbb29c3f293a9eb368f/packages/shadcn/src/mcp/index.ts#L262-L265) and list tools call it. |
| 2 | **Wrong next step.** The refusal says to add registries to components.json when `@shadcn` is already set up. | [step-2.png](proof/agent-finds-a-component/2026-11-25-2031-8c625346/step-2.png) | [`NO_REGISTRIES_MESSAGE`](https://github.com/shadcn-ui/ui/blob/d24297f0208925d2a5efafbb29c3f293a9eb368f/packages/shadcn/src/mcp/index.ts#L114) is shown whenever finding 1 leaves the list empty. |
| 3 | **Silent skip.** With `@magicui` added, a search for "accordion" covers only Magic UI and does not say so. | [step-4.png](proof/agent-adds-from-two-registries/2026-11-25-2019-17f8afa0/step-4.png), [step-5.png](proof/agent-adds-from-two-registries/2026-11-25-2019-17f8afa0/step-5.png), [run](proof/agent-adds-from-two-registries/2026-11-25-2019-17f8afa0/run.json) | Same as 1: the built-in is dropped, and nothing in the reply says which registries were skipped. |
| 4 | **Empty "configured" list before init.** The "No components.json found" reply is never reached. Tool descriptions point to `init_project`, which does not exist. | [step-6.png](proof/you-connect-your-agent/2026-11-25-2017-aca75273/step-6.png), [step-7.png](proof/you-connect-your-agent/2026-11-25-2017-aca75273/step-7.png), [run](proof/you-connect-your-agent/2026-11-25-2017-aca75273/run.json) | [Without components.json, `getRegistriesConfig` returns `{}`](https://github.com/shadcn-ui/ui/blob/d24297f0208925d2a5efafbb29c3f293a9eb368f/packages/registry/src/registry/api.ts#L241-L243). [The check is `!config?.registries`](https://github.com/shadcn-ui/ui/blob/d24297f0208925d2a5efafbb29c3f293a9eb368f/packages/shadcn/src/mcp/index.ts#L158-L166), and `{}` passes it. [The descriptions name `init_project`](https://github.com/shadcn-ui/ui/blob/d24297f0208925d2a5efafbb29c3f293a9eb368f/packages/shadcn/src/mcp/index.ts#L152). |
| 5 | **Codex setup is manual.** `shadcn mcp init --client codex` prints steps and pins `shadcn@latest`. | [step-2.png](proof/you-connect-your-agent/2026-11-25-2017-aca75273/step-2.png), [run](proof/you-connect-your-agent/2026-11-25-2017-aca75273/run.json) | [The `codex` branch prints steps and exits](https://github.com/shadcn-ui/ui/blob/d24297f0208925d2a5efafbb29c3f293a9eb368f/packages/shadcn/src/commands/mcp.ts#L159-L197) instead of writing the file. [`SHADCN_MCP_VERSION` is `"latest"`](https://github.com/shadcn-ui/ui/blob/d24297f0208925d2a5efafbb29c3f293a9eb368f/packages/shadcn/src/commands/mcp.ts#L20). |
| 6 | **The person gets no add command.** Codex named three date pickers but did not pass on the add command the server gave it. | [step-3.png](proof/agent-finds-a-component/2026-11-25-2031-8c625346/step-3.png), [codex-session.jsonl](proof/agent-finds-a-component/2026-11-25-2031-8c625346/codex-session.jsonl) | Codex's answer, not shadcn's code. The server's reply had `Add command:` for each item. |
| 7 | **Setup choices without asking.** Codex picked Radix, Nova, Tailwind and tsconfig changes for the person, and credited the MCP server for work the CLI did. | [step-4.png](proof/you-connect-your-agent/2026-11-25-2017-aca75273/step-4.png), [codex-session.jsonl](proof/you-connect-your-agent/2026-11-25-2017-aca75273/codex-session.jsonl), [you.webm](proof/you-connect-your-agent/2026-11-25-2017-aca75273/you.webm) | Codex's behavior. The server gave no hint that shadcn was not set up (finding 4), so nothing told Codex to stop and ask. |

Findings 1 to 5 are in shadcn's code. 6 and 7 are about the agent, kept because the person behind the agent sees them.

## Draft upstream issue and fix (not filed)

[upstream/issue-draft.md](upstream/issue-draft.md) is a draft issue for shadcn-ui/ui, for review before anything is filed. Its fix, [upstream/fix.diff](upstream/fix.diff), changes only `packages/shadcn/src/mcp/index.ts`: a call that names no registry covers every registry `get_project_registries` lists, the empty-config check counts keys, and the descriptions say `npx shadcn@latest init`. With it applied, shadcn's own tests and typecheck pass, and [after-fix.txt](upstream/after-fix.txt) shows the same three calls fixed.

## Details

| Journey | What we tried | Kept proof |
|---|---|---|
| [Ask your agent what shadcn has for you](journeys/agent-finds-a-component.journey.yaml) | New shadcn app. Ask Codex which registries are set up and to find a date picker. | [Run](proof/agent-finds-a-component/2026-11-25-2031-8c625346/run.json) · [Codex log](proof/agent-finds-a-component/2026-11-25-2031-8c625346/codex-session.jsonl) · [Video](proof/agent-finds-a-component/2026-11-25-2031-8c625346/agent.webm) · [Findings](proof/agent-finds-a-component/2026-11-25-2031-8c625346/findings.json) |
| [Add a shadcn component when you have two registries](journeys/agent-adds-from-two-registries.journey.yaml) | `@magicui` added. Ask Codex to add an accordion. | [Run](proof/agent-adds-from-two-registries/2026-11-25-2019-17f8afa0/run.json) · [Codex log](proof/agent-adds-from-two-registries/2026-11-25-2019-17f8afa0/codex-session.jsonl) · [Agent video](proof/agent-adds-from-two-registries/2026-11-25-2019-17f8afa0/agent.webm) · [Your video](proof/agent-adds-from-two-registries/2026-11-25-2019-17f8afa0/you.webm) · [Findings](proof/agent-adds-from-two-registries/2026-11-25-2019-17f8afa0/findings.json) |
| [Connect your agent to shadcn and add a button](journeys/you-connect-your-agent.journey.yaml) | Plain Vite app. Run `shadcn mcp init --client codex`, follow it, ask Codex for a button. | [Run](proof/you-connect-your-agent/2026-11-25-2017-aca75273/run.json) · [Codex log](proof/you-connect-your-agent/2026-11-25-2017-aca75273/codex-session.jsonl) · [Agent video](proof/you-connect-your-agent/2026-11-25-2017-aca75273/agent.webm) · [Your video](proof/you-connect-your-agent/2026-11-25-2017-aca75273/you.webm) · [Findings](proof/you-connect-your-agent/2026-11-25-2017-aca75273/findings.json) |

All 3 runs are marked failed. Each failure is a check that the product broke: the agent seat (findings 1, 3, 4) or the person's seat (finding 6). The proven checks are listed in each `run.json`.

**Why keep it here?** It is a runnable JourneysFirst example that keeps what each seat saw, not just what a tool returned. Each journey is a brand-new user in a fresh copy of a new app. The agent is Codex (codex-cli 0.172.0), run with `codex exec`, its own settings folder, and only the shadcn MCP server. The last step of journeys 1 and 2 calls the same server directly, so the finding does not depend on what Codex chose to do. Devin played the person.

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

`e2e/agent.js` copies a template per run into `~/work/jf-work/`, gives Codex a fresh `CODEX_HOME` with only `auth.json`, and starts that copy's Vite server on 5301 to 5303. Codex runs with `--dangerously-bypass-approvals-and-sandbox`, so run it only in a throwaway machine. To look at a run, use `npx journeysfirst review journey-runs` and open `http://127.0.0.1:4400`.

`proof/` keeps each run folder as written (home paths shown as `~`): `run.json`, a screenshot per step, each user's video, `trace.zip`, `codex-session.jsonl` (Codex's own event log) and `findings.json`.

An earlier run of the two-registry journey (not kept) failed `searches-shadcn-too` because the check read only MCP calls, and that time Codex searched with `shadcn search @shadcn @magicui`. The check now counts both.

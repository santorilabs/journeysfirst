# Journeys

**What it is:** A new Vite app made with `npx shadcn@4.23.1 init`, used to check how shadcn's MCP server (shipped in the `shadcn` package, 4.23.1) onboards a coding agent and the person using it. (`components.json`, `src/`)
**Stage:** A sandbox for an outside evaluation, not a product. (Santori Labs)

## Foundation

What good means here. Every journey skill reads this first.

### Product principles

| User | Person or agent | Comes in by | Came to | Would notice first |
|---|---|---|---|---|
| You, the developer | person | a terminal and a browser on localhost | connect an agent to shadcn and get components into the app | a component that is missing from the page |
| The agent (Codex) | agent | the shadcn MCP server over stdio, run by `codex exec` | find and add components from the project's registries | a server reply that contradicts an earlier one |

**What good means.** Each line can fail. A journey checks it, or a review cites it.

- The registries `get_project_registries` lists are the ones a search covers when no registry is named. (the server's own comment, "When registries are omitted, search every configured registry", `packages/shadcn/src/mcp/index.ts`)
- A new shadcn project can find and add the shadcn registry's components through the MCP server. (shadcn MCP docs)
- Before shadcn is set up, the server says so, instead of listing nothing. (the server's own "No components.json found" reply, `packages/shadcn/src/mcp/index.ts`)
- `shadcn mcp init` tells a person exactly what to do to connect their agent. (shadcn MCP docs)

### UX principles

None written by shadcn for the MCP server. A review uses the lines above.

**Decided.** None yet.

### Brand

| What | Where |
|---|---|
| Name, logo, colors, type | shadcn's own, not checked here |

### Design system

| What | Where |
|---|---|
| Components | shadcn/ui, style radix-nova (`components.json`) |

## Journeys

- In a new shadcn project, your agent can tell you which registries are set up and find a component in them. (`agent-finds-a-component.journey.yaml`, script in `e2e/`)
- With a second registry set up, your agent can still add a shadcn component to your page. (`agent-adds-from-two-registries.journey.yaml`, script in `e2e/`)
- You can connect your coding agent to shadcn's MCP server, and it adds a shadcn button to your app. (`you-connect-your-agent.journey.yaml`, script in `e2e/`)

## Running safely

- Each journey copies a fresh app from `~/work/templates/` into `~/work/jf-work/` and starts that copy's Vite dev server on its own port (5301 to 5303). Nothing is shared between runs.
- Codex gets its own settings folder per run (`CODEX_HOME`), with only the login copied in. Its API key is never written to the app or the run.
- The registries are public (ui.shadcn.com, magicui.design). Nothing is sent anywhere except registry reads and the model calls.
- Run: `npx playwright test`. Runs land in `journey-runs/<journey>/<run id>/`.

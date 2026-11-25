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

## Running safely

Run in isolated scratch projects with separate fresh home directories, no login or deploy keys, and a read-only sample query. The terminal and stdio client are the only interfaces exercised; no browser or shared deployment is needed. See the top-level README for commands.

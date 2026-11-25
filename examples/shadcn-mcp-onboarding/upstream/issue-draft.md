# Draft issue for shadcn-ui/ui (not filed)

This is a draft. Nothing has been filed upstream. Review it before it goes to https://github.com/shadcn-ui/ui/issues. The example link below works once [PR #22](https://github.com/santorilabs/journeysfirst/pull/22) merges.

---

**Title:** MCP: `get_project_registries` lists @shadcn, but searches that name no registry leave it out

**Package:** `shadcn@4.23.1` (`npx shadcn@4.23.1 mcp`)

### What happens

In a new project made with `shadcn init` (`"registries": {}` in components.json):

1. `get_project_registries` replies `- @shadcn`.
2. `search_items_in_registries {"query":"date-picker"}` replies "No registries are configured. Add registries to components.json (use get_project_registries to inspect) or pass them explicitly."
3. `list_items_in_registries {}` gives the same reply.

With a second registry (for example `@magicui`) in components.json, the same search covers only `@magicui` and does not say it skipped `@shadcn`. A search for "accordion" returns 7 Magic UI items and no shadcn accordion.

In a folder with no components.json, `get_project_registries` replies "The following registries are configured in the current project:" and an empty list. The tool descriptions say to use `init_project`, which is not one of the server's tools.

### Why it matters

An agent that calls `get_project_registries` first, then searches without naming a registry (what the search tool's description invites), is told nothing is set up. We ran this with Codex (codex-cli 0.172.0). In 1 of 10 tries its first search hit this and it retried with `registries: ["@shadcn"]`. In the other 9 it named `@shadcn` itself. Runs, screenshots and Codex's own logs: https://github.com/santorilabs/journeysfirst/tree/main/examples/shadcn-mcp-onboarding

### Cause

- [`getRegistriesConfig`](https://github.com/shadcn-ui/ui/blob/d24297f0208925d2a5efafbb29c3f293a9eb368f/packages/registry/src/registry/api.ts#L232-L238) merges `BUILTIN_REGISTRIES` into the project's registries, so `get_project_registries` lists `@shadcn`.
- [`resolveSearchRegistries`](https://github.com/shadcn-ui/ui/blob/d24297f0208925d2a5efafbb29c3f293a9eb368f/packages/registry/src/registry/search.ts#L19-L35) drops built-in registries when none are named. That is the intended CLI rule ("search all means the registries the user actually configured"), but the MCP tools ([search](https://github.com/shadcn-ui/ui/blob/d24297f0208925d2a5efafbb29c3f293a9eb368f/packages/shadcn/src/mcp/index.ts#L262-L265) and list) share it, while their listing tool shows the built-ins.
- Without components.json, `getRegistriesConfig` [returns `{}`](https://github.com/shadcn-ui/ui/blob/d24297f0208925d2a5efafbb29c3f293a9eb368f/packages/registry/src/registry/api.ts#L241-L243), so [`if (!config?.registries)`](https://github.com/shadcn-ui/ui/blob/d24297f0208925d2a5efafbb29c3f293a9eb368f/packages/shadcn/src/mcp/index.ts#L158) is false and the "No components.json found" reply is never sent.

### Suggested fix

Only `packages/shadcn/src/mcp/index.ts` changes. The CLI keeps its "search all" rule.

- When a tool call names no registry, use every registry `get_project_registries` lists, built-ins included.
- Count keys in the empty-config check, so a folder with no components.json gets the existing "No components.json found" reply.
- Replace `init_project` in the two tool descriptions with `npx shadcn@latest init`.

```diff
diff --git a/packages/shadcn/src/mcp/index.ts b/packages/shadcn/src/mcp/index.ts
index 169149a..e8af065 100644
--- a/packages/shadcn/src/mcp/index.ts
+++ b/packages/shadcn/src/mcp/index.ts
@@ -6,10 +6,7 @@ import {
 import { getRegistryItems, searchRegistries } from "@shadcn/registry"
 import { withRegistryContext } from "@shadcn/registry/internal/registry/context"
 import { RegistryError } from "@shadcn/registry/internal/registry/errors"
-import {
-  resolveSearchRegistries,
-  SEARCHABLE_TYPES,
-} from "@shadcn/registry/internal/registry/search"
+import { SEARCHABLE_TYPES } from "@shadcn/registry/internal/registry/search"
 import dedent from "dedent"
 import { z } from "zod"
 
@@ -111,6 +108,15 @@ function formatToolError(error: unknown): CallToolResult {
   return errorResult(dedent`Error: ${errorMessage}`)
 }
 
+// get_project_registries lists the builtin registries, so a call that names
+// no registry covers them too. The CLI's "search all" keeps its own rule.
+function resolveMcpRegistries(
+  registries: string[] | undefined,
+  config: Awaited<ReturnType<typeof getMcpConfig>>
+) {
+  return registries?.length ? registries : Object.keys(config.registries ?? {})
+}
+
 const NO_REGISTRIES_MESSAGE = dedent`No registries are configured. Add registries to components.json (use get_project_registries to inspect) or pass them explicitly.`
 
 const listRegistriesField = z
@@ -149,13 +155,13 @@ function registerTools(server: McpServer) {
     "get_project_registries",
     {
       description:
-        "Get configured registry names from components.json - Returns error if no components.json exists (use init_project to create one)",
+        "Get configured registry names from components.json - Returns an error if no components.json exists (run `npx shadcn@latest init` to create one)",
       inputSchema: z.object({}),
     },
     registryTool(async () => {
       const config = await getMcpConfig(process.cwd())
 
-      if (!config?.registries) {
+      if (!Object.keys(config?.registries ?? {}).length) {
         return textResult(dedent`No components.json found or no registries configured.
 
           To fix this:
@@ -185,7 +191,7 @@ function registerTools(server: McpServer) {
     "list_items_in_registries",
     {
       description:
-        "List items from registries (requires components.json - use init_project if missing)",
+        "List items from registries (requires components.json - run `npx shadcn@latest init` if missing)",
       inputSchema: z.object({
         registries: listRegistriesField,
         types: typesField,
@@ -202,7 +208,7 @@ function registerTools(server: McpServer) {
       const config = await getMcpConfig(process.cwd())
 
       const listAll = !args.registries?.length
-      const registries = resolveSearchRegistries(args.registries ?? [], config)
+      const registries = resolveMcpRegistries(args.registries, config)
 
       if (registries.length === 0) {
         return textResult(NO_REGISTRIES_MESSAGE)
@@ -262,7 +268,7 @@ function registerTools(server: McpServer) {
       // When registries are omitted, search every configured registry and
       // tolerate individual failures.
       const searchAll = !args.registries?.length
-      const registries = resolveSearchRegistries(args.registries ?? [], config)
+      const registries = resolveMcpRegistries(args.registries, config)
 
       if (registries.length === 0) {
         return textResult(NO_REGISTRIES_MESSAGE)
@@ -350,7 +356,7 @@ function registerTools(server: McpServer) {
       const config = await getMcpConfig()
 
       const searchAll = !args.registries?.length
-      const registries = resolveSearchRegistries(args.registries ?? [], config)
+      const registries = resolveMcpRegistries(args.registries, config)
 
       if (registries.length === 0) {
         return textResult(NO_REGISTRIES_MESSAGE)
```

With this applied to tag `shadcn@4.23.1`, `vitest run src/mcp` (27 tests) in packages/shadcn, `vitest run src/registry/search.test.ts` (57 tests) in packages/registry, and `tsc --noEmit` in packages/shadcn pass. The same three calls then search `@shadcn` in a new app, search both registries with `@magicui` added, and send the "No components.json found" reply before init.

If you would rather keep the MCP and CLI rules shared, the other option is to keep the rule and say it: have `get_project_registries` mark `@shadcn` as built-in and not searched by default, and have the empty-search reply say "pass registries: [\"@shadcn\"]" instead of "Add registries to components.json".

A follow-up worth a separate issue: `shadcn mcp init --client codex` prints manual steps and pins `shadcn@latest` ([commands/mcp.ts](https://github.com/shadcn-ui/ui/blob/d24297f0208925d2a5efafbb29c3f293a9eb368f/packages/shadcn/src/commands/mcp.ts#L159-L197)), while the other clients get their config file written.

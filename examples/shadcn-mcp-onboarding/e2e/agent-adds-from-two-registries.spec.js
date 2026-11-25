// "Add a shadcn component when you have two registries", with Codex as the agent.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "journeysfirst/playwright";
import { addCodexConfig, askCodex, callServer, mcpCalls, shadcnServerToml, startApp, textOf, workspace, writeSessionPage } from "./agent.js";

const PROMPT = "Find an accordion in the shadcn registries this project has set up, and add it to the home page.";

test.journey("journeys/agent-adds-from-two-registries.journey.yaml", { measure: "wide" }, async ({ journey }) => {
  const ws = workspace("agent-adds-from-two-registries", "shadcn");
  const cfgPath = join(ws.app, "components.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  cfg.registries = { "@magicui": "https://magicui.design/r/{name}.json" };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  addCodexConfig(ws.codexHome, shadcnServerToml());
  let session;
  let direct;
  let app;

  await journey.step("You ask your agent to find an accordion in the registries the project has set up and add it to the home page.", { by: "you", caption: "You ask Codex to add an accordion from your registries." }, async () => {
    session = askCodex(ws, PROMPT);
    journey.recorder.attach({ name: "codex-session.jsonl", body: session.jsonl, kind: "capture", tags: { user: "agent" } });
    app = await startApp(ws.app, 5302);
  });

  const page = writeSessionPage(ws.app, "codex-session.html", { title: "Codex session: add an accordion", prompt: PROMPT, items: session.items });
  const agent = await journey.page("agent", { account: "Codex with the shadcn MCP server" });
  await agent.goto(app.url + page);

  await journey.check("searches-shadcn-too", { by: "agent", caption: "Checking that Codex searched the shadcn registry too." }, async () => {
    const searches = mcpCalls(session).filter((c) => c.tool === "search_items_in_registries" || c.tool === "list_items_in_registries");
    // Codex may search with the shadcn CLI instead of the MCP tool. Both count.
    const cliSearches = session.items.filter((i) => i.type === "command_execution" && /shadcn(@\S+)? search[^\n]*@shadcn/.test(i.command));
    const hitShadcn = searches.some((c) => /in registries[^\n]*@shadcn/.test(textOf(c))) || cliSearches.length > 0;
    return {
      passed: hitShadcn,
      proof: "Read which registries each of Codex's searches covered: the MCP server's replies and any shadcn search command it ran.",
      evidence: [
        { source: "log", login: "agent", query: "codex-session.jsonl: mcp_tool_call search_items_in_registries", got: searches.map((c) => ({ arguments: c.arguments, reply: textOf(c).split("\n")[0] })) },
        { source: "log", login: "agent", query: "codex-session.jsonl: command_execution shadcn search", got: cliSearches.map((i) => i.command) },
        { source: "page", login: "agent", url: agent.url(), saw: "Codex's searches and the server's replies" },
      ],
      reason: "No search Codex made covered @shadcn.",
    };
  });

  const you = await journey.page("you", { account: "the app's own browser, no login" });

  await journey.check("accordion-on-page", { by: "you", caption: "Checking the home page for an accordion that opens." }, async () => {
    await you.goto(app.url + "/");
    const trigger = you.locator('[data-slot="accordion-trigger"]').first();
    const found = (await trigger.count()) > 0;
    let opened = false;
    if (found) {
      await trigger.click();
      opened = (await trigger.getAttribute("aria-expanded")) === "true";
    }
    return {
      passed: found && opened,
      proof: "Opened the home page, clicked the first accordion header, and read whether it opened.",
      evidence: [{ source: "page", login: "you", url: you.url(), saw: found ? `an accordion; after a click aria-expanded is ${opened}` : "no accordion on the page" }],
      reason: found ? "The accordion did not open." : "There is no accordion on the home page.",
    };
  });

  await journey.step("The agent asks the same MCP server to search the project's registries for an accordion without naming a registry.", { by: "agent", caption: "The same server is asked to search without naming a registry." }, async () => {
    direct = await callServer(ws.app, [["get_project_registries", {}], ["search_items_in_registries", { query: "accordion" }]]);
    const page2 = writeSessionPage(ws.app, "server-search.html", { title: "Same shadcn MCP server: search without naming a registry", direct });
    await agent.goto(app.url + page2);
  });

  await journey.check("search-includes-shadcn", { by: "agent", caption: "Checking that the search includes the shadcn registry." }, async () => {
    const [list, search] = direct;
    const included = /in registries[^\n]*@shadcn/.test(search.text);
    return {
      passed: included,
      proof: "Asked the server which registries are set up, then searched without naming one, from the same app folder.",
      evidence: [
        { source: "page", login: "agent", url: agent.url(), saw: search.text.slice(0, 300) },
        { source: "log", login: "agent", query: "MCP get_project_registries then search_items_in_registries {query: 'accordion'}", got: { listed: list.text.slice(0, 140), search: search.text.slice(0, 200) } },
      ],
      reason: `The server lists @shadcn and @magicui, but the search said: "${search.text.split("\n")[0]}"`,
      caption: included ? "the search includes @shadcn." : "the search skips @shadcn without saying so.",
    };
  });

  app.stop();
});

// "Ask your agent what shadcn has for you", with Codex as the agent.
import { test } from "journeysfirst/playwright";
import { addCodexConfig, answer, askCodex, callServer, mcpCalls, shadcnServerToml, startApp, textOf, workspace, writeSessionPage } from "./agent.js";

const PROMPT = "Which shadcn registries does this project have set up? Search them for a date picker.";

test.journey("journeys/agent-finds-a-component.journey.yaml", { measure: "wide" }, async ({ journey }) => {
  const ws = workspace("agent-finds-a-component", "shadcn");
  addCodexConfig(ws.codexHome, shadcnServerToml());
  let session;
  let direct;
  let app;

  await journey.step("You ask your agent which shadcn registries the project has set up, and to search them for a date picker.", { by: "you", caption: "You ask Codex which registries are set up and to find a date picker." }, async () => {
    session = askCodex(ws, PROMPT);
    journey.recorder.attach({ name: "codex-session.jsonl", body: session.jsonl, kind: "capture", tags: { user: "agent" } });
    app = await startApp(ws.app, 5301);
  });

  const listed = mcpCalls(session).find((c) => c.tool === "get_project_registries");
  const listedText = listed ? textOf(listed) : "";
  const page = writeSessionPage(ws.app, "codex-session.html", { title: "Codex session: which registries are set up?", prompt: PROMPT, items: session.items });
  const agent = await journey.page("agent", { account: "Codex with the shadcn MCP server" });
  await agent.goto(app.url + page);

  await journey.check("names-shadcn-registry", { by: "agent", caption: "Checking that Codex names the shadcn registry." }, async () => {
    const said = answer(session);
    return {
      passed: /@shadcn/.test(said),
      proof: "Read Codex's final answer and the get_project_registries reply it got.",
      evidence: [
        { source: "page", login: "agent", url: agent.url(), saw: said.slice(0, 400) },
        { source: "log", login: "agent", query: "codex-session.jsonl: mcp_tool_call get_project_registries", got: listedText.slice(0, 300) },
      ],
      reason: "Codex's answer does not name @shadcn.",
    };
  });

  await journey.check("finds-date-picker", { by: "agent", caption: "Checking that Codex finds a date picker with its add command." }, async () => {
    const said = answer(session);
    const searches = mcpCalls(session).filter((c) => c.tool === "search_items_in_registries");
    return {
      // The person only sees Codex's answer, so the add command must be in it.
      passed: /@shadcn\/date-picker/.test(said) && /shadcn(@\S+)? add @shadcn\/date-picker/.test(said),
      proof: "Read Codex's answer for a date picker and the command to add it, and the searches it made.",
      evidence: [
        { source: "log", login: "agent", query: "codex-session.jsonl: mcp_tool_call search_items_in_registries", got: searches.map((c) => ({ arguments: c.arguments, reply: textOf(c).slice(0, 250) })) },
        { source: "page", login: "agent", url: agent.url(), saw: said.slice(0, 400) },
      ],
      reason: /@shadcn\/date-picker/.test(said) ? "Codex named shadcn date pickers but did not give you the command to add one." : "Codex found no shadcn date picker.",
    };
  });

  await journey.step("The agent asks the same MCP server to search the project's registries for a date picker without naming a registry.", { by: "agent", caption: "The same server is asked to search without naming a registry." }, async () => {
    direct = await callServer(ws.app, [["get_project_registries", {}], ["search_items_in_registries", { query: "date picker" }]]);
    const page2 = writeSessionPage(ws.app, "server-search.html", { title: "Same shadcn MCP server: search without naming a registry", direct });
    await agent.goto(app.url + page2);
  });

  await journey.check("search-covers-listed-registries", { by: "agent", caption: "Checking that the search covers the registries the server listed." }, async () => {
    const [list, search] = direct;
    const covered = !/No registries are configured/.test(search.text) && /@shadcn/.test(search.text);
    return {
      passed: covered,
      proof: "Asked the server which registries are set up, then searched without naming one, from the same app folder.",
      evidence: [
        { source: "page", login: "agent", url: agent.url(), saw: search.text.slice(0, 300) },
        { source: "log", login: "agent", query: "MCP get_project_registries then search_items_in_registries {query: 'date picker'}", got: { listed: list.text.slice(0, 120), search: search.text.slice(0, 200) } },
      ],
      reason: `The server lists @shadcn as set up, but the search said: "${search.text.split("\n")[0]}"`,
      caption: covered ? "the search covers @shadcn." : "the server lists @shadcn, then says no registries are configured.",
    };
  });

  app.stop();
});

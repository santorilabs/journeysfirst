// "Connect your agent to shadcn and add a button": a person sets up the shadcn
// MCP server for Codex from what shadcn prints, then Codex adds a button.
import { execFileSync } from "node:child_process";
import { test } from "journeysfirst/playwright";
import { SHADCN, addCodexConfig, askCodex, callServer, mcpCalls, startApp, workspace, writeSessionPage } from "./agent.js";

const PROMPT = "Use the shadcn MCP server to add a button component to this app.";
const SETUP = `npx -y ${SHADCN} mcp init --client codex`;

test.journey("journeys/you-connect-your-agent.journey.yaml", { measure: "wide" }, async ({ journey }) => {
  const ws = workspace("you-connect-your-agent", "plain");
  let printed = "";
  let toml = "";
  let session;
  let direct;
  let app = await startApp(ws.app, 5303);
  const you = await journey.page("you", { account: "your own terminal and browser, no login" });

  await journey.step("You run shadcn's MCP setup for Codex and follow what it prints.", { by: "you", caption: "You run shadcn mcp init for Codex and copy what it prints." }, async () => {
    printed = execFileSync("npx", ["-y", SHADCN, "mcp", "init", "--client", "codex"], { cwd: ws.app, env: { ...process.env, CODEX_HOME: ws.codexHome, NO_COLOR: "1", FORCE_COLOR: "0" }, timeout: 5 * 60 * 1000 })
      .toString()
      .replace(/\x1b\[[0-9;]*m/g, "");
    const block = printed.match(/\[mcp_servers\.shadcn\][\s\S]*?args = \[[^\]]*\]/);
    toml = block ? block[0] + "\n" : "";
    // Step 1 of what it prints: open ~/.codex/config.toml (this run's Codex folder). Step 2: add the block.
    if (toml) addCodexConfig(ws.codexHome, toml);
    const page = writeSessionPage(ws.app, "setup.html", { title: "You: shadcn MCP setup for Codex", terminal: { command: SETUP, output: printed } });
    await you.goto(app.url + page);
  });

  await journey.check("setup-says-what-to-add", { by: "you", caption: "Checking that the setup says what to add to Codex." }, async () => ({
    passed: Boolean(toml) && /config\.toml/.test(printed),
    proof: "Read what the setup printed and copied its block into Codex's settings file.",
    evidence: [
      { source: "page", login: "you", url: you.url(), saw: printed.trim().slice(-500) },
      { source: "log", login: "you", query: SETUP, got: { block: toml } },
    ],
    reason: "The setup did not print a block for Codex's config.toml.",
  }));

  await journey.step("You ask your agent to use the shadcn MCP server to add a button to the app.", { by: "you", caption: "You ask Codex to add a button with the shadcn MCP server." }, async () => {
    app.stop();
    session = askCodex(ws, PROMPT);
    journey.recorder.attach({ name: "codex-session.jsonl", body: session.jsonl, kind: "capture", tags: { user: "agent" } });
    app = await startApp(ws.app, 5303);
  });

  const page = writeSessionPage(ws.app, "codex-session.html", { title: "Codex session: add a button", prompt: PROMPT, items: session.items });
  const agent = await journey.page("agent", { account: "Codex with the shadcn MCP server" });
  await agent.goto(app.url + page);

  await journey.check("agent-uses-server", { by: "agent", caption: "Checking that Codex called the shadcn MCP server." }, async () => {
    const calls = mcpCalls(session);
    return {
      passed: calls.some((c) => c.server === "shadcn"),
      proof: "Read the MCP tool calls in Codex's session.",
      evidence: [
        { source: "log", login: "agent", query: "codex-session.jsonl: mcp_tool_call", got: calls.map((c) => ({ server: c.server, tool: c.tool, arguments: c.arguments })) },
        { source: "page", login: "agent", url: agent.url(), saw: "Codex's MCP calls to shadcn" },
      ],
      reason: "Codex made no call to the shadcn MCP server.",
    };
  });

  await journey.check("button-on-page", { by: "you", caption: "Checking the home page for a shadcn button." }, async () => {
    await you.goto(app.url + "/");
    const button = you.locator('[data-slot="button"]').first();
    const found = (await button.count()) > 0;
    const label = found ? (await button.textContent())?.trim() : "";
    return {
      passed: found,
      proof: "Opened the home page and looked for a shadcn button (data-slot=button).",
      evidence: [{ source: "page", login: "you", url: you.url(), saw: found ? `a shadcn button labeled "${label}"` : "no shadcn button" }],
      reason: "There is no shadcn button on the home page.",
    };
  });

  await journey.step("Before shadcn is set up in a second copy of the app, the agent asks the MCP server which registries are set up.", { by: "agent", caption: "In a fresh copy without shadcn, the server is asked which registries are set up." }, async () => {
    const fresh = workspace("you-connect-your-agent-fresh", "plain");
    direct = await callServer(fresh.app, [["get_project_registries", {}]]);
    const page2 = writeSessionPage(ws.app, "server-before-init.html", { title: "Same shadcn MCP server, app without shadcn yet", direct });
    await agent.goto(app.url + page2);
  });

  await journey.check("says-not-set-up", { by: "agent", caption: "Checking that the server says shadcn is not set up yet." }, async () => {
    const text = direct[0].text;
    const listsNothing = /registries are configured[^-]*You can view/s.test(text);
    const told = /components\.json|not set up|init/i.test(text) && !listsNothing;
    return {
      passed: told,
      proof: "Called get_project_registries from an app folder with no components.json.",
      evidence: [
        { source: "page", login: "agent", url: agent.url(), saw: text.slice(0, 300) },
        { source: "log", login: "agent", query: "MCP get_project_registries in an app without components.json", got: text.slice(0, 300) },
      ],
      reason: "The server says \"The following registries are configured in the current project:\" and lists nothing.",
      caption: told ? "the server says to set up shadcn first." : "the server says registries are configured, then lists none.",
    };
  });

  app.stop();
});

// Helpers for journeys where Codex is the agent: a fresh copy of an app per
// run, a Codex settings folder per run, the dev server, and a page that shows
// what the agent did, so the agent's own session is on screen and in the video.
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export const SHADCN = "shadcn@4.23.1";
const WORK = process.env.JOURNEYS_WORK ?? join(homedir(), "work", "jf-work");
const TEMPLATES = { shadcn: join(homedir(), "work", "templates", "shadcn-app"), plain: join(homedir(), "work", "templates", "plain-vite") };

/** A fresh copy of a template app and an empty Codex settings folder. */
export function workspace(name, template) {
  const dir = join(WORK, `${name}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const app = join(dir, "app");
  cpSync(TEMPLATES[template], app, { recursive: true });
  const codexHome = join(dir, "codex-home");
  mkdirSync(codexHome);
  // Only the login. No MCP servers until the journey adds them.
  cpSync(join(homedir(), ".codex", "auth.json"), join(codexHome, "auth.json"));
  return { dir, app, codexHome };
}

export function addCodexConfig(codexHome, toml) {
  writeFileSync(join(codexHome, "config.toml"), toml);
}

export function shadcnServerToml(version = SHADCN) {
  return `[mcp_servers.shadcn]\ncommand = "npx"\nargs = ["-y", "${version}", "mcp"]\n`;
}

/** Run Codex once with a prompt, as a person would with `codex exec`. */
export function askCodex({ app, codexHome }, prompt) {
  const out = execFileSync(
    "codex",
    ["exec", "--json", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox", prompt],
    { cwd: app, env: { ...process.env, CODEX_HOME: codexHome }, maxBuffer: 64 * 1024 * 1024, timeout: 8 * 60 * 1000, stdio: ["ignore", "pipe", "ignore"] },
  ).toString();
  const items = out
    .split("\n")
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e?.type === "item.completed")
    .map((e) => e.item);
  return { jsonl: out, items, prompt };
}

export const mcpCalls = (session) => session.items.filter((i) => i.type === "mcp_tool_call");
export const answer = (session) => session.items.filter((i) => i.type === "agent_message").at(-1)?.text ?? "";
export const textOf = (call) => (call.result?.content ?? []).map((c) => c.text).join("\n");

/** Call the shadcn MCP server the way the agent's MCP client does, from the app's folder. */
export async function callServer(app, calls) {
  const transport = new StdioClientTransport({ command: "npx", args: ["-y", SHADCN, "mcp"], cwd: app, stderr: "ignore" });
  const client = new Client({ name: "journey-agent", version: "1" });
  await client.connect(transport);
  const results = [];
  for (const [tool, args] of calls) {
    const r = await client.callTool({ name: tool, arguments: args });
    results.push({ tool, arguments: args, isError: !!r.isError, text: r.content.map((c) => c.text).join("\n") });
  }
  await client.close();
  return results;
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const clip = (s, n = 1400) => (s.length > n ? s.slice(0, n) + "\n…" : s);

/** Write a page into the app's public folder that shows a session, and return its path. */
export function writeSessionPage(app, file, { title, prompt, items = [], direct = [], terminal = null }) {
  const rows = [];
  if (terminal) rows.push(`<div class="cmd"><b>$ ${esc(terminal.command)}</b><pre>${esc(clip(terminal.output, 4000))}</pre></div>`);
  if (prompt) rows.push(`<div class="you"><b>You</b><pre>${esc(prompt)}</pre></div>`);
  for (const i of items) {
    if (i.type === "agent_message") rows.push(`<div class="agent"><b>Codex</b><pre>${esc(i.text)}</pre></div>`);
    else if (i.type === "mcp_tool_call")
      rows.push(`<div class="mcp"><b>MCP shadcn.${esc(i.tool)}</b> <code>${esc(JSON.stringify(i.arguments))}</code><pre>${esc(clip(textOf(i)))}</pre></div>`);
    else if (i.type === "command_execution") rows.push(`<div class="cmd"><b>$</b> <code>${esc(clip(i.command, 300))}</code></div>`);
  }
  for (const d of direct)
    rows.push(`<div class="mcp probe"><b>MCP shadcn.${esc(d.tool)}</b> <code>${esc(JSON.stringify(d.arguments))}</code><pre>${esc(clip(d.text))}</pre></div>`);
  const html = `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font:14px/1.45 ui-sans-serif,system-ui;margin:24px auto;max-width:860px;padding:0 16px;color:#111}
h1{font-size:18px} div{border:1px solid #ddd;border-radius:10px;padding:10px 12px;margin:10px 0}
.you{background:#eef4ff}.agent{background:#f4fff0}.mcp{background:#fff8e6}.probe{border-color:#c77}.cmd{background:#f5f5f5}
pre{white-space:pre-wrap;margin:6px 0 0;font:12.5px/1.4 ui-monospace,monospace} code{font-size:12px}
</style><h1>${esc(title)}</h1><p>${esc(SHADCN)} MCP server, agent: Codex (codex exec).</p>${rows.join("\n")}`;
  mkdirSync(join(app, "public"), { recursive: true });
  writeFileSync(join(app, "public", file), html);
  return `/${file}`;
}

/** Start the app's Vite dev server on a port and wait for it. */
export async function startApp(app, port) {
  const server = spawn("npx", ["vite", "--port", String(port), "--strictPort"], { cwd: app, stdio: "ignore", detached: true });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(url)).ok) return { url, stop: () => process.kill(-server.pid) }; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  process.kill(-server.pid);
  throw new Error(`The app did not start on ${url}.`);
}

export function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

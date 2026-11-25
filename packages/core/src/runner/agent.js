import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { codex } from "./codex.js";

const adapters = [codex];

/** @param {string | undefined} name @param {string | undefined} container */
export function selectAdapter(name, container) {
  if (name) {
    const adapter = adapters.find((item) => item.name === name);
    if (!adapter) throw new Error(`Unknown agent "${name}". Use --agent ${adapters.map((item) => item.name).join(" or --agent ")}.`);
    return adapter;
  }
  const adapter = adapters.find((item) => item.detect(container) && item.authProbe());
  if (!adapter) throw new Error(`No signed-in agent CLI found. ${adapters.map((item) => item.setup).join(" ")}`);
  return adapter;
}

/** @param {string | undefined} file @param {string} project */
export function readMcpServers(file, project) {
  const path = file ?? join(project, ".mcp.json");
  if (!file) {
    try {
      if (!lstatSync(path).isFile()) throw new Error("Use a regular .mcp.json file in the test project, or pass --mcp.");
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return {};
      throw error;
    }
  }
  const config = JSON.parse(readFileSync(path, "utf8"));
  const servers = config?.mcpServers ?? (file ? config : null);
  if (!servers || Object.getPrototypeOf(servers) !== Object.prototype) {
    throw new Error("Put an object named mcpServers in .mcp.json, or pass --mcp with server names and command arrays.");
  }
  return Object.fromEntries(Object.entries(servers).map(([name, value]) => {
    const command = Array.isArray(value) && file ? value :
      value && (!value.type || value.type === "stdio") && !value.url && !value.env && Array.isArray(value.args ?? [])
        ? [value.command, ...(value.args ?? [])] : [];
    if (!/^[\w-]+$/.test(name) || !command.length || !command[0] || !command.every((part) => typeof part === "string")) {
      throw new Error(`MCP server "${name}" needs a stdio command and optional args, without env or a URL. Use a trusted test server.`);
    }
    return [name, command];
  }));
}

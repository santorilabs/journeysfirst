import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureCommand } from "./capture.js";

const [mode, name, ...args] = process.argv.slice(2);
const key = args[0] === "--key" ? args[1] : undefined;
const envVars = mode === "mcp-proxy" && args[0] === "--env-vars" ? args[1] : undefined;
const [separator, ...argv] = args.slice(key === undefined && envVars === undefined ? 0 : 2);
if (!["capture", "mcp-proxy"].includes(mode) || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.txt$/.test(name) ||
    separator !== "--" || (key !== undefined && !/^[A-Z_][A-Z0-9_]*$/.test(key)) ||
    (envVars !== undefined && !/^[A-Z_][A-Z0-9_]*(?:,[A-Z_][A-Z0-9_]*)*$/.test(envVars))) {
  console.error("Give capture NAME.txt [--key ENV_NAME] -- COMMAND [args...]");
  process.exitCode = 1;
} else {
  const state = dirname(fileURLToPath(import.meta.url));
  const mcp = mode === "mcp-proxy";
  let stopping;
  if (mcp) {
    process.once("SIGINT", () => { stopping = 130; });
    process.once("SIGTERM", () => { stopping = 143; });
  }
  try {
    const envNames = envVars?.split(",") ?? [];
    for (const name of envNames) {
      const forwarded = `JF_MCP_ENV_${name}`;
      if (process.env[forwarded] !== undefined) process.env[name] = process.env[forwarded];
      delete process.env[forwarded];
    }
    const actorKey = key ?? envNames.find((name) => process.env[name]);
    const identity = actorKey ? { key: actorKey } : { login: "you" };
    const secrets = [...envNames, ...(key ? [key] : [])].flatMap((name) => {
      const value = process.env[name];
      return value ? [value] : [];
    });
    process.exitCode = await captureCommand(argv, { out: join(state, "captures", name), mcp, identity, secrets,
      diagnostic: mcp ? join(state, name + ".stderr") : undefined });
  } catch {
    console.error("Could not record the command. Choose a new capture name and check the command.");
    process.exitCode = 1;
  }
  if (mcp && process.exitCode && process.exitCode !== stopping) {
    writeFileSync(join(state, name + ".exit"), String(process.exitCode), { flag: "wx", mode: 0o600 });
  }
}

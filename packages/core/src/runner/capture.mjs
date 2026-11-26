import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureCommand } from "./capture.js";

const [mode, name, ...args] = process.argv.slice(2);
const key = args[0] === "--key" ? args[1] : undefined;
const [separator, ...argv] = args.slice(key === undefined ? 0 : 2);
if (!["capture", "mcp-proxy"].includes(mode) || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.txt$/.test(name) ||
    separator !== "--" || (key !== undefined && !/^[A-Z_][A-Z0-9_]*$/.test(key))) {
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
    const identity = key ? { key } : { login: "you" };
    const secret = key && process.env[key];
    process.exitCode = await captureCommand(argv, { out: join(state, "captures", name), mcp, identity, secrets: secret ? [secret] : [] });
  } catch {
    console.error("Could not record the command. Choose a new capture name and check the command.");
    process.exitCode = 1;
  }
  if (mcp && process.exitCode && process.exitCode !== stopping) {
    writeFileSync(join(state, name + ".exit"), String(process.exitCode), { flag: "wx", mode: 0o600 });
  }
}

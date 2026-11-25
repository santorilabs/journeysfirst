import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureCommand } from "./capture.js";

const [mode, name, separator, ...argv] = process.argv.slice(2);
if (!["capture", "mcp-proxy"].includes(mode) || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.txt$/.test(name) || separator !== "--") {
  console.error("Give capture NAME.txt -- COMMAND [args...]");
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
    process.exitCode = await captureCommand(argv, { out: join(state, "captures", name), mcp });
  } catch {
    console.error("Could not record the command. Choose a new capture name and check the command.");
    process.exitCode = 1;
  }
  if (mcp && process.exitCode && process.exitCode !== stopping) {
    writeFileSync(join(state, name + ".exit"), String(process.exitCode), { flag: "wx", mode: 0o600 });
  }
}

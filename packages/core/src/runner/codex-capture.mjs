import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureCommand } from "./capture.js";

const [mode, name, separator, ...argv] = process.argv.slice(2);
if (!["capture", "mcp-proxy"].includes(mode) || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.txt$/.test(name) || separator !== "--") {
  console.error("Give capture NAME.txt -- COMMAND [args...]");
  process.exitCode = 1;
} else {
  try {
    process.exitCode = await captureCommand(argv, { out: join(dirname(fileURLToPath(import.meta.url)), "captures", name), mcp: mode === "mcp-proxy" });
  } catch {
    console.error("Could not record the command. Choose a new capture name and check the command.");
    process.exitCode = 1;
  }
}

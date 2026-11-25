import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { createInterface as createPrompt } from "node:readline/promises";
import { stripVTControlCharacters } from "node:util";
import { RunRecorder } from "journeysfirst/recorder";
import { understandsHandoff } from "./owner-assessment.mjs";

const role = process.argv[2];
if (!["agent", "human", "owner"].includes(role)) throw new Error("Use node capture.mjs agent|human|owner.");
if (!process.env.HOME || process.env.HOME === process.env.ORIGINAL_HOME) {
  throw new Error("Set HOME to an isolated scratch directory.");
}
for (const path of [".env", ".env.local", ".convex", process.env.HOME + "/.convex"]) {
  if (existsSync(path)) throw new Error("Use a fresh project and HOME for onboarding.");
}

const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TERM: "xterm",
  npm_config_update_notifier: "false",
};
const agentEnv = role !== "human" ? { ...env, CONVEX_AGENT_MODE: "anonymous" } : env;
const version = execFileSync("npx", ["--no-install", "convex", "--version"], { encoding: "utf8", env }).trim();
if (version !== "1.51.0") throw new Error("Expected convex 1.51.0, got " + version);

const children = new Set();
const transcript = ["Convex " + version + " | " + role + " role | local sandbox"];
const redact = (text) => stripVTControlCharacters(text)
  .replaceAll(process.cwd(), "<PROJECT>")
  .replaceAll(env.HOME, "<SANDBOX_HOME>")
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "<EMAIL>")
  .replace(/("deploymentSelector"\s*:\s*")[^"]+(")/g, "$1<SELECTOR>$2")
  .replace(/(\\"deploymentSelector\\"\s*:\s*\\")[^"]+(\\")/g, "$1<SELECTOR>$2");
const log = (text) => transcript.push(redact(text));
const evidence = (query, got, by = "you") => [{ source: "log", login: by, query, got }];
const start = (name) => RunRecorder.start({
  journey: "journeys/" + name + ".journey.yaml",
  ranBy: { agent: process.env.JOURNEYSFIRST_AGENT || "local replay script" },
  playedBy: {
    you: process.env.JOURNEYSFIRST_AGENT || "local replay script",
    ...(role === "owner" ? { agent: process.env.JOURNEYSFIRST_AGENT || "local replay script" } : {}),
  },
  repos: [],
  tags: { environment: "fresh local sandbox", convex: version, role },
});
const main = start(role === "owner" ? "owner-handoff" : role + "-onboarding");
const dashboard = role === "human" ? start("local-dashboard-message") : null;
const measure = (run, since, by = "you") => ({
  by,
  at: since,
  took: Number((run.elapsed() - since).toFixed(3)),
});
function check(run, id, since, pass, query, got, proof, reason, by = "you") {
  run.check(id, {
    ...measure(run, since, by),
    verdict: pass ? "passed" : "failed",
    proof,
    evidence: evidence(query, got, by),
    ...(pass ? {} : { reason }),
  });
}
function launch(command, args, childEnv = env) {
  const child = spawn(command, args, { env: childEnv, detached: true });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}
async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Timed out: " + label)), ms);
    })]);
  } finally {
    clearTimeout(timer);
  }
}
async function startDev() {
  const cmd = "npx --no-install convex dev";
  log("$ " + (role !== "human" ? "CONVEX_AGENT_MODE=anonymous " : "") + cmd);
  const child = role === "human"
    ? launch("script", ["-q", "-f", "-e", "-c", cmd, "/dev/null"])
    : launch("npx", ["--no-install", "convex", "dev"], agentEnv);
  let output = "";
  const copyOutput = (chunk) => {
    output += chunk.toString();
    process.stdout.write(chunk);
  };
  child.stdout.on("data", copyOutput);
  child.stderr.on("data", copyOutput);
  if (role === "human") process.stdin.pipe(child.stdin, { end: false });
  try {
    await withTimeout(new Promise((resolve, reject) => {
      const ready = () => { if (output.includes("Convex functions ready!")) resolve(); };
      child.stdout.on("data", ready);
      child.stderr.on("data", ready);
      child.once("exit", (code) => reject(new Error("Convex dev exited before readiness: " + code)));
      child.once("error", reject);
    }), 120_000, "convex dev");
  } finally {
    process.stdin.unpipe(child.stdin);
    process.stdin.pause();
    log(redact(output).replace(/[^\r\n]*\[[-=]+\] [\d.]+%[^\r\n]*/g, "").replace(/\r/g, "").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim());
  }
  return redact(output);
}

function connectMcp() {
  log("$ npx --no-install convex mcp start" + (role !== "human" ? " [CONVEX_AGENT_MODE=anonymous inherited]" : ""));
  const child = launch("npx", ["--no-install", "convex", "mcp", "start"], agentEnv);
  const waiting = new Map();
  let lastId = 0;
  child.stderr.on("data", (chunk) => log("[MCP stderr] " + chunk));
  createInterface({ input: child.stdout }).on("line", (line) => {
    log("< " + line);
    const message = JSON.parse(line);
    waiting.get(message.id)?.(message.result ?? message.error);
    waiting.delete(message.id);
  });
  function send(message) {
    const raw = JSON.stringify({ jsonrpc: "2.0", ...message });
    log("> " + raw);
    child.stdin.write(raw + "\n");
  }
  function request(method, params) {
    const id = ++lastId;
    return withTimeout(new Promise((resolve) => {
      waiting.set(id, resolve);
      send({ id, method, params });
    }), 12_000, method);
  }
  return {
    async init() {
      await request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "onboarding-stdio-client", version: "1.0.0" } });
      send({ method: "notifications/initialized" });
      return await request("tools/list");
    },
    async call(name, args) {
      const result = await request("tools/call", { name, arguments: args });
      return result.structuredContent ?? JSON.parse(result.content[0].text);
    },
  };
}

async function cliQuery() {
  log("$ npx --no-install convex run hello:first");
  const cli = launch("npx", ["--no-install", "convex", "run", "hello:first"]);
  let out = "";
  let stderr = "";
  cli.stdout.on("data", (chunk) => { out += chunk; });
  cli.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code] = await withTimeout(once(cli, "close"), 25_000, "convex run");
  log(out.trim());
  if (stderr) log(stderr.trim());
  return { exitCode: code, stdout: out.trim() };
}

async function turn(label) {
  const input = createPrompt({ input: process.stdin, output: process.stdout });
  try {
    const message = redact(await input.question(label + ": ")).trim();
    if (!message) throw new Error("Record the " + label + " turn.");
    log(label + ": " + message);
    return message;
  } finally {
    input.close();
  }
}

async function ownerHandoff() {
  const requested = await turn("Human request");
  if (requested !== "Set up Convex for my app and connect the MCP.") throw new Error("Use the request in the journey.");
  main.step(1, measure(main, 0));
  const dispatched = main.elapsed();
  const output = await startDev();
  const mcp = connectMcp();
  await mcp.init();
  const status = await mcp.call("status", { projectDir: process.cwd() });
  const deployment = status.availableDeployments?.find((item) => item.url.startsWith("http://127.0.0.1:"));
  main.step(2, measure(main, dispatched, "agent"));
  check(main, "agent-mcp-access", main.elapsed(), !!deployment?.deploymentSelector,
    "MCP tools/call status", status.error ?? { selectorReturned: !!deployment?.deploymentSelector },
    status.error ?? "MCP returned a local selector.", status.error ?? "No local selector was returned.", "agent");

  const queryAt = main.elapsed();
  let path = "MCP";
  let result;
  if (deployment?.deploymentSelector) {
    result = (await mcp.call("run", { deploymentSelector: deployment.deploymentSelector, functionName: "hello:first", args: "{}" })).result;
  }
  if (result !== "hello from Convex") {
    path = "CLI";
    log("Agent recovery: use the terminal without asking the human to log in.");
    const cli = await cliQuery();
    if (cli.exitCode === 0) result = JSON.parse(cli.stdout);
  }
  const firstQuery = main.elapsed() - dispatched;
  main.step(4, measure(main, queryAt, "agent"));
  check(main, "agent-query-result", main.elapsed(), result === "hello from Convex",
    path === "CLI" ? "npx convex run hello:first" : "MCP tools/call run hello:first",
    { path, result, secondsFromRequest: firstQuery }, "The " + path + " returned " + JSON.stringify(result) + ".",
    "Neither path returned the sample result.", "agent");

  const hint = output.match(/View the Convex dashboard at [^\r\n]*/)?.[0] ?? null;
  console.log("Agent observed:", JSON.stringify({ status: status.error ?? "local selector", path, result, hint }));
  const replyAt = main.elapsed();
  const reply = await turn("Agent reply to human");
  main.step(6, measure(main, replyAt, "agent"));
  const owner = await turn("Human understanding of the handoff");
  check(main, "owner-knows-state", main.elapsed(), understandsHandoff(owner, path), "Read the agent's setup handoff",
    { reply, owner }, "The human restates the working query path, MCP status, and whether login is needed.",
    "The human could not tell what worked, what was blocked, or whether sign-in was needed.");
  const hasDashboardAddress = !!hint && /^View the Convex dashboard at https?:\/\//.test(hint);
  check(main, "owner-dashboard-address", main.elapsed(), hasDashboardAddress,
    "Read the dashboard handoff", { setupHint: hint, reply }, hint ?? "Setup printed no address.",
    "Setup printed no usable dashboard address. The agent can name a fallback command but cannot hand over a working URL from setup.");
  log("First query after request: " + firstQuery.toFixed(3) + " seconds via " + path + ".");
  log("The human made no setup changes or authentication interventions before the first CLI query.");
  main.attach({ name: "transcript.txt", body: transcript.join("\n") + "\n", kind: "transcript" });
  console.log("RUN " + main.finish().folder);
}

async function onboarding() {
  const startAt = main.elapsed();
  const dashboardStartAt = dashboard?.elapsed();
  const output = await startDev();
  const command = role === "agent" ? "CONVEX_AGENT_MODE=anonymous npx convex dev" : "npx convex dev";
  main.step(1, measure(main, startAt));
  const ready = output.match(/Convex functions ready![^\r\n]*/)?.[0];
  const noAccount = output.includes("No Convex account");
  check(main, "local-ready", main.elapsed(), !!ready && noAccount, command,
    { ready, noAccount }, "The live dev process says the functions are ready and no account is linked.",
    "The first-run output did not confirm an account-free deployment.");

  if (dashboard) {
    dashboard.step(1, measure(dashboard, dashboardStartAt));
    const hint = output.match(/View the Convex dashboard at [^\r\n]*/)?.[0] ?? null;
    const usable = hint === null || /^View the Convex dashboard at https?:\/\//.test(hint);
    check(dashboard, "dashboard-hint", dashboard.elapsed(), usable, command, hint,
      hint ?? "The terminal did not print a dashboard address.",
      "The first-run terminal told the developer to view the Convex dashboard at null.");
    const finished = dashboard.elapsed();
    log("Dashboard message evaluated at " + finished + " seconds.");
    dashboard.attach({ name: "transcript.txt", body: transcript.join("\n") + "\n", kind: "transcript" });
    console.log("RUN " + dashboard.finish().folder);
  }

  if (role === "human") {
    const at = main.elapsed();
    const cli = await cliQuery();
    main.step(3, measure(main, at));
    check(main, "first-cli-query", main.elapsed(), cli.exitCode === 0 && cli.stdout === '"hello from Convex"',
      "npx convex run hello:first", cli, cli.stdout,
      "The terminal did not return the expected sample value.");
  }

  const discoverAt = main.elapsed();
  const mcp = connectMcp();
  const listed = await mcp.init();
  const tools = listed.tools?.map((tool) => tool.name) ?? [];
  const status = await mcp.call("status", { projectDir: process.cwd() });
  const deployment = status.availableDeployments?.find((entry) => entry.url.startsWith("http://127.0.0.1:"));
  main.step(role === "agent" ? 3 : 5, measure(main, discoverAt));
  check(main, "mcp-discovery", main.elapsed(), !!deployment?.deploymentSelector,
    "MCP initialize; tools/list; tools/call status", {
      tools,
      status: deployment ? { url: deployment.url, selectorReturned: !!deployment.deploymentSelector } : status,
    }, status.error ?? "The status tool returned the local deployment and its selector.",
    status.error ?? "The status tool did not return a local deployment selector.");
  const queryLine = role === "agent" ? 5 : 7;
  if (deployment?.deploymentSelector) {
    const at = main.elapsed();
    const deploymentSelector = deployment.deploymentSelector;
    const tables = role === "human" ? await mcp.call("tables", { deploymentSelector }) : undefined;
    const query = await mcp.call("run", { deploymentSelector, functionName: "hello:first", args: "{}" });
    main.step(queryLine, measure(main, at));
    check(main, "first-mcp-query", main.elapsed(), !tables?.error && query.result === "hello from Convex",
      "MCP tools/call " + (role === "human" ? "tables, then " : "") + "run hello:first",
      { tables, query }, "The MCP query returned " + JSON.stringify(query.result) + ".",
      "The MCP tools did not return the tables and/or expected query value.");
  } else {
    const reason = "The MCP status tool did not return the deployment selector required for the next tool call.";
    log(reason + " Tables and query were not called.");
    main.blocked(queryLine, { by: "you", cause: "product", reason });
    main.blocked("first-mcp-query", { by: "you", cause: "product", reason });
  }
  main.attach({ name: "transcript.txt", body: transcript.join("\n") + "\n", kind: "transcript" });
  console.log("RUN " + main.finish().folder);
}

try {
  if (role === "owner") await ownerHandoff();
  else await onboarding();
} finally {
  for (const child of children) {
    try { process.kill(-child.pid, "SIGTERM"); } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}
